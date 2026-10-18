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
        { retention: { eventDays: number; personDays: number } },
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
