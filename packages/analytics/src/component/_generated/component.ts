/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    definitions: {
      list: FunctionReference<
        "query",
        "internal",
        {},
        Array<{ firstSeenAt: number; lastSeenAt: number; name: string }>,
        Name
      >;
    };
    events: {
      recent: FunctionReference<
        "query",
        "internal",
        { distinctId?: string; group?: string; limit?: number; name?: string },
        Array<{
          _creationTime: number;
          _id: string;
          distinctId: string;
          group?: string;
          name: string;
          path: string | null;
          personId: string;
          properties: Record<
            string,
            string | number | boolean | null | Array<string>
          >;
          sessionId: string | null;
          timestamp: number;
          uuid: string;
        }>,
        Name
      >;
    };
    experiments: {
      get: FunctionReference<
        "query",
        "internal",
        { key: string },
        {
          _creationTime: number;
          _id: string;
          endedAt: number | null;
          flagKey: string;
          goal: {
            event: string;
            filters: Array<{
              key: string;
              operator:
                | "equals"
                | "notEquals"
                | "contains"
                | "notContains"
                | "isSet"
                | "isNotSet"
                | "greaterThan"
                | "lessThan";
              value?: string | number | boolean;
            }>;
          };
          hypothesis: string;
          key: string;
          name: string;
          startedAt: number | null;
          status: "draft" | "running" | "stopped";
        } | null,
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        {},
        Array<{
          _creationTime: number;
          _id: string;
          endedAt: number | null;
          flagKey: string;
          goal: {
            event: string;
            filters: Array<{
              key: string;
              operator:
                | "equals"
                | "notEquals"
                | "contains"
                | "notContains"
                | "isSet"
                | "isNotSet"
                | "greaterThan"
                | "lessThan";
              value?: string | number | boolean;
            }>;
          };
          hypothesis: string;
          key: string;
          name: string;
          startedAt: number | null;
          status: "draft" | "running" | "stopped";
        }>,
        Name
      >;
      remove: FunctionReference<
        "mutation",
        "internal",
        { key: string },
        boolean,
        Name
      >;
      save: FunctionReference<
        "mutation",
        "internal",
        {
          flagKey: string;
          goal: {
            event: string;
            filters: Array<{
              key: string;
              operator:
                | "equals"
                | "notEquals"
                | "contains"
                | "notContains"
                | "isSet"
                | "isNotSet"
                | "greaterThan"
                | "lessThan";
              value?: string | number | boolean;
            }>;
          };
          hypothesis: string;
          key: string;
          name: string;
        },
        { created: boolean },
        Name
      >;
      start: FunctionReference<
        "mutation",
        "internal",
        { key: string },
        null,
        Name
      >;
      stop: FunctionReference<
        "mutation",
        "internal",
        { key: string },
        null,
        Name
      >;
    };
    flags: {
      definitions: FunctionReference<
        "query",
        "internal",
        {},
        Array<{
          active: boolean;
          conditions: Array<{
            filters: Array<{
              key: string;
              operator:
                | "equals"
                | "notEquals"
                | "contains"
                | "notContains"
                | "isSet"
                | "isNotSet"
                | "greaterThan"
                | "lessThan";
              value?: string | number | boolean;
            }>;
            rollout: number;
            variant: string | null;
          }>;
          key: string;
          payloads: Record<string, string>;
          variants: Array<{ key: string; weight: number }> | null;
        }>,
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { key: string },
        {
          _creationTime: number;
          _id: string;
          active: boolean;
          conditions: Array<{
            filters: Array<{
              key: string;
              operator:
                | "equals"
                | "notEquals"
                | "contains"
                | "notContains"
                | "isSet"
                | "isNotSet"
                | "greaterThan"
                | "lessThan";
              value?: string | number | boolean;
            }>;
            rollout: number;
            variant: string | null;
          }>;
          createdAt: number;
          description: string;
          key: string;
          name: string;
          payloads: Record<string, string>;
          updatedAt: number;
          variants: Array<{ key: string; weight: number }> | null;
        } | null,
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        {},
        Array<{
          _creationTime: number;
          _id: string;
          active: boolean;
          conditions: Array<{
            filters: Array<{
              key: string;
              operator:
                | "equals"
                | "notEquals"
                | "contains"
                | "notContains"
                | "isSet"
                | "isNotSet"
                | "greaterThan"
                | "lessThan";
              value?: string | number | boolean;
            }>;
            rollout: number;
            variant: string | null;
          }>;
          createdAt: number;
          description: string;
          key: string;
          name: string;
          payloads: Record<string, string>;
          updatedAt: number;
          variants: Array<{ key: string; weight: number }> | null;
        }>,
        Name
      >;
      remove: FunctionReference<
        "mutation",
        "internal",
        { key: string },
        boolean,
        Name
      >;
      save: FunctionReference<
        "mutation",
        "internal",
        {
          active: boolean;
          conditions: Array<{
            filters: Array<{
              key: string;
              operator:
                | "equals"
                | "notEquals"
                | "contains"
                | "notContains"
                | "isSet"
                | "isNotSet"
                | "greaterThan"
                | "lessThan";
              value?: string | number | boolean;
            }>;
            rollout: number;
            variant: string | null;
          }>;
          description: string;
          key: string;
          name: string;
          payloads: Record<string, string>;
          variants: Array<{ key: string; weight: number }> | null;
        },
        { created: boolean },
        Name
      >;
      setActive: FunctionReference<
        "mutation",
        "internal",
        { active: boolean; key: string },
        boolean,
        Name
      >;
    };
    ingest: {
      batch: FunctionReference<
        "mutation",
        "internal",
        {
          context: {
            device: {
              browser: string | null;
              browserVersion: string | null;
              deviceType: "desktop" | "mobile" | "tablet" | null;
              os: string | null;
              osVersion: string | null;
            };
            ownHost: string | null;
          };
          events: Array<{
            distinctId: string;
            group: string | null;
            name: string;
            path: string | null;
            properties: Record<
              string,
              string | number | boolean | null | Array<string>
            >;
            sessionId: string | null;
            set: Record<
              string,
              string | number | boolean | null | Array<string>
            > | null;
            setOnce: Record<
              string,
              string | number | boolean | null | Array<string>
            > | null;
            timestamp: number;
            uuid: string;
          }>;
        },
        { duplicates: number; stored: number },
        Name
      >;
      capture: FunctionReference<
        "mutation",
        "internal",
        {
          distinctId: string;
          group?: string;
          identified?: boolean;
          name: string;
          properties?: Record<
            string,
            string | number | boolean | null | Array<string>
          >;
          set?: Record<
            string,
            string | number | boolean | null | Array<string>
          >;
          setOnce?: Record<
            string,
            string | number | boolean | null | Array<string>
          >;
          timestamp?: number;
        },
        { duplicates: number; stored: number },
        Name
      >;
    };
    maintenance: {
      sweep: FunctionReference<
        "mutation",
        "internal",
        {
          retention: {
            eventDays: number;
            personDays: number;
            recordingDays?: number;
          };
        },
        { deleted: number; more: boolean },
        Name
      >;
    };
    persons: {
      forget: FunctionReference<
        "mutation",
        "internal",
        { distinctId: string },
        boolean,
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { distinctId: string },
        {
          _creationTime: number;
          _id: string;
          createdAt: number;
          distinctIds: Array<string>;
          identified: boolean;
          initialPath: string | null;
          initialSource: {
            channel:
              | "direct"
              | "search"
              | "social"
              | "email"
              | "paid"
              | "referral"
              | "internal";
            referrerDomain: string | null;
            utmCampaign: string | null;
            utmMedium: string | null;
            utmSource: string | null;
          } | null;
          lastSeenAt: number;
          mergedInto?: string;
          properties: Record<
            string,
            string | number | boolean | null | Array<string>
          >;
        } | null,
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        { cursor: string | null; numItems: number },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            _creationTime: number;
            _id: string;
            createdAt: number;
            distinctIds: Array<string>;
            identified: boolean;
            initialPath: string | null;
            initialSource: {
              channel:
                | "direct"
                | "search"
                | "social"
                | "email"
                | "paid"
                | "referral"
                | "internal";
              referrerDomain: string | null;
              utmCampaign: string | null;
              utmMedium: string | null;
              utmSource: string | null;
            } | null;
            lastSeenAt: number;
            mergedInto?: string;
            properties: Record<
              string,
              string | number | boolean | null | Array<string>
            >;
          }>;
        },
        Name
      >;
    };
    recordings: {
      get: FunctionReference<
        "query",
        "internal",
        { sessionId: string },
        {
          chunks: Array<{
            bytes: number;
            encoding: "gzip" | "identity";
            endedAt: number;
            startedAt: number;
            url: string;
          }>;
          recording: {
            _creationTime: number;
            _id: string;
            bytes: number;
            chunks: number;
            distinctId: string;
            endedAt: number;
            events: number;
            sessionId: string;
            startedAt: number;
          };
        } | null,
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        { cursor: string | null; numItems: number },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            recording: {
              _creationTime: number;
              _id: string;
              bytes: number;
              chunks: number;
              distinctId: string;
              endedAt: number;
              events: number;
              sessionId: string;
              startedAt: number;
            };
            session: {
              _creationTime: number;
              _id: string;
              country: string | null;
              device: {
                browser: string | null;
                browserVersion: string | null;
                deviceType: "desktop" | "mobile" | "tablet" | null;
                os: string | null;
                osVersion: string | null;
              };
              distinctId: string;
              endedAt: number;
              entryPath: string | null;
              events: number;
              exitPath: string | null;
              interactions: number;
              pageviews: number;
              personId: string;
              sessionId: string;
              source: {
                channel:
                  | "direct"
                  | "search"
                  | "social"
                  | "email"
                  | "paid"
                  | "referral"
                  | "internal";
                referrerDomain: string | null;
                utmCampaign: string | null;
                utmMedium: string | null;
                utmSource: string | null;
              };
              startedAt: number;
              viewportWidth: number | null;
            } | null;
          }>;
        },
        Name
      >;
      recorded: FunctionReference<
        "query",
        "internal",
        { sessionIds: Array<string> },
        Array<string>,
        Name
      >;
      store: FunctionReference<
        "action",
        "internal",
        {
          data: ArrayBuffer;
          distinctId: string;
          encoding: "gzip" | "identity";
          endedAt: number;
          events: number;
          sessionId: string;
          startedAt: number;
        },
        boolean,
        Name
      >;
    };
    scan: {
      events: FunctionReference<
        "query",
        "internal",
        {
          cursor: string | null;
          from: number;
          group?: string;
          name: string | null;
          numItems: number;
          to: number;
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            distinctId: string;
            group: string | null;
            name: string;
            path: string | null;
            personId: string;
            properties: Record<
              string,
              string | number | boolean | null | Array<string>
            >;
            sessionId: string | null;
            timestamp: number;
          }>;
        },
        Name
      >;
      firstSeen: FunctionReference<
        "query",
        "internal",
        { personIds: Array<string> },
        Array<{ createdAt: number; personId: string }>,
        Name
      >;
      persons: FunctionReference<
        "query",
        "internal",
        { cursor: string | null; numItems: number },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            createdAt: number;
            identified: boolean;
            lastSeenAt: number;
          }>;
        },
        Name
      >;
      sessions: FunctionReference<
        "query",
        "internal",
        { cursor: string | null; from: number; numItems: number; to: number },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            country: string | null;
            device: {
              browser: string | null;
              browserVersion: string | null;
              deviceType: "desktop" | "mobile" | "tablet" | null;
              os: string | null;
              osVersion: string | null;
            };
            endedAt: number;
            entryPath: string | null;
            exitPath: string | null;
            interactions: number;
            pageviews: number;
            personId: string;
            sessionId: string;
            source: {
              channel:
                | "direct"
                | "search"
                | "social"
                | "email"
                | "paid"
                | "referral"
                | "internal";
              referrerDomain: string | null;
              utmCampaign: string | null;
              utmMedium: string | null;
              utmSource: string | null;
            };
            startedAt: number;
          }>;
        },
        Name
      >;
      sessionSources: FunctionReference<
        "query",
        "internal",
        { sessionIds: Array<string> },
        Array<{
          country: string | null;
          sessionId: string;
          source: {
            channel:
              | "direct"
              | "search"
              | "social"
              | "email"
              | "paid"
              | "referral"
              | "internal";
            referrerDomain: string | null;
            utmCampaign: string | null;
            utmMedium: string | null;
            utmSource: string | null;
          };
        }>,
        Name
      >;
    };
    sessions: {
      active: FunctionReference<
        "query",
        "internal",
        { limit?: number; since: number },
        Array<{
          _creationTime: number;
          _id: string;
          country: string | null;
          device: {
            browser: string | null;
            browserVersion: string | null;
            deviceType: "desktop" | "mobile" | "tablet" | null;
            os: string | null;
            osVersion: string | null;
          };
          distinctId: string;
          endedAt: number;
          entryPath: string | null;
          events: number;
          exitPath: string | null;
          interactions: number;
          pageviews: number;
          personId: string;
          sessionId: string;
          source: {
            channel:
              | "direct"
              | "search"
              | "social"
              | "email"
              | "paid"
              | "referral"
              | "internal";
            referrerDomain: string | null;
            utmCampaign: string | null;
            utmMedium: string | null;
            utmSource: string | null;
          };
          startedAt: number;
          viewportWidth: number | null;
        }>,
        Name
      >;
      forPerson: FunctionReference<
        "query",
        "internal",
        { distinctId: string; limit?: number },
        Array<{
          _creationTime: number;
          _id: string;
          country: string | null;
          device: {
            browser: string | null;
            browserVersion: string | null;
            deviceType: "desktop" | "mobile" | "tablet" | null;
            os: string | null;
            osVersion: string | null;
          };
          distinctId: string;
          endedAt: number;
          entryPath: string | null;
          events: number;
          exitPath: string | null;
          interactions: number;
          pageviews: number;
          personId: string;
          sessionId: string;
          source: {
            channel:
              | "direct"
              | "search"
              | "social"
              | "email"
              | "paid"
              | "referral"
              | "internal";
            referrerDomain: string | null;
            utmCampaign: string | null;
            utmMedium: string | null;
            utmSource: string | null;
          };
          startedAt: number;
          viewportWidth: number | null;
        }>,
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { sessionId: string },
        {
          events: Array<{
            _creationTime: number;
            _id: string;
            distinctId: string;
            group?: string;
            name: string;
            path: string | null;
            personId: string;
            properties: Record<
              string,
              string | number | boolean | null | Array<string>
            >;
            sessionId: string | null;
            timestamp: number;
            uuid: string;
          }>;
          session: {
            _creationTime: number;
            _id: string;
            country: string | null;
            device: {
              browser: string | null;
              browserVersion: string | null;
              deviceType: "desktop" | "mobile" | "tablet" | null;
              os: string | null;
              osVersion: string | null;
            };
            distinctId: string;
            endedAt: number;
            entryPath: string | null;
            events: number;
            exitPath: string | null;
            interactions: number;
            pageviews: number;
            personId: string;
            sessionId: string;
            source: {
              channel:
                | "direct"
                | "search"
                | "social"
                | "email"
                | "paid"
                | "referral"
                | "internal";
              referrerDomain: string | null;
              utmCampaign: string | null;
              utmMedium: string | null;
              utmSource: string | null;
            };
            startedAt: number;
            viewportWidth: number | null;
          };
        } | null,
        Name
      >;
    };
  };
