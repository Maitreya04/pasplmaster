/* eslint-disable react-refresh/only-export-components -- provider module exports hooks and shared detector types */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { REQUESTED_BARCODE_FORMATS } from '../lib/scanner/barcodeFormats';
import { detectScannerPlatform } from '../lib/scanner/scannerPlatform';
import {
  acquireCameraStream,
  applyContinuousCameraEnhancements,
} from '../lib/scanner/acquireCamera';
import { initializeItemScanIndex } from '../stores/itemScanIndex';

export type BarcodeDetectorResult = {
  rawValue?: string | null;
  format?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
  cornerPoints?: ReadonlyArray<{ x: number; y: number }>;
};

export type BarcodeDetectorLike = {
  detect(source: HTMLVideoElement | ImageBitmap): Promise<BarcodeDetectorResult[]>;
};

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;
type BarcodeDetectorStatic = BarcodeDetectorCtor & {
  getSupportedFormats?: () => Promise<string[]>;
};

export type WarmScannerEngines =
  | { kind: 'native'; detector: BarcodeDetectorLike }
  | { kind: 'worker'; worker: Worker }
  | null;

async function createNativeBarcodeDetector(): Promise<BarcodeDetectorLike | null> {
  const Detector = (window as Window & typeof globalThis & {
    BarcodeDetector?: BarcodeDetectorStatic;
  }).BarcodeDetector;
  if (!Detector) return null;

  const platform = detectScannerPlatform();
  if (!platform.preferNativeDetector) return null;

  const supportedFormats = await Detector.getSupportedFormats?.();
  const formats = supportedFormats
    ? REQUESTED_BARCODE_FORMATS.filter((format) => supportedFormats.includes(format))
    : [...REQUESTED_BARCODE_FORMATS];

  if (formats.length === 0) return null;
  return new Detector({ formats });
}

function spawnScannerWorker(): Promise<Worker> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/qrScanner.worker', import.meta.url), {
      type: 'module',
    });
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.removeEventListener('message', onMsg);
      worker.removeEventListener('error', onErr);
      worker.terminate();
      reject(new Error('Scanner worker ready timeout'));
    }, 15000);

    const onMsg = (e: MessageEvent) => {
      if (e.data?.type !== 'ready' || settled) return;
      settled = true;
      window.clearTimeout(timer);
      worker.removeEventListener('message', onMsg);
      worker.removeEventListener('error', onErr);
      resolve(worker);
    };

    const onErr = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      worker.removeEventListener('message', onMsg);
      worker.removeEventListener('error', onErr);
      worker.terminate();
      reject(new Error('Scanner worker failed to load'));
    };

    worker.addEventListener('message', onMsg);
    worker.addEventListener('error', onErr);
  });
}

export interface PickingCameraContextValue {
  stream: MediaStream | null;
  enginesReady: boolean;
  warmEngines: WarmScannerEngines;
  /** Ensures an active camera stream is running; returns it for synchronous attachment */
  ensureCamera: () => Promise<MediaStream>;
  releaseCameraTracks: () => void;
}

const PickingCameraContext = createContext<PickingCameraContextValue | undefined>(undefined);

export function useOptionalPickingCamera(): PickingCameraContextValue | undefined {
  return useContext(PickingCameraContext);
}

/** App-wide scanner env (camera stream + WASM/native engines). Alias for readability. */
export const useScannerEnv = useOptionalPickingCamera;

export function usePickingCamera(): PickingCameraContextValue {
  const ctx = useContext(PickingCameraContext);
  if (!ctx) {
    throw new Error('usePickingCamera must be used within CameraProvider');
  }
  return ctx;
}

/** Permission banner + tap-to-enable camera before first scan */
export function useCameraPermissionWarmup(): {
  permissionState: PermissionState | 'unsupported';
  requestWarmup: () => Promise<void>;
} {
  const ctx = useOptionalPickingCamera();
  const ctxRef = useRef(ctx);

  useEffect(() => {
    ctxRef.current = ctx;
  });

  const [permissionState, setPermissionState] = useState<PermissionState | 'unsupported'>(
    'unsupported',
  );

  useEffect(() => {
    let cancelled = false;
    if (!navigator.permissions?.query) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync fallback before subscribe (no Permissions API)
      setPermissionState('unsupported');
      return;
    }
    let statusRef: PermissionStatus | null = null;
    const onChange = () => {
      if (!statusRef) return;
      setPermissionState(statusRef.state);
      if (statusRef.state === 'granted') {
        void ctxRef.current?.ensureCamera().catch(() => undefined);
      }
    };

    void navigator.permissions
      .query({ name: 'camera' as PermissionName })
      .then((status) => {
        if (cancelled) return;
        statusRef = status;
        setPermissionState(status.state);
        status.addEventListener('change', onChange);
        if (status.state === 'granted') {
          void ctxRef.current?.ensureCamera().catch(() => undefined);
        }
      })
      .catch(() => {
        if (!cancelled) setPermissionState('unsupported');
      });

    return () => {
      cancelled = true;
      statusRef?.removeEventListener('change', onChange);
    };
  }, []);

  const requestWarmup = useCallback(async () => {
    await ctxRef.current?.ensureCamera().catch(() => undefined);
    try {
      const next = await navigator.permissions?.query({ name: 'camera' as PermissionName });
      if (next) setPermissionState(next.state);
    } catch {
      /* ignore */
    }
  }, []);

  return { permissionState, requestWarmup };
}

export function CameraProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [enginesReady, setEnginesReady] = useState(false);
  const [warmEngines, setWarmEngines] = useState<WarmScannerEngines>(null);

  const releaseCameraTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  const ensureCamera = useCallback(async (): Promise<MediaStream> => {
    if (streamRef.current?.active) return streamRef.current;
    const { stream: next, track } = await acquireCameraStream();
    await applyContinuousCameraEnhancements(track);
    streamRef.current = next;
    setStream(next);
    return next;
  }, []);

  /** Warm item-scan catalog (used after decode) ASAP in parallel with camera engines. */
  useEffect(() => {
    void initializeItemScanIndex().catch(() => {
      /* surface via itemScanIndexStore */
    });
  }, []);

  /** If camera permission is already granted, warm the preview stream outside active scanner modals */
  useEffect(() => {
    let cancelled = false;
    let idleHandle = 0;
    let timeoutHandle = 0;

    const run = () => {
      if (!cancelled) void ensureCamera().catch(() => undefined);
    };

    const clearHandles = () => {
      if (idleHandle !== 0 && typeof cancelIdleCallback !== 'undefined') cancelIdleCallback(idleHandle);
      if (timeoutHandle !== 0) window.clearTimeout(timeoutHandle);
      idleHandle = 0;
      timeoutHandle = 0;
    };

    const scheduleWarm = () => {
      clearHandles();
      if (typeof requestIdleCallback !== 'undefined') {
        idleHandle = requestIdleCallback(run, { timeout: 8000 });
      } else {
        timeoutHandle = window.setTimeout(run, 500);
      }
    };

    void navigator.permissions
      ?.query({ name: 'camera' as PermissionName })
      .then((status) => {
        if (cancelled) return;
        if (status.state === 'granted') scheduleWarm();
        status.addEventListener('change', () => {
          if (!cancelled && status.state === 'granted') scheduleWarm();
        });
      })
      .catch(() => {
        /* no Permissions API — keep cold until user taps Enable */
      });

    return () => {
      cancelled = true;
      clearHandles();
    };
  }, [ensureCamera]);

  /** Warm native detector or WASM worker once per picking session */
  useEffect(() => {
    let cancelled = false;
    let worker: Worker | null = null;

    void (async () => {
      try {
        const native = await createNativeBarcodeDetector();
        if (cancelled) return;
        if (native) {
          setWarmEngines({ kind: 'native', detector: native });
          setEnginesReady(true);
          return;
        }

        worker = await spawnScannerWorker();
        if (cancelled) {
          worker.terminate();
          return;
        }
        setWarmEngines({ kind: 'worker', worker });
      } catch {
        if (!cancelled) setWarmEngines(null);
      } finally {
        if (!cancelled) setEnginesReady(true);
      }
    })();

    return () => {
      cancelled = true;
      worker?.terminate();
    };
  }, []);

  /** Stop camera after prolonged background */
  useEffect(() => {
    let hideTimer: number | null = null;

    const clearTimer = () => {
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
      }
    };

    const onVisibility = () => {
      clearTimer();
      if (document.hidden) {
        hideTimer = window.setTimeout(() => {
          hideTimer = null;
          releaseCameraTracks();
        }, 30000);
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clearTimer();
    };
  }, [releaseCameraTracks]);

  /** Release tracks when tearing down CameraProvider (engine worker cleanup is above) */
  useEffect(() => () => releaseCameraTracks(), [releaseCameraTracks]);

  const value = useMemo<PickingCameraContextValue>(
    () => ({
      stream,
      enginesReady,
      warmEngines,
      ensureCamera,
      releaseCameraTracks,
    }),
    [stream, enginesReady, warmEngines, ensureCamera, releaseCameraTracks],
  );

  return (
    <PickingCameraContext.Provider value={value}>{children}</PickingCameraContext.Provider>
  );
}
