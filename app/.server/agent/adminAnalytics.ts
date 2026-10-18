import { api } from "@convex/_generated/api";
import { errorsQuery, heatmapQuery, insightQuery, isInsightKind, vitalsQuery } from "~/lib/insights";
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
 * as /analytics/insights (`days`, `event`, `math`, `breakdown`…). Flags
 * and experiments are read here; they're changed at /analytics/flags.
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
  "flags",
  "experiments",
  "experiment",
  "recordings",
  "heatmap",
  "errors",
  "error",
  "vitals",
  "surveys",
  "survey",
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
    case "flags":
      return { flags: await convex.query(api.analytics.flags, { adminId }) };
    case "surveys":
      return { surveys: await convex.query(api.analytics.surveys, { adminId }) };
    case "survey": {
      const key = params.get("q") ?? "";
      const survey = await convex.query(api.analytics.survey, { adminId, key });
      if (!survey) throw new ApiError(404, `There's no survey “${key}”.`);
      if (survey.startedAt === null) return { survey, results: null };
      const answer = await convex.action(api.analytics.insight, {
        adminId,
        query: {
          kind: "survey",
          key,
          question: survey.kind,
          range: { from: survey.startedAt, to: (survey.endedAt ?? now.getTime()) + 1 },
        },
      });
      return { survey, results: answer.result, truncated: answer.truncated };
    }
    case "vitals":
      return await convex.action(api.analytics.insight, { adminId, query: vitalsQuery(params, now.getTime()) });
    case "errors":
      return await convex.action(api.analytics.insight, { adminId, query: errorsQuery(params, now.getTime()) });
    case "error": {
      const fingerprint = params.get("q") ?? "";
      const answer = await convex.action(api.analytics.insight, {
        adminId,
        query: errorsQuery(params, now.getTime(), fingerprint),
      });
      if (answer.result.kind !== "errors" || answer.result.issues.length === 0) {
        throw new ApiError(404, `There's no error “${fingerprint}” in that range.`);
      }
      return answer;
    }
    case "heatmap":
      return await convex.action(api.analytics.insight, { adminId, query: heatmapQuery(params, now.getTime()) });
    case "recordings":
      return await convex.query(api.analytics.recordings, { adminId, cursor: params.get("after") });
    case "experiments":
      return { experiments: await convex.query(api.analytics.experiments, { adminId }) };
    case "experiment": {
      const key = params.get("q") ?? "";
      const found = await convex.action(api.analytics.experimentResults, { adminId, key });
      if (!found) throw new ApiError(404, `There's no experiment “${key}”.`);
      return found;
    }
    default:
      if (isInsightKind(report)) return await insight(report);
      throw new ApiError(400, `Unknown report “${report}”. Reports: ${ADMIN_REPORTS.join(", ")}.`);
  }
}
