import { v } from "convex/values";
import schema from "./schema";

/**
 * Return validators for the component's documents. Without them, an app
 * would see what the component returns as `any`; with them, the generated
 * `ComponentApi` types every result.
 */

const system = <Table extends "events" | "persons" | "sessions" | "flags" | "experiments" | "recordings" | "surveys">(
  table: Table,
) => ({
  _id: v.id(table),
  _creationTime: v.number(),
});

export const eventDoc = v.object({ ...system("events"), ...schema.tables.events.validator.fields });
export const personDoc = v.object({ ...system("persons"), ...schema.tables.persons.validator.fields });
export const sessionDoc = v.object({ ...system("sessions"), ...schema.tables.sessions.validator.fields });
export const flagDoc = v.object({ ...system("flags"), ...schema.tables.flags.validator.fields });
export const experimentDoc = v.object({ ...system("experiments"), ...schema.tables.experiments.validator.fields });
export const surveyDoc = v.object({ ...system("surveys"), ...schema.tables.surveys.validator.fields });
export const recordingDoc = v.object({ ...system("recordings"), ...schema.tables.recordings.validator.fields });
