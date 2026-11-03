/** What the studio's writing assistant can do (app/.server/social/assist.ts), with its buttons' words. */
export const ASSIST_ACTIONS = {
  shorten: "Shorter",
  expand: "Longer",
  rephrase: "Say it another way",
  punchier: "Punchier",
  thread: "Make a thread",
  hashtags: "Suggest hashtags",
  adapt: "Fit it to a network",
} as const;

export type AssistAction = keyof typeof ASSIST_ACTIONS;

export function isAssistAction(value: string): value is AssistAction {
  return Object.hasOwn(ASSIST_ACTIONS, value);
}
