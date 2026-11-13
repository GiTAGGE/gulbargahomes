/** A reached conversation or a site visit. An attempt does not qualify. */
export function isMeaningfulActivity(activity: { kind: string; direction: string; outcome: string }): boolean {
  return (
    activity.kind === "visit" ||
    activity.direction === "inbound" ||
    activity.outcome === "connected" ||
    activity.outcome === "callback_requested" ||
    activity.outcome === "replied"
  );
}

/** SQL predicate for the `activities a` alias. */
export const MEANINGFUL_ACTIVITY_SQL =
  "(a.kind = 'visit' OR a.direction = 'inbound' OR a.outcome IN ('connected', 'callback_requested', 'replied'))";

/** An unanswered call or a message that was only sent. Notes are neither. */
export const ATTEMPT_ACTIVITY_SQL =
  "((a.kind = 'call' AND a.outcome IN ('no_answer', 'busy', 'switched_off', 'wrong_number')) OR (a.kind IN ('whatsapp', 'sms', 'email') AND a.direction = 'outbound' AND a.outcome IN ('sent', '')))";
