import { WebHaptics } from 'web-haptics';

/** Peak Web Audio gain for in-app alerts (device media volume still applies). */
const ALERT_PEAK = 0.95;

/** Long pulse train for Android / Chromium when a new notification arrives. */
const ALERT_VIBRATE_MS = [400, 70, 400, 70, 400, 70, 400] as const;

let audioContext: AudioContext | null = null;
let alertHaptics: WebHaptics | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioContext) {
    try {
      audioContext = new AudioContext();
    } catch {
      return null;
    }
  }
  return audioContext;
}

function toneEnvelope(gain: GainNode, startTime: number, duration: number, peak: number) {
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), startTime + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
}

function playTone(
  ctx: AudioContext,
  frequency: number,
  start: number,
  duration: number,
  peak: number,
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(frequency, start);
  osc.connect(gain);
  gain.connect(ctx.destination);
  toneEnvelope(gain, start, duration, peak);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/**
 * Loud triple-chime for new in-app notifications (order ready, flags, etc.).
 * Distinct from scanner success/error tones.
 */
export function playNotificationAlert(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();

  const now = ctx.currentTime;
  playTone(ctx, 988, now, 0.09, ALERT_PEAK);
  playTone(ctx, 1319, now + 0.11, 0.1, ALERT_PEAK);
  playTone(ctx, 1760, now + 0.24, 0.14, ALERT_PEAK * 0.98);
}

function getAlertHaptics(): WebHaptics | null {
  if (typeof window === 'undefined') return null;
  alertHaptics ??= new WebHaptics();
  return alertHaptics;
}

/** Strong haptic burst when a new notification lands while the app is open. */
export function vibrateNotificationAlert(): void {
  const haptics = getAlertHaptics();
  if (haptics) {
    void haptics.trigger('nudge', { intensity: 1 });
    void haptics.trigger('heavy', { intensity: 1 });
    void haptics.trigger('error', { intensity: 1 });
  }

  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate([...ALERT_VIBRATE_MS]);
  }
}
