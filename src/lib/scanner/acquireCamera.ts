const DEVICE_ID_KEY = 'paspl_camera_device_id';

const BASE_VIDEO: MediaTrackConstraints = {
  width: { ideal: 1920 },
  height: { ideal: 1080 },
  frameRate: { ideal: 30, min: 24 },
};

function persistDeviceId(track: MediaStreamTrack) {
  const id = track.getSettings?.().deviceId;
  if (id) sessionStorage.setItem(DEVICE_ID_KEY, id);
}

async function pickRearCameraDeviceId(): Promise<string | null> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const rear = devices.find(
      (d) => d.kind === 'videoinput' && /back|rear|environment|wide|ultra/i.test(d.label),
    );
    return rear?.deviceId ?? null;
  } catch {
    return null;
  }
}

/**
 * Acquires the best available camera stream using a constraint fallback ladder.
 * Persists chosen deviceId in sessionStorage for faster re-acquire.
 */
export async function acquireCameraStream(): Promise<{ stream: MediaStream; track: MediaStreamTrack }> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera access is not available on this device.');
  }

  const savedId = sessionStorage.getItem(DEVICE_ID_KEY);
  const rearId = await pickRearCameraDeviceId();

  const attempts: MediaStreamConstraints[] = [
    { audio: false, video: { ...BASE_VIDEO, facingMode: { exact: 'environment' } } },
    { audio: false, video: { ...BASE_VIDEO, facingMode: { ideal: 'environment' } } },
  ];

  if (rearId) {
    attempts.push({ audio: false, video: { ...BASE_VIDEO, deviceId: { exact: rearId } } });
  }
  if (savedId && savedId !== rearId) {
    attempts.push({ audio: false, video: { ...BASE_VIDEO, deviceId: { exact: savedId } } });
  }

  attempts.push({ audio: false, video: { ...BASE_VIDEO } });
  attempts.push({ audio: false, video: true });

  let lastError: unknown;
  const seen = new Set<string>();

  for (const constraints of attempts) {
    const key = JSON.stringify(constraints);
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const track = stream.getVideoTracks()[0];
      if (!track) {
        stream.getTracks().forEach((t) => t.stop());
        continue;
      }
      persistDeviceId(track);
      return { stream, track };
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Could not access camera.');
}

export async function applyContinuousCameraEnhancements(track: MediaStreamTrack): Promise<void> {
  const capabilities = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
    zoom?: { min?: number; max?: number };
  };
  try {
    const advanced: Record<string, unknown> = {
      focusMode: 'continuous',
      exposureMode: 'continuous',
      whiteBalanceMode: 'continuous',
    };
    if (capabilities.zoom?.max && capabilities.zoom.max > 1) {
      advanced.zoom = Math.min(2.25, capabilities.zoom.max);
    }
    await track.applyConstraints({
      advanced: [advanced as MediaTrackConstraintSet],
    });
  } catch {
    // Best effort only.
  }
}
