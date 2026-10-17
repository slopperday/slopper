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
import type * as cliLogins from "../cliLogins.js";
import type * as crons from "../crons.js";
import type * as digest from "../digest.js";
import type * as digestSend from "../digestSend.js";
import type * as goals from "../goals.js";
import type * as home from "../home.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_digest from "../lib/digest.js";
import type * as lib_embeddings from "../lib/embeddings.js";
import type * as lib_media from "../lib/media.js";
import type * as lib_notify from "../lib/notify.js";
import type * as lib_rate from "../lib/rate.js";
import type * as lib_shape from "../lib/shape.js";
import type * as limits from "../limits.js";
import type * as media from "../media.js";
import type * as moderation from "../moderation.js";
import type * as money from "../money.js";
import type * as notifications from "../notifications.js";
import type * as oauth from "../oauth.js";
import type * as push from "../push.js";
import type * as pushSend from "../pushSend.js";
import type * as race from "../race.js";
import type * as schedule from "../schedule.js";
import type * as search from "../search.js";
import type * as slops from "../slops.js";
import type * as team from "../team.js";
import type * as tokens from "../tokens.js";
import type * as users from "../users.js";
import type * as videos from "../videos.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  activity: typeof activity;
  cliLogins: typeof cliLogins;
  crons: typeof crons;
  digest: typeof digest;
  digestSend: typeof digestSend;
  goals: typeof goals;
  home: typeof home;
  "lib/auth": typeof lib_auth;
  "lib/digest": typeof lib_digest;
  "lib/embeddings": typeof lib_embeddings;
  "lib/media": typeof lib_media;
  "lib/notify": typeof lib_notify;
  "lib/rate": typeof lib_rate;
  "lib/shape": typeof lib_shape;
  limits: typeof limits;
  media: typeof media;
  moderation: typeof moderation;
  money: typeof money;
  notifications: typeof notifications;
  oauth: typeof oauth;
  push: typeof push;
  pushSend: typeof pushSend;
  race: typeof race;
  schedule: typeof schedule;
  search: typeof search;
  slops: typeof slops;
  team: typeof team;
  tokens: typeof tokens;
  users: typeof users;
  videos: typeof videos;
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
