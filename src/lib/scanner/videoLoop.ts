/** Video-aligned scan ticks: one decode attempt per delivered camera frame when supported. */
export function createVideoScanLoop(
  video: HTMLVideoElement,
  onPotentialFrame: (timeMs: number) => void,
): { start: () => void; stop: () => void } {
  let active = false;
  let vfcId: number | undefined;
  let rafId: number | null = null;

  const usesVfc = typeof video.requestVideoFrameCallback === 'function';

  const scheduleNext = () => {
    if (!active) return;
    if (usesVfc) {
      vfcId = video.requestVideoFrameCallback(() => {
        if (!active) return;
        onPotentialFrame(typeof performance !== 'undefined' ? performance.now() : Date.now());
        scheduleNext();
      });
    } else {
      rafId = requestAnimationFrame((ts) => {
        if (!active) return;
        onPotentialFrame(ts);
        scheduleNext();
      });
    }
  };

  return {
    start() {
      if (active) return;
      active = true;
      scheduleNext();
    },
    stop() {
      active = false;
      if (usesVfc && vfcId != null && typeof video.cancelVideoFrameCallback === 'function') {
        try {
          video.cancelVideoFrameCallback(vfcId);
        } catch {
          /* ignore */
        }
        vfcId = undefined;
      }
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    },
  };
}
