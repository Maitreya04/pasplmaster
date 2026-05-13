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
import {
  classifyScanPayload,
  normalizeScanCode,
} from '../../lib/scanner/qrPayload';

type BarcodeDetectorResult = {
  rawValue?: string | null;
  format?: string;
  boundingBox?: DOMRectReadOnly;
  cornerPoints?: ReadonlyArray<{ x: number; y: number }>;
};

type BarcodeDetectorLike = {
  detect(source: HTMLVideoElement): Promise<BarcodeDetectorResult[]>;
};

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;
type BarcodeDetectorStatic = BarcodeDetectorCtor & {
  getSupportedFormats?: () => Promise<string[]>;
};

const SCAN_LOOP_DELAY_MS = 70;
const AUTO_RETRY_DELAY_MS = 1000;
const RESET_COOLDOWN_MS = 350;
const STABLE_SCAN_MIN_FRAMES = 2;
const STABLE_SCAN_TTL_MS = 600;
const REQUESTED_BARCODE_FORMATS = [
  'qr_code',
  'code_128',
  'code_39',
  'code_93',
  'codabar',
  'data_matrix',
  'ean_13',
  'ean_8',
  'itf',
  'upc_a',
  'upc_e',
];

function isLikelyPartNumber(raw: string): boolean {
  const value = raw.trim().toUpperCase();
  if (!value) return false;
  if (value.length < 4 || value.length > 36) return false;
  if (/\n/.test(value)) return false;
  if (/\b(?:MRP|QTY|COMMODITY|NUMBER OF|PACKED)\b/.test(value)) return false;
  if (/^[A-Z0-9][A-Z0-9.\-/]{3,}$/.test(value) && /[A-Z]/.test(value) && /\d/.test(value)) {
    return true;
  }
  if (/^\d{6,18}$/.test(value)) return true;
  return false;
}

function scoreDetectedValue(raw: string, format: string | undefined, collectMode: boolean): number {
  let score = 0;
  const normalizedFormat = (format ?? '').toLowerCase();
  const trimmed = raw.trim();

  if (!trimmed) return -1000;
  if (collectMode && normalizedFormat === 'qr_code') score -= 8;
  if (normalizedFormat === 'code_128') score += 12;
  if (normalizedFormat === 'code_39' || normalizedFormat === 'code_93') score += 8;
  if (normalizedFormat === 'ean_13' || normalizedFormat === 'upc_a' || normalizedFormat === 'upc_e') score += 6;
  if (isLikelyPartNumber(trimmed)) score += 20;
  if (trimmed.length > 26) score -= 4;
  if (/\s{2,}/.test(trimmed)) score -= 3;
  if (/\n/.test(trimmed)) score -= 6;
  return score;
}

function getBoundingBoxArea(entry: BarcodeDetectorResult): number | null {
  const bbox = entry.boundingBox;
  if (bbox && Number.isFinite(bbox.width) && Number.isFinite(bbox.height) && bbox.width > 0 && bbox.height > 0) {
    return bbox.width * bbox.height;
  }
  return null;
}

function scoreSpatialPriority(
  entry: BarcodeDetectorResult,
  video: HTMLVideoElement,
): number {
  const area = getBoundingBoxArea(entry);
  if (!area || video.videoWidth <= 0 || video.videoHeight <= 0) return 0;

  // Bias toward smaller symbols while preferring candidates near center to reduce accidental side picks.
  const frameArea = video.videoWidth * video.videoHeight;
  const areaRatio = Math.min(1, Math.max(0, area / frameArea));
  const sizeScore = (1 - areaRatio) * 30;

  const bbox = entry.boundingBox;
  if (!bbox) return sizeScore;
  const centerX = bbox.x + bbox.width / 2;
  const centerY = bbox.y + bbox.height / 2;
  const dx = (centerX - video.videoWidth / 2) / (video.videoWidth / 2);
  const dy = (centerY - video.videoHeight / 2) / (video.videoHeight / 2);
  const distance = Math.min(1, Math.sqrt(dx * dx + dy * dy));
  const centerScore = (1 - distance) * 12;

  return sizeScore + centerScore;
}

function pickBestDetectedRawValue(
  codes: BarcodeDetectorResult[],
  collectMode: boolean,
  video: HTMLVideoElement,
): string | null {
  const candidates = codes
    .map((code) => ({
      rawValue: typeof code.rawValue === 'string' ? code.rawValue.trim() : '',
      format: code.format,
      scoreBoost: scoreSpatialPriority(code, video),
    }))
    .filter((entry) => entry.rawValue.length > 0);

  if (candidates.length === 0) return null;

  let best = candidates[0];
  let bestScore = scoreDetectedValue(best.rawValue, best.format, collectMode) + best.scoreBoost;

  for (let i = 1; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const score = scoreDetectedValue(candidate.rawValue, candidate.format, collectMode) + candidate.scoreBoost;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best.rawValue;
}

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
  codeType: 'rack' | 'pack' | 'lpn' | 'sku' | 'unknown';
  suggestedQty: number;
  requiresBreakConfirmation: boolean;
  lpnCode?: string | null;
}

interface LiveQrScannerProps {
  title?: string;
  eyebrow?: string;
  helpText?: string;
  idleStatus?: string;
  mode?: 'verify' | 'collect';
  pickItem?: LiveQrScannerPickItem;
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

function extractNumericCandidates(values: Array<string | null | undefined>): number[] {
  const out = new Set<number>();
  for (const value of values) {
    if (!value) continue;
    const digits = value.replace(/[^\d]/g, '');
    if (!digits) continue;
    const parsed = Number(digits);
    if (Number.isFinite(parsed) && parsed > 0) out.add(parsed);
  }
  return [...out];
}

function vibrate(pattern: number | number[]) {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  navigator.vibrate(pattern);
}



export function LiveQrScanner({
  title,
  eyebrow,
  helpText,
  idleStatus,
  mode = 'verify',
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
  const stableScanRef = useRef<{ rawValue: string | null; count: number; updatedAt: number }>({
    rawValue: null,
    count: 0,
    updatedAt: 0,
  });
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
  const collectMode = mode === 'collect';
  const scannerPickItem = useMemo<LiveQrScannerPickItem>(
    () =>
      pickItem ?? {
        itemId: -1,
        name: title ?? 'Cycle count scanner',
        alias1: null,
        alias: null,
        itemCode: null,
        busyCode: null,
      },
    [pickItem, title],
  );

  const expectedCodes = useMemo(
    () =>
      collectMode
        ? []
        : uniqueCodes([scannerPickItem.alias1, scannerPickItem.alias, scannerPickItem.itemCode]),
    [collectMode, scannerPickItem.alias1, scannerPickItem.alias, scannerPickItem.itemCode],
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
    if (scanTimerRef.current !== null) {
      window.clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    scanTimerRef.current = window.setTimeout(() => {
      void scan();
    }, SCAN_LOOP_DELAY_MS);
  }, []);

  const handleResolvedScan = useCallback((rawValue: string) => {
    const classified = classifyScanPayload(rawValue);
    const candidates = classified.normalizedCandidates;
    const packPayload = classified.packPayload;
    const lpnPayload = classified.lpnPayload;
    
    let matchesPickItem = false;
    let matchedBy: ScanMatchSource | null = null;
    let lookupCode: string | null = null;

    const busyCodeCandidates = extractNumericCandidates([
      scannerPickItem.alias1,
      scannerPickItem.alias,
      scannerPickItem.itemCode,
      scannerPickItem.busyCode != null ? String(scannerPickItem.busyCode) : null,
    ]);

    if (packPayload && busyCodeCandidates.includes(packPayload.busyCode)) {
      matchesPickItem = true;
      matchedBy = 'pack';
      lookupCode = String(packPayload.busyCode);
    } else {
      for (const code of candidates) {
        if (scannerPickItem.alias1 && normalizeScanCode(scannerPickItem.alias1) === code) {
          matchesPickItem = true; matchedBy = 'alias1'; lookupCode = code; break;
        }
        if (scannerPickItem.alias && normalizeScanCode(scannerPickItem.alias) === code) {
          matchesPickItem = true; matchedBy = 'alias'; lookupCode = code; break;
        }
        if (scannerPickItem.itemCode && normalizeScanCode(scannerPickItem.itemCode) === code) {
          matchesPickItem = true; matchedBy = 'item_code'; lookupCode = code; break;
        }
      }
    }

    const lookup = resolveScannedCatalogItem(rawValue);

    if (!matchesPickItem && lookup?.item.id === scannerPickItem.itemId) {
      matchesPickItem = true;
      matchedBy = lookup.source;
      lookupCode = lookup.code;
    }

    const result: LiveQrScannerResolved = {
      rawValue,
      matchedItem: matchesPickItem 
        ? (getScanCatalogItemById(scannerPickItem.itemId) ?? lookup?.item ?? null) 
        : (lookup?.item ?? null),
      matchedBy: matchesPickItem ? matchedBy : (lookup?.source ?? null),
      matchesPickItem,
      lookupCode: matchesPickItem
        ? lookupCode
        : (packPayload
          ? String(packPayload.busyCode)
          : lpnPayload?.busyCode != null
            ? String(lpnPayload.busyCode)
            : (lookup?.code ?? candidates[0] ?? null)),
      codeType: classified.kind,
      suggestedQty:
        classified.kind === 'pack'
          ? 1
          : classified.kind === 'lpn'
            ? Math.max(1, lpnPayload?.remainingQty ?? 1)
            : 1,
      requiresBreakConfirmation: false,
      lpnCode: lpnPayload?.lpnCode ?? null,
      reason: matchesPickItem
        ? matchedBy === 'pack'
          ? `Verified reusable ${packPayload?.packType} pack QR.`
          : `Verified against ${matchedBy}.`
        : !lookup
          ? 'QR decoded, but no catalog item matched alias1, alias, or item code.'
          : `Scanned ${lookup.item.name}, but the picker is expected to verify ${scannerPickItem.name}.`,
    };

    setLastScan(result);
    lockedRef.current = true;
    setCanReset(false);
    onResolved(result);

    if (collectMode) {
      vibrate(60);
      flashViewport('green');
      setErrorMessage(null);
      setStatus('Scan logged. Point at the next label...');
      window.setTimeout(() => {
        lockedRef.current = false;
        setCanReset(true);
        setStatus(idleStatus ?? 'Point the QR inside the frame');
        if (scanFrameRef.current) {
          scheduleScan(scanFrameRef.current);
        }
      }, RESET_COOLDOWN_MS);
      return;
    }

    window.setTimeout(() => {
      setCanReset(true);
    }, RESET_COOLDOWN_MS);

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
    setStatus(`Verification failed. Retrying in ${AUTO_RETRY_DELAY_MS / 1000}s...`);
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      lockedRef.current = false;
      setCanReset(true);
      setErrorMessage(null);
      setStatus('Point the QR inside the frame');
      if (scanFrameRef.current) {
        scheduleScan(scanFrameRef.current);
      }
    }, AUTO_RETRY_DELAY_MS);
  }, [
    flashViewport,
    collectMode,
    idleStatus,
    onResolved,
    scheduleScan,
    scannerPickItem.alias,
    scannerPickItem.alias1,
    scannerPickItem.busyCode,
    scannerPickItem.itemCode,
    scannerPickItem.itemId,
    scannerPickItem.name,
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
          const selectedRawValue = pickBestDetectedRawValue(barcodes, collectMode, video);
          if (selectedRawValue) {
            const now = Date.now();
            const state = stableScanRef.current;
            const isFresh = now - state.updatedAt <= STABLE_SCAN_TTL_MS;
            const isSame = isFresh && state.rawValue === selectedRawValue;
            stableScanRef.current = {
              rawValue: selectedRawValue,
              count: isSame ? state.count + 1 : 1,
              updatedAt: now,
            };
            if (stableScanRef.current.count >= STABLE_SCAN_MIN_FRAMES) {
              stableScanRef.current = { rawValue: null, count: 0, updatedAt: 0 };
              handleResolvedScan(selectedRawValue);
              return;
            }
          } else {
            stableScanRef.current = { rawValue: null, count: 0, updatedAt: 0 };
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
          const formats = supportedFormats
            ? REQUESTED_BARCODE_FORMATS.filter((format) => supportedFormats.includes(format))
            : REQUESTED_BARCODE_FORMATS;
          if (formats.length === 0) {
            useFallback = true;
          } else {
            engineRef.current = { type: 'native', detector: new Detector({ formats }) };
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
                const now = Date.now();
                const state = stableScanRef.current;
                const isFresh = now - state.updatedAt <= STABLE_SCAN_TTL_MS;
                const isSame = isFresh && state.rawValue === data.rawValue;
                stableScanRef.current = {
                  rawValue: data.rawValue,
                  count: isSame ? state.count + 1 : 1,
                  updatedAt: now,
                };
                if (stableScanRef.current.count >= STABLE_SCAN_MIN_FRAMES) {
                  stableScanRef.current = { rawValue: null, count: 0, updatedAt: 0 };
                  handleResolvedScan(data.rawValue);
                }
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

        setStatus(idleStatus ?? 'Point the QR inside the frame');
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
  }, [handleResolvedScan, idleStatus, onError, scheduleScan, stopScanner]);

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
    stableScanRef.current = { rawValue: null, count: 0, updatedAt: 0 };
    setErrorMessage(null);
    setLastScan(null);
    setStatus(idleStatus ?? 'Point the QR inside the frame');
    if (scanFrameRef.current) {
      scheduleScan(scanFrameRef.current);
    }
  }, [canReset, idleStatus, scheduleScan]);

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/95 text-white">
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">
              {eyebrow ?? (collectMode ? 'Cycle Count Scan' : 'Shelf Verification')}
            </p>
            <h2 className="mt-1 text-lg font-semibold leading-tight text-white">
              {title ?? scannerPickItem.name}
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
          {expectedCodes.length > 0 && (
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
          )}

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
              {helpText ??
                'Keep the phone steady, fill the frame with the QR, and use the torch in dim aisles. The scan verifies the decoded code against the preloaded alias1, alias, and item code maps, then checks that it matches the current pick item.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
