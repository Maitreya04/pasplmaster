import { WebHaptics } from 'web-haptics';

const STORAGE_KEY = 'paspl_scanner_feedback';

/** Peak Web Audio gain — tuned for noisy warehouse floors (device volume still applies). */
const SUCCESS_PEAK = 0.72;
const ERROR_PEAK = 0.68;

/** navigator.vibrate patterns (Android / some Chromium). */
const VIBRATE_SUCCESS_MS = [220, 35, 160] as const;
const VIBRATE_ERROR_MS = [300, 55, 300, 55, 300] as const;

export type ScannerFeedbackPrefs = {
  sound: boolean;
  haptics: boolean;
};

const DEFAULT_PREFS: ScannerFeedbackPrefs = { sound: true, haptics: true };

export function getScannerFeedbackPrefs(): ScannerFeedbackPrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<ScannerFeedbackPrefs>;
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function setScannerFeedbackPrefs(partial: Partial<ScannerFeedbackPrefs>): void {
  if (typeof window === 'undefined') return;
  const next = { ...getScannerFeedbackPrefs(), ...partial };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let scannerHaptics: WebHaptics | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioContext) {
    try {
      audioContext = new AudioContext();
      masterGain = audioContext.createGain();
      masterGain.gain.value = 1;
      masterGain.connect(audioContext.destination);
    } catch {
      return null;
    }
  }
  return audioContext;
}

function getMasterGain(ctx: AudioContext): GainNode {
  if (!masterGain) {
    masterGain = ctx.createGain();
    masterGain.gain.value = 1;
    masterGain.connect(ctx.destination);
  }
  return masterGain;
}

function toneEnvelope(gain: GainNode, startTime: number, duration: number, peak: number) {
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), startTime + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
}

function playTone(
  ctx: AudioContext,
  dest: AudioNode,
  type: OscillatorType,
  frequency: number,
  start: number,
  duration: number,
  peak: number,
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  osc.connect(gain);
  gain.connect(dest);
  toneEnvelope(gain, start, duration, peak);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/** Prime Web Audio on the same user gesture that opens the scanner (reduces first-beep latency on iOS). */
export function primeScannerAudioContext(): void {
  if (typeof window === 'undefined') return;
  if (!getScannerFeedbackPrefs().sound) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  try {
    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(getMasterGain(ctx));
    source.start(ctx.currentTime);
    source.stop(ctx.currentTime + 0.002);
  } catch {
    /* ignore */
  }
}

/**
 * Loud dual-tone success chirp (warehouse scanner style).
 * Two rising sine bursts read as “confirmed” even in noisy aisles.
 */
export function playSuccessBeep(): void {
  if (!getScannerFeedbackPrefs().sound) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();

  const dest = getMasterGain(ctx);
  const now = ctx.currentTime;
  playTone(ctx, dest, 'sine', 1850, now, 0.055, SUCCESS_PEAK);
  playTone(ctx, dest, 'sine', 2620, now + 0.07, 0.075, SUCCESS_PEAK * 0.95);
}

/** Low double-buzz — unmistakable mismatch vs success. */
export function playErrorBuzz(): void {
  if (!getScannerFeedbackPrefs().sound) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();

  const dest = getMasterGain(ctx);
  const now = ctx.currentTime;
  playTone(ctx, dest, 'square', 165, now, 0.1, ERROR_PEAK);
  playTone(ctx, dest, 'square', 145, now + 0.14, 0.12, ERROR_PEAK);
}

function getScannerHaptics(): WebHaptics | null {
  if (typeof window === 'undefined') return null;
  scannerHaptics ??= new WebHaptics();
  return scannerHaptics;
}

export type ScannerVibrateKind = 'success' | 'error';

/**
 * Strong scanner haptics: web-haptics notification patterns (incl. iOS switch fallback)
 * plus long navigator.vibrate bursts on Android.
 */
export function vibrateIfEnabled(kind: ScannerVibrateKind): void {
  if (!getScannerFeedbackPrefs().haptics) return;

  const haptics = getScannerHaptics();
  if (haptics) {
    void haptics.trigger(kind === 'success' ? 'success' : 'error');
    if (kind === 'error') {
      void haptics.trigger('heavy');
    }
  }

  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(kind === 'success' ? [...VIBRATE_SUCCESS_MS] : [...VIBRATE_ERROR_MS]);
  }
}
