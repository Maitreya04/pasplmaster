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

export function triggerHaptic(intent: HapticIntent): void {
  const haptics = getHaptics();
  if (!haptics) return;

  void haptics.trigger(patternByIntent[intent]);
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
