import type { PickLineProgress } from '../cartSupply';
import { PICK_REMINDER, type PickReminderKind } from './pickReminderConfig';

export type PickReminderProgressSnapshot = {
  done: number;
  remaining: number;
  lastChangeMs: number;
  allDoneSinceMs: number | null;
};

export function createPickReminderSnapshot(
  progress: PickLineProgress | undefined,
  previous: PickReminderProgressSnapshot | undefined,
  nowMs = Date.now(),
): PickReminderProgressSnapshot | null {
  if (!progress || progress.total === 0) return null;

  const done = progress.done;
  const remaining = progress.remaining;
  const changed =
    !previous || previous.done !== done || previous.remaining !== remaining;

  let allDoneSinceMs = previous?.allDoneSinceMs ?? null;
  if (remaining === 0) {
    if (allDoneSinceMs == null || changed) {
      allDoneSinceMs = nowMs;
    }
  } else {
    allDoneSinceMs = null;
  }

  return {
    done,
    remaining,
    lastChangeMs: changed ? nowMs : (previous?.lastChangeMs ?? nowMs),
    allDoneSinceMs,
  };
}

export function evaluatePickReminder(input: {
  workflowStatus: string;
  pickerName: string | null;
  snapshot: PickReminderProgressSnapshot | null;
  nowMs?: number;
}): PickReminderKind | null {
  const { workflowStatus, pickerName, snapshot } = input;
  if (workflowStatus !== 'picking' || !pickerName?.trim() || !snapshot) {
    return null;
  }

  const nowMs = input.nowMs ?? Date.now();

  if (
    snapshot.remaining === 0 &&
    snapshot.allDoneSinceMs != null &&
    nowMs - snapshot.allDoneSinceMs >= PICK_REMINDER.allDoneAfterMs
  ) {
    return 'all_done';
  }

  if (
    snapshot.remaining > 0 &&
    snapshot.done > 0 &&
    nowMs - snapshot.lastChangeMs >= PICK_REMINDER.stallAfterMs
  ) {
    return 'stalled';
  }

  return null;
}
