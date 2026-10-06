/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as activity from "../activity.js";
import type * as crons from "../crons.js";
import type * as goals from "../goals.js";
import type * as home from "../home.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_rate from "../lib/rate.js";
import type * as lib_shape from "../lib/shape.js";
import type * as limits from "../limits.js";
import type * as media from "../media.js";
import type * as money from "../money.js";
import type * as notifications from "../notifications.js";
import type * as oauth from "../oauth.js";
import type * as race from "../race.js";
import type * as slops from "../slops.js";
import type * as tokens from "../tokens.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  activity: typeof activity;
  crons: typeof crons;
  goals: typeof goals;
  home: typeof home;
  "lib/auth": typeof lib_auth;
  "lib/rate": typeof lib_rate;
  "lib/shape": typeof lib_shape;
  limits: typeof limits;
  media: typeof media;
  money: typeof money;
  notifications: typeof notifications;
  oauth: typeof oauth;
  race: typeof race;
  slops: typeof slops;
  tokens: typeof tokens;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
