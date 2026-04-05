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
  if (typeof window === 'undefined' || !WebHaptics.isSupported) {
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

export const appHaptics = {
  selection: () => triggerHaptic('selection'),
  success: () => triggerHaptic('success'),
  warning: () => triggerHaptic('warning'),
  error: () => triggerHaptic('error'),
  impactLight: () => triggerHaptic('impactLight'),
  impactMedium: () => triggerHaptic('impactMedium'),
  impactHeavy: () => triggerHaptic('impactHeavy'),
  nudge: () => triggerHaptic('nudge'),
};
