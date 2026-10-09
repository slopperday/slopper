"use node";

import { createElement } from "react";
import { render } from "react-email";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { DigestEmail } from "../app/emails/digest";
import { digestHeadline, summariseDigest } from "../app/lib/digest";

const TIMEOUT_MS = 15_000;

const itemValidator = v.object({
  kind: v.union(
    v.literal("upvote"),
    v.literal("feedback"),
    v.literal("kudos"),
    v.literal("pledge"),
    v.literal("slop_of_the_day"),
  ),
  slop: v.object({ id: v.string(), name: v.string(), launchLabel: v.union(v.string(), v.null()), slug: v.string() }),
  amount: v.union(v.number(), v.null()),
});

/**
 * Renders each digest with react-email (`app/emails/digest.tsx`, HTML plus
 * a plain-text part) and sends the lot through Resend's batch API. Each
 * carries a one-click unsubscribe (RFC 8058) that mail apps show as
 * "Unsubscribe". RESEND_BASE_URL only changes for tests; DIGEST_FROM is the
 * sender, on a domain verified in Resend. Runs in Node for React's server
 * renderer.
 */
export const deliver = internalAction({
  args: {
    emails: v.array(
      v.object({ to: v.string(), username: v.string(), items: v.array(itemValidator), unsubscribeUrl: v.string() }),
    ),
    appUrl: v.string(),
    /** Resend sends a batch with the same key once, however often it's retried. */
    idempotencyKey: v.string(),
  },
  handler: async (_ctx, { emails, appUrl, idempotencyKey }) => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_API_KEY isn't set, so no digest can be sent.");
    const from = process.env.DIGEST_FROM ?? "Slopper <digest@slopper.day>";
    const base = process.env.RESEND_BASE_URL ?? "https://api.resend.com";

    const batch = await Promise.all(
      emails.map(async ({ to, username, items, unsubscribeUrl }) => {
        const email = createElement(DigestEmail, { username, items, appUrl, unsubscribeUrl });
        return {
          from,
          to: [to],
          reply_to: "hello@slopper.day",
          subject: digestHeadline(summariseDigest(username, items)),
          html: await render(email),
          text: await render(email, { plainText: true }),
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        };
      }),
    );

    const response = await fetch(`${base}/emails/batch`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(batch),
    });
    if (!response.ok) throw new Error(`Resend answered ${response.status}: ${await response.text()}`);
  },
});
