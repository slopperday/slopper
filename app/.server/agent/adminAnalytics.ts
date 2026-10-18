import { api } from "@convex/_generated/api";
import { insightQuery, isInsightKind } from "~/lib/insights";
import { convex } from "../convex";
import type { User } from "../session";
import { ApiError } from "./input";

/**
 * Platform analytics for admins' agents: `GET /api/v1/admin/analytics`,
 * which `slopper admin analytics` calls. It's deliberately not an MCP tool
 * and nothing public mentions it (llms.txt, the skill, the CLI's help);
 * AGENTS.md documents it. Anyone without `analytics.view` gets the same 404
 * as an unknown endpoint.
 *
 * `report` picks what to answer; the rest of the query string is the same
 * as /analytics/insights (`days`, `event`, `math`, `breakdown`…).
 */

export const ADMIN_REPORTS = [
  "overview",
  "growth",
  "projects",
  "traffic",
  "trends",
  "funnel",
  "retention",
  "paths",
  "stickiness",
  "lifecycle",
  "people",
  "person",
  "live",
  "events",
] as const;

function days(params: URLSearchParams): number {
  const value = Number(params.get("days") ?? 30);
  return Number.isInteger(value) && value >= 1 && value <= 365 ? value : 30;
}

export async function adminReport(admin: User, params: URLSearchParams, now: Date): Promise<unknown> {
  const adminId = admin._id;
  const report = params.get("report") ?? "overview";
  const insight = async (kind: Parameters<typeof insightQuery>[0]) =>
    await convex.action(api.analytics.insight, { adminId, query: insightQuery(kind, params, now.getTime()) });
  switch (report) {
    case "overview": {
      const [people, growth, projects] = await Promise.all([
        convex.action(api.analytics.overview, { adminId }),
        convex.action(api.analytics.growth, { adminId, days: days(params) }),
        convex.action(api.analytics.projects, { adminId, days: Math.min(days(params), 30) }),
      ]);
      return { people, growth, projects };
    }
    case "growth":
      return await convex.action(api.analytics.growth, { adminId, days: days(params) });
    case "projects":
      return await convex.action(api.analytics.projects, { adminId, days: days(params) });
    case "traffic":
      return await insight("web");
    case "people":
      return await convex.query(api.analytics.people, { adminId, cursor: params.get("after") });
    case "person": {
      const search = params.get("q") ?? "";
      const distinctId = await convex.query(api.analytics.findPerson, { adminId, search });
      if (!distinctId) throw new ApiError(404, `Nobody matches “${search}”.`);
      return await convex.query(api.analytics.person, { adminId, distinctId });
    }
    case "live":
      return await convex.query(api.analytics.live, { asUser: adminId });
    case "events":
      return { events: await convex.query(api.analytics.eventNames, { adminId }) };
    default:
      if (isInsightKind(report)) return await insight(report);
      throw new ApiError(400, `Unknown report “${report}”. Reports: ${ADMIN_REPORTS.join(", ")}.`);
  }
}
