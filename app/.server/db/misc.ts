import type { Kv } from "@deno/kv";
import type { Report } from "~/lib/model";
import { newId, withRetry } from "../kv";

/**
 * Fixed-window rate limit. Returns false once `subject` has used up `limit`
 * actions in the current window for `bucket`.
 */
export async function allowAction(
  kv: Kv,
  bucket: string,
  subject: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const window = Math.floor(Date.now() / windowMs);
  const key = ["rate", bucket, subject, window];
  return await withRetry(async () => {
    const entry = await kv.get<number>(key);
    const count = entry.value ?? 0;
    if (count >= limit) return false;
    const result = await kv
      .atomic()
      .check(entry)
      .set(key, count + 1, { expireIn: windowMs })
      .commit();
    return result.ok ? true : null;
  });
}

export async function fileReport(kv: Kv, slopId: string, reporterId: string, reason: string): Promise<Report> {
  const report: Report = {
    id: newId(),
    slopId,
    reporterId,
    reason,
    createdAt: new Date().toISOString(),
  };
  await kv.set(["report", report.id], report);
  return report;
}

export async function listReports(kv: Kv): Promise<Report[]> {
  const reports: Report[] = [];
  for await (const entry of kv.list<Report>({ prefix: ["report"] }, { reverse: true })) reports.push(entry.value);
  return reports;
}

export async function dismissReports(kv: Kv, slopId: string): Promise<void> {
  const op = kv.atomic();
  for (const report of await listReports(kv)) {
    if (report.slopId === slopId) op.delete(["report", report.id]);
  }
  await op.commit();
}
