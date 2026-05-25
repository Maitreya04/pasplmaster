/** Auto-remind assigned pickers when a pick session stalls or is ready to submit. */
export const PICK_REMINDER = {
  /** All pick lines done — nudge picker to tap Complete. */
  allDoneAfterMs: 5 * 60_000,
  /** Partial progress with no line movement — nudge to finish remaining lines. */
  stallAfterMs: 15 * 60_000,
  /** Edge function skips duplicate reminders within this window. */
  cooldownMs: 10 * 60_000,
  /** Billing desk polling interval. */
  checkIntervalMs: 60_000,
} as const;

export type PickReminderKind = 'all_done' | 'stalled';
