const STORAGE_KEY = 'paspl_scanner_feedback';

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

function withEnvelope(gain: GainNode, startTime: number, duration: number) {
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(0.12, startTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
}

/** Short success tone (≈1 kHz, 60 ms) */
export function playSuccessBeep(): void {
  if (!getScannerFeedbackPrefs().sound) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1000, now);
  osc.connect(gain);
  gain.connect(ctx.destination);
  withEnvelope(gain, now, 0.06);
  osc.start(now);
  osc.stop(now + 0.07);
}

/** Low error buzz (≈220 Hz, 120 ms) */
export function playErrorBuzz(): void {
  if (!getScannerFeedbackPrefs().sound) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(220, now);
  osc.connect(gain);
  gain.connect(ctx.destination);
  withEnvelope(gain, now, 0.12);
  osc.start(now);
  osc.stop(now + 0.14);
}

export function vibrateIfEnabled(pattern: number | number[]): void {
  if (!getScannerFeedbackPrefs().haptics) return;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  navigator.vibrate(pattern);
}
