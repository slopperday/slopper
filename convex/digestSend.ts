import { v } from "convex/values";
import { internalAction } from "./_generated/server";

const TIMEOUT_MS = 15_000;

/**
 * Sends a batch of digests through Resend's batch API. Each carries a
 * one-click unsubscribe (RFC 8058) that mail apps show as "Unsubscribe".
 * RESEND_BASE_URL only changes for tests; DIGEST_FROM is the sender, on a
 * domain verified in Resend.
 */
export const deliver = internalAction({
  args: {
    emails: v.array(
      v.object({ to: v.string(), subject: v.string(), text: v.string(), html: v.string(), unsubscribeUrl: v.string() }),
    ),
    /** Resend sends a batch with the same key once, however often it's retried. */
    idempotencyKey: v.string(),
  },
  handler: async (_ctx, { emails, idempotencyKey }) => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_API_KEY isn't set, so no digest can be sent.");
    const from = process.env.DIGEST_FROM ?? "Slopper <digest@slopper.day>";
    const base = process.env.RESEND_BASE_URL ?? "https://api.resend.com";
    const response = await fetch(`${base}/emails/batch`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(
        emails.map(({ to, subject, text, html, unsubscribeUrl }) => ({
          from,
          to: [to],
          reply_to: "hello@slopper.day",
          subject,
          text,
          html,
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        })),
      ),
    });
    if (!response.ok) throw new Error(`Resend answered ${response.status}: ${await response.text()}`);
  },
});
