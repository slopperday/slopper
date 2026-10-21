/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as definitions from "../definitions.js";
import type * as events from "../events.js";
import type * as experiments from "../experiments.js";
import type * as flags from "../flags.js";
import type * as ingest from "../ingest.js";
import type * as lib_ingest from "../lib/ingest.js";
import type * as lib_limits from "../lib/limits.js";
import type * as lib_paging from "../lib/paging.js";
import type * as lib_rollupDays from "../lib/rollupDays.js";
import type * as maintenance from "../maintenance.js";
import type * as persons from "../persons.js";
import type * as recordings from "../recordings.js";
import type * as rollupValidators from "../rollupValidators.js";
import type * as rollups from "../rollups.js";
import type * as scan from "../scan.js";
import type * as sessions from "../sessions.js";
import type * as shapes from "../shapes.js";
import type * as surveys from "../surveys.js";
import type * as validators from "../validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  definitions: typeof definitions;
  events: typeof events;
  experiments: typeof experiments;
  flags: typeof flags;
  ingest: typeof ingest;
  "lib/ingest": typeof lib_ingest;
  "lib/limits": typeof lib_limits;
  "lib/paging": typeof lib_paging;
  "lib/rollupDays": typeof lib_rollupDays;
  maintenance: typeof maintenance;
  persons: typeof persons;
  recordings: typeof recordings;
  rollupValidators: typeof rollupValidators;
  rollups: typeof rollups;
  scan: typeof scan;
  sessions: typeof sessions;
  shapes: typeof shapes;
  surveys: typeof surveys;
  validators: typeof validators;
}> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
> = anyApi as any;

export const components = componentsGeneric() as unknown as {};
