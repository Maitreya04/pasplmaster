/**
 * Haptic feedback policy (aligned with iOS HIG three feedback types).
 *
 * Native iOS maps to UIKit generators; on the web we approximate via `web-haptics`
 * (vibration where supported, switch-based fallback on Safari iOS).
 *
 * | HIG role            | Use when                                      | API                |
 * |---------------------|-----------------------------------------------|--------------------|
 * | Selection changed   | Tab change, chip toggle, picker, filter       | `selection()`      |
 * | Impact (physical)   | Button tap, stepper tick, confirm tap         | `impactLight` … `Heavy` — match weight to action significance |
 * | Notification        | Task outcome: saved, warning, failed          | `success/warning/error()` |
 *
 * ### Light vs medium vs heavy (impact only)
 *
 * **Light** — small, reversible, or high-frequency physical controls: tab change, open sheet/cart,
 * stepper ±1, starting an inline edit, picking a line item, tapping a secondary control.
 *
 * **Medium** — primary “do it” controls: main CTA (e.g. Save, Place order, Submit) when the action
 * is important but not destructive; confirming a modal’s default action.
 *
 * **Heavy** — rare emphasis: destructive action **committed** (delete sent, void order), hard boundary
 * (“cannot proceed”), or a major milestone after a long flow **if** you want tactile emphasis beyond
 * `success()` (avoid stacking both unless intentional).
 *
 * **Selection** — value changed without a “big button” metaphor: filters, chips, dropdown choice,
 * segmented control, sheet open/close paired with UI (often softer than impact).
 *
 * **Notification** (`success` / `warning` / `error`) — **outcome** of a task, not tap weight.
 * Use for completed mutations, toasts, verification mismatch, API failure. Do not use impact-heavy
 * for every error if `error()` already runs.
 *
 * Rules: always pair with visible (or audible) feedback; use sparingly; never rely on haptics alone.
 * Prefer `selection` for discrete value/UI changes; reserve `success|warning|error` for completed flows
 * or global toasts so you do not double-fire notification haptics on the same user-visible outcome.
 *
 * @see https://developer.apple.com/design/human-interface-guidelines/playing-haptics
 */
import { WebHaptics } from 'web-haptics';

type HapticIntent =
  | 'selection'
  | 'success'
  | 'warning'
  | 'error'
  | 'impactLight'
  | 'impactMedium'
  | 'impactHeavy'
  | 'nudge';

let instance: WebHaptics | null = null;

function getHaptics(): WebHaptics | null {
  // Safari does not expose navigator.vibrate; web-haptics falls back to
  // programmatic toggles on <input switch> (iOS 17.4+) when unsupported.
  if (typeof window === 'undefined') {
    return null;
  }

  instance ??= new WebHaptics();
  return instance;
}

const patternByIntent = {
  selection: 'selection',
  success: 'success',
  warning: 'warning',
  error: 'error',
  impactLight: 'light',
  impactMedium: 'medium',
  impactHeavy: 'heavy',
  nudge: 'nudge',
} as const;

const NOTIFICATION_INTENSITY = 1;

/** Extra navigator.vibrate bursts layered on notification outcomes (Android / Chromium). */
const NOTIFICATION_VIBRATE_MS = {
  success: [220, 45, 180] as const,
  warning: [280, 60, 280, 60, 280] as const,
  error: [350, 70, 350, 70, 350, 70, 350] as const,
} as const;

function vibrateNotificationOutcome(intent: 'success' | 'warning' | 'error'): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  navigator.vibrate([...NOTIFICATION_VIBRATE_MS[intent]]);
}

export function triggerHaptic(intent: HapticIntent): void {
  const haptics = getHaptics();
  if (!haptics) return;

  const isNotificationOutcome =
    intent === 'success' || intent === 'warning' || intent === 'error';
  const intensity = isNotificationOutcome ? NOTIFICATION_INTENSITY : undefined;

  void haptics.trigger(patternByIntent[intent], intensity != null ? { intensity } : undefined);

  if (intent === 'success' || intent === 'warning' || intent === 'error') {
    vibrateNotificationOutcome(intent);
    if (intent === 'error') {
      void haptics.trigger('heavy', { intensity: NOTIFICATION_INTENSITY });
    }
  }
}

/** HIG-aligned helpers — use the table in the module docstring when adding new call sites. */
export const appHaptics = {
  /** UISelectionFeedbackGenerator — toggles, tabs, filters, stepping through options */
  selection: () => triggerHaptic('selection'),
  /** UINotificationFeedbackGenerator(.success) — completed action, positive outcome */
  success: () => triggerHaptic('success'),
  /** UINotificationFeedbackGenerator(.warning) — caution, retry, soft validation */
  warning: () => triggerHaptic('warning'),
  /** UINotificationFeedbackGenerator(.error) — failure, destructive result */
  error: () => triggerHaptic('error'),
  /** UIImpactFeedbackGenerator(.light) — minor physical control (e.g. small stepper) */
  impactLight: () => triggerHaptic('impactLight'),
  /** UIImpactFeedbackGenerator(.medium) — standard button / primary tap */
  impactMedium: () => triggerHaptic('impactMedium'),
  /** UIImpactFeedbackGenerator(.heavy) — strong confirmation, major toggle */
  impactHeavy: () => triggerHaptic('impactHeavy'),
  /** Extra pattern for attention / boundary — use rarely */
  nudge: () => triggerHaptic('nudge'),
};
