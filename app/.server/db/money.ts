import type { Kv } from "@deno/kv";
import { COST_CATEGORIES, LIMITS, type LedgerEntry, type MoneyKind, REVENUE_CATEGORIES } from "~/lib/model";
import { CURRENCIES } from "~/lib/money";
import { isIsoDate } from "~/lib/dates";
import { listValues, newId } from "../kv";

/**
 * A product's money: what it cost (domain, hosting, AI) and what it made.
 * Private unless the owner opts in to showing the numbers.
 */

export interface NewLedgerEntry {
  kind: MoneyKind;
  amount: number;
  currency: string;
  category: string;
  note: string;
  date: string;
}

export function ledgerProblem(entry: NewLedgerEntry): string | null {
  if (!Number.isInteger(entry.amount) || entry.amount <= 0) return "Enter an amount above zero.";
  if (!(CURRENCIES as readonly string[]).includes(entry.currency)) return `Use one of ${CURRENCIES.join(", ")}.`;
  const categories: readonly string[] = entry.kind === "cost" ? COST_CATEGORIES : REVENUE_CATEGORIES;
  if (!categories.includes(entry.category)) return `Category is one of ${categories.join(", ")}.`;
  if (!isIsoDate(entry.date)) return "Date must be YYYY-MM-DD.";
  if (entry.note.length > LIMITS.ledgerNoteLength) return `Keep the note under ${LIMITS.ledgerNoteLength} characters.`;
  return null;
}

export async function addLedgerEntry(
  kv: Kv,
  productId: string,
  userId: string,
  input: NewLedgerEntry,
): Promise<LedgerEntry> {
  const entry: LedgerEntry = { id: newId(), productId, userId, ...input, createdAt: new Date().toISOString() };
  await kv.set(["ledger", productId, entry.id], entry);
  return entry;
}

export function listLedger(kv: Kv, productId: string): Promise<LedgerEntry[]> {
  return listValues<LedgerEntry>(kv, { prefix: ["ledger", productId] }, { reverse: true });
}

export async function deleteLedgerEntry(kv: Kv, productId: string, entryId: string): Promise<void> {
  await kv.delete(["ledger", productId, entryId]);
}

export async function isMoneyPublic(kv: Kv, productId: string): Promise<boolean> {
  return (await kv.get<boolean>(["money_public", productId])).value === true;
}

export async function setMoneyPublic(kv: Kv, productId: string, visible: boolean): Promise<void> {
  if (visible) await kv.set(["money_public", productId], true);
  else await kv.delete(["money_public", productId]);
}
