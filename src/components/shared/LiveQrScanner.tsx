import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CameraRotate, Lightning, WarningCircle } from '@phosphor-icons/react';
import {
  initializeItemScanIndex,
  resolveScannedCatalogItem,
  useItemScanIndexStore,
  getScanCatalogItemById,
  type ScanCatalogItem,
  type ScanMatchSource,
} from '../../stores/itemScanIndex';
import { collectQrLookupCandidates, normalizeScanCode, parsePackPickPayload } from '../../lib/scanner/qrPayload';

type BarcodeDetectorResult = {
  rawValue?: string | null;
};

type BarcodeDetectorLike = {
  detect(source: HTMLVideoElement): Promise<BarcodeDetectorResult[]>;
};

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;
type BarcodeDetectorStatic = BarcodeDetectorCtor & {
  getSupportedFormats?: () => Promise<string[]>;
};

type ScannerEnginePath =
  | { type: 'native'; detector: BarcodeDetectorLike }
  | {
      type: 'worker';
      worker: Worker;
      workerCanvas: HTMLCanvasElement;
      workerCtx: CanvasRenderingContext2D;
      pending: Set<number>;
    };

type CameraCapabilities = MediaTrackCapabilities & {
  torch?: boolean;
  zoom?: {
    min?: number;
    max?: number;
  };
};

export interface LiveQrScannerPickItem {
  itemId: number;
  name: string;
  alias1?: string | null;
  alias?: string | null;
  itemCode?: string | null;
  busyCode?: number | null;
}

export interface LiveQrScannerResolved {
  rawValue: string;
  matchedItem: ScanCatalogItem | null;
  matchedBy: ScanMatchSource | null;
  matchesPickItem: boolean;
  reason: string;
  lookupCode: string | null;
}

interface LiveQrScannerProps {
  title?: string;
  pickItem: LiveQrScannerPickItem;
  onClose: () => void;
  onResolved: (result: LiveQrScannerResolved) => void;
  onError: (message: string) => void;
}

function uniqueCodes(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    output.push(trimmed);
  }
  return output;
}

function vibrate(pattern: number | number[]) {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  navigator.vibrate(pattern);
}



export function LiveQrScanner({
  title,
  pickItem,
  onClose,
  onResolved,
  onError,
}: LiveQrScannerProps): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const engineRef = useRef<ScannerEnginePath | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const scanFrameRef = useRef<(() => Promise<void>) | null>(null);
  const completedRef = useRef(false);
  const lockedRef = useRef(false);
  const [status, setStatus] = useState('Loading scanner...');
  const [supportMessage, setSupportMessage] = useState<string | null>(null);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchActive, setTorchActive] = useState(false);
  const [canReset, setCanReset] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<LiveQrScannerResolved | null>(null);
  const [flashColor, setFlashColor] = useState<'green' | 'red' | null>(null);
  const scanIndexStatus = useItemScanIndexStore((state) => state.status);
  const scanIndexError = useItemScanIndexStore((state) => state.error);

  const expectedCodes = useMemo(
    () => uniqueCodes([pickItem.alias1, pickItem.alias, pickItem.itemCode]),
    [pickItem.alias1, pickItem.alias, pickItem.itemCode],
  );

  const stopScanner = useCallback(() => {
    if (scanTimerRef.current !== null) {
      window.clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (engineRef.current?.type === 'worker') {
      engineRef.current.worker.terminate();
    }
    engineRef.current = null;
  }, []);

  const flashViewport = useCallback((color: 'green' | 'red') => {
    setFlashColor(color);
    window.setTimeout(() => {
      setFlashColor((current) => (current === color ? null : current));
    }, 220);
  }, []);

  const scheduleScan = useCallback((scan: () => Promise<void>) => {
    scanTimerRef.current = window.setTimeout(() => {
      void scan();
    }, 90);
  }, []);

  const handleResolvedScan = useCallback((rawValue: string) => {
    const candidates = collectQrLookupCandidates(rawValue);
    const packPayload = parsePackPickPayload(rawValue);
    
    let matchesPickItem = false;
    let matchedBy: ScanMatchSource | null = null;
    let lookupCode: string | null = null;

    if (packPayload && pickItem.busyCode != null && Number(pickItem.busyCode) === packPayload.busyCode) {
      matchesPickItem = true;
      matchedBy = 'pack';
      lookupCode = String(packPayload.busyCode);
    } else {
      for (const code of candidates) {
        if (pickItem.alias1 && normalizeScanCode(pickItem.alias1) === code) {
          matchesPickItem = true; matchedBy = 'alias1'; lookupCode = code; break;
        }
        if (pickItem.alias && normalizeScanCode(pickItem.alias) === code) {
          matchesPickItem = true; matchedBy = 'alias'; lookupCode = code; break;
        }
        if (pickItem.itemCode && normalizeScanCode(pickItem.itemCode) === code) {
          matchesPickItem = true; matchedBy = 'item_code'; lookupCode = code; break;
        }
      }
    }

    const lookup = resolveScannedCatalogItem(rawValue);

    if (!matchesPickItem && lookup?.item.id === pickItem.itemId) {
      matchesPickItem = true;
      matchedBy = lookup.source;
      lookupCode = lookup.code;
    }

    const result: LiveQrScannerResolved = {
      rawValue,
      matchedItem: matchesPickItem 
        ? (getScanCatalogItemById(pickItem.itemId) ?? lookup?.item ?? null) 
        : (lookup?.item ?? null),
      matchedBy: matchesPickItem ? matchedBy : (lookup?.source ?? null),
      matchesPickItem,
      lookupCode: matchesPickItem ? lookupCode : (lookup?.code ?? null),
      reason: matchesPickItem
        ? matchedBy === 'pack'
          ? `Verified reusable ${packPayload?.packType} pack QR.`
          : `Verified against ${matchedBy}.`
        : !lookup
          ? 'QR decoded, but no catalog item matched alias1, alias, or item code.'
          : `Scanned ${lookup.item.name}, but the picker is expected to verify ${pickItem.name}.`,
    };

    setLastScan(result);
    lockedRef.current = true;
    setCanReset(false);
    onResolved(result);

    window.setTimeout(() => {
      setCanReset(true);
    }, 400);

    if (matchesPickItem) {
      completedRef.current = true;
      stopScanner();
      vibrate(100);
      flashViewport('green');
      setErrorMessage(null);
      setStatus('Shelf verified');
      return;
    }

    vibrate([100, 50, 100]);
    flashViewport('red');
    setErrorMessage(result.reason);
    setStatus('Verification failed. Trying again...');
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      lockedRef.current = false;
      setCanReset(true);
      setStatus('Point the QR inside the frame');
      if (scanFrameRef.current) {
        scheduleScan(scanFrameRef.current);
      }
    }, 900);
  }, [
    flashViewport,
    onResolved,
    pickItem.alias,
    pickItem.alias1,
    pickItem.busyCode,
    pickItem.itemCode,
    pickItem.itemId,
    pickItem.name,
    scheduleScan,
    stopScanner,
  ]);

  useEffect(() => {
    let cancelled = false;

    const scanFrame = async () => {
      if (cancelled || completedRef.current || lockedRef.current) return;
      const engine = engineRef.current;
      const video = videoRef.current;

      if (!engine || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        scheduleScan(scanFrame);
        return;
      }

      try {
        if (engine.type === 'native') {
          const barcodes = await engine.detector.detect(video);
          const qr = barcodes.find((code) => typeof code.rawValue === 'string' && code.rawValue.trim());
          if (qr?.rawValue) {
            handleResolvedScan(qr.rawValue);
            return;
          }
        } else if (engine.type === 'worker') {
          if (engine.pending.size < 2) {
            const { videoWidth, videoHeight } = video;
            if (videoWidth > 0 && videoHeight > 0) {
              if (engine.workerCanvas.width !== videoWidth || engine.workerCanvas.height !== videoHeight) {
                engine.workerCanvas.width = videoWidth;
                engine.workerCanvas.height = videoHeight;
              }
              engine.workerCtx.drawImage(video, 0, 0, videoWidth, videoHeight);
              const imageData = engine.workerCtx.getImageData(0, 0, videoWidth, videoHeight);
              const frameId = Date.now();
              engine.pending.add(frameId);
              engine.worker.postMessage({ type: 'scan', frameId, imageData }, [imageData.data.buffer]);
            }
          }
        }
      } catch (error) {
        console.error('QR scan failed:', error);
      }

      scheduleScan(scanFrame);
    };
    scanFrameRef.current = scanFrame;

    const startScanner = async () => {
      try {
        setStatus('Loading item scan index...');
        await initializeItemScanIndex();
        if (cancelled) return;

        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera access is not available on this device.');
        }

        const Detector = (window as Window & typeof globalThis & {
          BarcodeDetector?: BarcodeDetectorStatic;
        }).BarcodeDetector;

        let useFallback = false;
        if (Detector) {
          const supportedFormats = await Detector.getSupportedFormats?.();
          if (supportedFormats && !supportedFormats.includes('qr_code')) {
            useFallback = true;
          } else {
            engineRef.current = { type: 'native', detector: new Detector({ formats: ['qr_code'] }) };
          }
        } else {
          useFallback = true;
        }

        if (useFallback) {
          const worker = new Worker(new URL('../../workers/qrScanner.worker', import.meta.url), { type: 'module' });
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) {
            setSupportMessage('Canvas 2D context is required for QR scanning.');
            setStatus('Live QR is not available in this browser');
            return;
          }
          engineRef.current = { type: 'worker', worker, workerCanvas: canvas, workerCtx: ctx, pending: new Set() };
          
          worker.onmessage = (event) => {
            const data = event.data;
            if (data.type === 'scan-result') {
              const engine = engineRef.current;
              if (engine?.type === 'worker') {
                engine.pending.delete(data.frameId);
              }
              if (data.rawValue && !cancelled && !completedRef.current && !lockedRef.current) {
                handleResolvedScan(data.rawValue);
              }
            } else if (data.type === 'error') {
              console.error('QR Worker error:', data.message);
              const engine = engineRef.current;
              if (engine?.type === 'worker') {
                engine.pending.clear();
              }
            }
          };
        }

        setStatus('Starting camera...');

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) {
          throw new Error('Scanner video element is not available.');
        }

        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        await video.play();

        const track = stream.getVideoTracks()[0];
        const capabilities = (track.getCapabilities?.() ?? {}) as CameraCapabilities;
        setTorchAvailable(Boolean(capabilities.torch));

        try {
          const advanced: Record<string, unknown> = {
            focusMode: 'continuous',
            exposureMode: 'continuous',
            whiteBalanceMode: 'continuous',
          };
          if (capabilities.zoom?.max && capabilities.zoom.max > 1) {
            advanced.zoom = Math.min(2, capabilities.zoom.max);
          }
          await track.applyConstraints({
            advanced: [advanced as MediaTrackConstraintSet],
          });
        } catch {
          // Best effort only.
        }

        setStatus('Point the QR inside the frame');
        scheduleScan(scanFrame);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not start the QR scanner.';
        setStatus('Scanner unavailable');
        setErrorMessage(message);
        onError(message);
      }
    };

    void startScanner();

    return () => {
      cancelled = true;
      scanFrameRef.current = null;
      stopScanner();
    };
  }, [handleResolvedScan, onError, scheduleScan, stopScanner]);

  useEffect(() => {
    if (scanIndexStatus !== 'error' || !scanIndexError) return;
    setErrorMessage(scanIndexError);
    setStatus('Scanner unavailable');
  }, [scanIndexError, scanIndexStatus]);

  const handleClose = useCallback(() => {
    stopScanner();
    onClose();
  }, [onClose, stopScanner]);

  const handleTorchToggle = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;

    const nextTorchState = !torchActive;
    try {
      await track.applyConstraints({
        advanced: [{ torch: nextTorchState } as MediaTrackConstraintSet],
      });
      setTorchActive(nextTorchState);
    } catch {
      setStatus('Torch control is not available on this camera.');
    }
  }, [torchActive]);

  const handleReset = useCallback(() => {
    if (!canReset) return;
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    completedRef.current = false;
    lockedRef.current = false;
    setErrorMessage(null);
    setLastScan(null);
    setStatus('Point the QR inside the frame');
    if (scanFrameRef.current) {
      scheduleScan(scanFrameRef.current);
    }
  }, [canReset, scheduleScan]);

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/95 text-white">
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">
              Shelf Verification
            </p>
            <h2 className="mt-1 text-lg font-semibold leading-tight text-white">
              {title ?? pickItem.name}
            </h2>
            <p className="mt-1 text-sm text-slate-300">{status}</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-full border border-white/20 px-3 py-2 text-sm font-medium text-white/90"
          >
            Close
          </button>
        </div>

        <div className="px-4">
          <div className="relative overflow-hidden rounded-[28px] border border-white/15 bg-black">
            {supportMessage ? (
              <div className="flex aspect-[3/4] w-full items-center justify-center bg-slate-950 p-5">
                <div className="max-w-sm rounded-[24px] border border-amber-400/20 bg-amber-400/10 p-5 text-left">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200/80">
                    Browser Limitation
                  </p>
                  <p className="mt-3 text-base font-semibold text-white">
                    Fast live QR scanning is not available here
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-amber-50/90">
                    {supportMessage}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className="aspect-[3/4] w-full object-cover"
                />
                <div className="pointer-events-none absolute inset-0 p-5">
                  <div className="h-full rounded-[24px] border-2 border-emerald-400/90 shadow-[0_0_0_9999px_rgba(2,6,23,0.28)]" />
                </div>
                {flashColor && (
                  <div
                    className={`pointer-events-none absolute inset-0 transition-opacity duration-200 ${
                      flashColor === 'green' ? 'bg-emerald-400/30' : 'bg-red-500/25'
                    }`}
                  />
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <div className="flex flex-wrap gap-2">
            {expectedCodes.map((code) => (
              <span
                key={code}
                className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 font-mono text-xs text-emerald-100"
              >
                {code}
              </span>
            ))}
          </div>

          {errorMessage && (
            <div className="rounded-2xl border border-red-400/25 bg-red-500/10 p-4 text-sm text-red-50">
              <div className="flex items-start gap-3">
                <WarningCircle size={18} weight="fill" className="mt-0.5 shrink-0 text-red-200" />
                <div className="min-w-0">
                  <p className="font-semibold text-white">Verification failed</p>
                  <p className="mt-1 leading-relaxed">{errorMessage}</p>
                  {lastScan?.matchedItem && (
                    <p className="mt-2 text-xs text-red-100/90">
                      Scanned item: {lastScan.matchedItem.name}
                    </p>
                  )}
                  {lastScan?.rawValue && (
                    <p className="mt-2 break-all font-mono text-xs text-red-100/90">
                      Payload: {lastScan.rawValue}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={handleTorchToggle}
              disabled={!torchAvailable || Boolean(supportMessage)}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white/10 text-sm font-semibold text-white disabled:opacity-40"
            >
              <Lightning size={18} weight="fill" />
              {torchActive ? 'Torch On' : 'Torch Off'}
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={!lockedRef.current || !canReset || Boolean(supportMessage)}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white/10 text-sm font-semibold text-white disabled:opacity-40"
            >
              <CameraRotate size={18} weight="bold" />
              Scan Again
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="flex h-12 items-center justify-center rounded-2xl bg-white/10 text-sm font-semibold text-white"
            >
              Cancel
            </button>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
            <p className="font-semibold text-white">Best results</p>
            <p className="mt-2 leading-relaxed">
              Keep the phone steady, fill the frame with the QR, and use the torch in dim aisles.
              The scan verifies the decoded code against the preloaded alias1, alias, and item code
              maps, then checks that it matches the current pick item.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
