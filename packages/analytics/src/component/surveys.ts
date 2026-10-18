import { ConvexError, v } from "convex/values";
import {
  SURVEY_LIMITS,
  surveyDefinitionValidator,
  surveyKindValidator,
  surveyProblems,
  surveyTargetValidator,
} from "../shared/surveys";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { surveyDoc } from "./shapes";

/**
 * Surveys: drafts change freely; a running one is shown to people (from
 * `definitions`, which a page reads); a stopped one keeps its results.
 * Answers are events, never stored here.
 */

async function find(ctx: Pick<QueryCtx, "db">, key: string) {
  return await ctx.db
    .query("surveys")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
}

/** Every survey, newest first. */
export const list = query({
  args: {},
  returns: v.array(surveyDoc),
  handler: async (ctx) => await ctx.db.query("surveys").order("desc").collect(),
});

export const get = query({
  args: { key: v.string() },
  returns: v.union(surveyDoc, v.null()),
  handler: async (ctx, { key }) => await find(ctx, key),
});

/** What pages need to ask the running surveys, oldest first: cache it where pages render. */
export const definitions = query({
  args: {},
  returns: v.array(surveyDefinitionValidator),
  handler: async (ctx) => {
    const running = await ctx.db
      .query("surveys")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .collect();
    return running.map(({ key, question, kind, choices, followUp, target }) => ({
      key,
      question,
      kind,
      choices,
      followUp,
      target,
    }));
  },
});

/** Makes a draft, or changes one that hasn't started. Says whether it was new. */
export const save = mutation({
  args: {
    key: v.string(),
    name: v.string(),
    question: v.string(),
    kind: surveyKindValidator,
    choices: v.array(v.string()),
    followUp: v.union(v.string(), v.null()),
    target: surveyTargetValidator,
  },
  returns: v.object({ created: v.boolean() }),
  handler: async (ctx, fields) => {
    const survey = {
      ...fields,
      name: fields.name.trim().slice(0, 100) || fields.key,
      question: fields.question.trim(),
      choices: fields.kind === "choice" ? fields.choices.map((choice) => choice.trim()).filter(Boolean) : [],
      followUp: fields.followUp?.trim().slice(0, SURVEY_LIMITS.questionLength) || null,
    };
    const problems = surveyProblems(survey);
    if (problems.length > 0) throw new ConvexError(problems.join(" "));
    const existing = await find(ctx, fields.key);
    if (existing) {
      if (existing.status !== "draft") throw new ConvexError("It has started: what it asks can't change now.");
      await ctx.db.patch(existing._id, survey);
      return { created: false };
    }
    await ctx.db.insert("surveys", {
      ...survey,
      status: "draft",
      createdAt: Date.now(),
      startedAt: null,
      endedAt: null,
    });
    return { created: true };
  },
});

/** Starts asking it. */
export const start = mutation({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, { key }) => {
    const survey = await find(ctx, key);
    if (!survey) throw new ConvexError("There's no such survey.");
    if (survey.status !== "draft") throw new ConvexError("It has already started.");
    await ctx.db.patch(survey._id, { status: "running", startedAt: Date.now() });
    return null;
  },
});

/** Stops asking it; its answers stay. */
export const stop = mutation({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, { key }) => {
    const survey = await find(ctx, key);
    if (!survey || survey.status !== "running") throw new ConvexError("It isn't running.");
    await ctx.db.patch(survey._id, { status: "stopped", endedAt: Date.now() });
    return null;
  },
});

/** Deletes it; answers already given stay with the people who gave them, as events. */
export const remove = mutation({
  args: { key: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { key }) => {
    const survey = await find(ctx, key);
    if (!survey) return false;
    await ctx.db.delete(survey._id);
    return true;
  },
});
