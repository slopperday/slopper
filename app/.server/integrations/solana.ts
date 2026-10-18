import { fetchJson, SourceError, type SyncInput, type SyncResult, unixDay, utcDate } from "./source";

/**
 * A Solana wallet taking stablecoin payments. No key: a wallet's payments are
 * public on chain. Stablecoins go to the wallet's token accounts, not the
 * wallet itself, so each token account is read: new signatures since the
 * last sync, then each transaction's balance change for the wallet. Payments
 * the wallet signed itself (swaps, moving its own money) don't count.
 *
 * Each sync reads a bounded number of transactions, oldest first, and the
 * cursor remembers where each token account got to.
 */

/** Stablecoins counted as US dollars, by mint. Both have 6 decimals. */
export const STABLECOIN_MINTS: Readonly<Record<string, string>> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
};

export const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Transactions read per sync, across every token account. Keeps a sync inside a function's time limit. */
const TRANSACTIONS_PER_SYNC = 40;
const SIGNATURES_PER_PAGE = 1000;
/** How far back one sync pages per token account: 10,000 signatures. Payments further behind the cursor are skipped. */
const MAX_SIGNATURE_PAGES = 10;

interface RpcResponse<Result> {
  id: number;
  result?: Result;
  error?: { code: number; message: string };
}

interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
}

interface ParsedTransaction {
  blockTime: number | null;
  meta: { err: unknown; preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[] } | null;
  transaction: { message: { accountKeys: { pubkey: string; signer: boolean }[] } };
}

/** One JSON-RPC batch; results come back in the order of `calls`. */
async function rpc<Result>(input: SyncInput, rpcUrl: string, calls: [string, unknown[]][]): Promise<Result[]> {
  if (calls.length === 0) return [];
  const body = (await fetchJson(
    input.fetcher,
    rpcUrl,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(calls.map(([method, params], id) => ({ jsonrpc: "2.0", id, method, params }))),
    },
    () => null,
  )) as RpcResponse<Result>[];
  return [...body]
    .sort((a, b) => a.id - b.id)
    .map((reply) => {
      if (reply.error) throw new Error(`Solana RPC: ${reply.error.message}`);
      return reply.result as Result;
    });
}

/** How much a transaction paid the wallet, in cents, if anything. */
export function paidToWallet(transaction: ParsedTransaction, wallet: string): number {
  if (!transaction.meta || transaction.meta.err !== null) return 0;
  if (transaction.transaction.message.accountKeys.some((key) => key.signer && key.pubkey === wallet)) return 0;
  const before = new Map(
    (transaction.meta.preTokenBalances ?? []).map((balance) => [balance.accountIndex, balance.uiTokenAmount.amount]),
  );
  let received = 0n;
  for (const balance of transaction.meta.postTokenBalances ?? []) {
    if (balance.owner !== wallet || !STABLECOIN_MINTS[balance.mint]) continue;
    const delta = BigInt(balance.uiTokenAmount.amount) - BigInt(before.get(balance.accountIndex) ?? "0");
    if (delta > 0n) received += delta;
  }
  // 6 decimals: 10,000 base units to the cent.
  return Number(received / 10_000n);
}

function readCursor(cursor: string | null): Record<string, string> {
  if (!cursor) return {};
  const parsed: unknown = JSON.parse(cursor);
  return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, string>) : {};
}

interface SignatureInfo {
  signature: string;
  err: unknown;
  blockTime: number | null;
}

/**
 * Each token account's signatures since its cursor (or, the first time,
 * since `since`), newest first. The node returns a page at a time, newest
 * first, so a full page means older ones are still waiting: keep paging back
 * with `before` until the cursor, the start of the window, or the page limit.
 */
async function newSignatures(
  input: SyncInput,
  rpcUrl: string,
  accounts: readonly string[],
  cursor: Readonly<Record<string, string>>,
  sinceSeconds: number,
): Promise<SignatureInfo[][]> {
  const page = (account: string, before?: string): [string, unknown[]] => [
    "getSignaturesForAddress",
    [
      account,
      {
        limit: SIGNATURES_PER_PAGE,
        commitment: "finalized",
        ...(cursor[account] ? { until: cursor[account] } : {}),
        ...(before ? { before } : {}),
      },
    ],
  ];
  const lists = await rpc<SignatureInfo[]>(
    input,
    rpcUrl,
    accounts.map((account) => page(account)),
  );
  for (const [index, account] of accounts.entries()) {
    let last = lists[index];
    for (let pages = 1; last.length === SIGNATURES_PER_PAGE && pages < MAX_SIGNATURE_PAGES; pages++) {
      const oldest = last[last.length - 1];
      if (!cursor[account] && (oldest.blockTime ?? 0) < sinceSeconds) break;
      [last] = await rpc<SignatureInfo[]>(input, rpcUrl, [page(account, oldest.signature)]);
      lists[index] = [...lists[index], ...last];
    }
  }
  return lists;
}

export async function syncSolana(input: SyncInput, rpcUrl: string): Promise<SyncResult> {
  const wallet = input.settings.wallet ?? "";
  if (!SOLANA_ADDRESS.test(wallet)) throw new SourceError("That isn't a Solana wallet address.");
  const cursor = readCursor(input.cursor);
  const sinceSeconds = unixDay(input.since);

  const accountLists = await rpc<{ value: { pubkey: string }[] }>(
    input,
    rpcUrl,
    Object.keys(STABLECOIN_MINTS).map((mint) => [
      "getTokenAccountsByOwner",
      [wallet, { mint }, { encoding: "jsonParsed", commitment: "finalized" }],
    ]),
  );
  const accounts = accountLists.flatMap((list) => list.value.map((account) => account.pubkey));
  if (accounts.length === 0) return { merge: "add", days: [], live: null, snapshot: {}, cursor: input.cursor };

  const signatureLists = await newSignatures(input, rpcUrl, accounts, cursor, sinceSeconds);

  // Oldest first across all token accounts, so the cursor never skips past an unread payment.
  const pending = accounts
    .flatMap((account, index) =>
      [...signatureLists[index]]
        .reverse()
        .filter((item) => cursor[account] || (item.blockTime ?? 0) >= sinceSeconds)
        .map((item) => ({ account, ...item })),
    )
    .sort((a, b) => (a.blockTime ?? 0) - (b.blockTime ?? 0));
  const batch = pending.slice(0, TRANSACTIONS_PER_SYNC);
  const transactions = await rpc<ParsedTransaction | null>(
    input,
    rpcUrl,
    batch
      .filter((item) => item.err === null)
      .map((item) => [
        "getTransaction",
        [item.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "finalized" }],
      ]),
  );
  const bySignature = new Map(
    batch.filter((item) => item.err === null).map((item, index) => [item.signature, transactions[index]]),
  );

  const revenue = new Map<string, number>();
  const next = { ...cursor };
  // Accounts with nothing new in range start from their newest signature next time.
  accounts.forEach((account, index) => {
    const newest = signatureLists[index][0];
    if (newest && !pending.some((item) => item.account === account)) next[account] = newest.signature;
  });
  for (const item of batch) {
    const transaction = bySignature.get(item.signature);
    // Failed transactions moved nothing; one the node can't serve yet is read next time.
    if (item.err === null && !transaction) break;
    if (transaction && transaction.blockTime !== null) {
      const cents = paidToWallet(transaction, wallet);
      if (cents > 0) {
        const date = utcDate(transaction.blockTime);
        revenue.set(date, (revenue.get(date) ?? 0) + cents);
      }
    }
    next[item.account] = item.signature;
  }

  return {
    merge: "add",
    days: [...revenue].map(([date, cents]) => ({ date, revenue: { USD: cents } })),
    live: null,
    snapshot: {},
    cursor: JSON.stringify(next),
  };
}
