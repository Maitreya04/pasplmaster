import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CameraRotate,
  CheckCircle,
  HandGrabbing,
  HandPalm,
  Lightning,
  Package,
  SpeakerSimpleHigh,
  SpeakerSimpleSlash,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
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
import type { UomTier } from '../../lib/scanner/uomMapper';
import { resolveScanToUom } from '../../lib/scanner/uomMapper';
import {
  captureRoiBitmap,
  captureRoiImageData,
  getNextRoiLevel,
} from '../../lib/scanner/roiProcessor';
import type { BarcodeDetectorLike, BarcodeDetectorResult } from '../../context/CameraContext';
import { useOptionalPickingCamera } from '../../context/CameraContext';
import { REQUESTED_BARCODE_FORMATS } from '../../lib/scanner/barcodeFormats';
import { detectScannerPlatform } from '../../lib/scanner/scannerPlatform';
import {
  acquireCameraStream,
  applyContinuousCameraEnhancements,
} from '../../lib/scanner/acquireCamera';
import {
  getScannerFeedbackPrefs,
  playErrorBuzz,
  playSuccessBeep,
  setScannerFeedbackPrefs,
  vibrateIfEnabled,
} from '../../lib/scanner/feedback';

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;
type BarcodeDetectorStatic = BarcodeDetectorCtor & {
  getSupportedFormats?: () => Promise<string[]>;
};

const NATIVE_SCAN_INTERVAL_MS = 33;
const WORKER_SCAN_INTERVAL_MS = 33;
const BURST_SCAN_INTERVAL_MS = 16;
const BURST_WINDOW_MS = 700;
const WORKER_MAX_PENDING_FRAMES = 2;
const ROI_MAX_LONG_EDGE_NATIVE = 1280;
const ROI_MAX_LONG_EDGE_WORKER = 800;
const AUTO_RETRY_DELAY_MS = 1000;
const RESET_COOLDOWN_MS = 350;
const STABLE_SCAN_MIN_FRAMES = 1;
const STABLE_SCAN_TTL_MS = 600;
const LAST_PAYLOAD_DEBOUNCE_MS = 1200;

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

interface PickedDetectedValue {
  rawValue: string;
  format?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

interface DisplayBox {
  left: number;
  top: number;
  width: number;
  height: number;
  areaRatio: number;
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
): PickedDetectedValue | null {
  const candidates = codes
    .map((code) => ({
      rawValue: typeof code.rawValue === 'string' ? code.rawValue.trim() : '',
      format: code.format,
      boundingBox: code.boundingBox,
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

  return best;
}

function mapBoundingBoxToDisplay(entry: PickedDetectedValue, video: HTMLVideoElement): DisplayBox | null {
  const bbox = entry.boundingBox;
  if (!bbox || video.videoWidth <= 0 || video.videoHeight <= 0) return null;

  const rect = video.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const coverScale = Math.max(rect.width / video.videoWidth, rect.height / video.videoHeight);
  const renderedWidth = video.videoWidth * coverScale;
  const renderedHeight = video.videoHeight * coverScale;
  const offsetX = (rect.width - renderedWidth) / 2;
  const offsetY = (rect.height - renderedHeight) / 2;

  return {
    left: offsetX + bbox.x * coverScale,
    top: offsetY + bbox.y * coverScale,
    width: bbox.width * coverScale,
    height: bbox.height * coverScale,
    areaRatio: (bbox.width * bbox.height) / (video.videoWidth * video.videoHeight),
  };
}

function projectRoiPickToVideo(
  picked: PickedDetectedValue,
  capture: { sourceCrop: { sx: number; sy: number; sw: number; sh: number }; bitmap: ImageBitmap },
): PickedDetectedValue {
  const bbox = picked.boundingBox;
  if (!bbox) return picked;

  const scaleX = capture.sourceCrop.sw / capture.bitmap.width;
  const scaleY = capture.sourceCrop.sh / capture.bitmap.height;
  return {
    ...picked,
    boundingBox: {
      x: capture.sourceCrop.sx + bbox.x * scaleX,
      y: capture.sourceCrop.sy + bbox.y * scaleY,
      width: bbox.width * scaleX,
      height: bbox.height * scaleY,
    },
  };
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
  /** UoM mapper (resolve_scan_to_uom); EA counts for inventory/billing. */
  uomTier: UomTier | null;
  baseQtyEa: number | null;
  packetQtyEa: number | null;
  packetsPerBox: number | null;
  uomSource: string | null;
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
  const scanAnimationRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const scanFrameRef = useRef<(() => void) | null>(null);
  const scanInFlightRef = useRef(false);
  const lastScanAtRef = useRef(0);
  const scanSequenceRef = useRef(0);
  const burstUntilRef = useRef(0);
  const noHitFrameCountRef = useRef(0);
  const maxZoomRef = useRef<number | null>(null);
  const currentZoomRef = useRef<number | null>(null);
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
  const [zoomLevel, setZoomLevel] = useState<number | null>(null);
  const [detectedBox, setDetectedBox] = useState<DisplayBox | null>(null);
  const [canReset, setCanReset] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<LiveQrScannerResolved | null>(null);
  const [flashColor, setFlashColor] = useState<'green' | 'red' | null>(null);
  const [sheetState, setSheetState] = useState<'hidden' | 'open' | 'closing'>('hidden');
  const [scanCount, setScanCount] = useState(0);
  const sheetDismissTimerRef = useRef<number | null>(null);
  const sheetAnimFrameRef = useRef<number | null>(null);
  const scanIndexStatus = useItemScanIndexStore((state) => state.status);
  const scanIndexError = useItemScanIndexStore((state) => state.error);
  const pickingCamera = useOptionalPickingCamera();
  const pickingCameraRef = useRef(pickingCamera);

  useEffect(() => {
    pickingCameraRef.current = pickingCamera;
  });

  const lastFiredPayloadRef = useRef<{ key: string; at: number } | null>(null);

  const [feedbackSoundEnabled, setFeedbackSoundEnabled] = useState(() => getScannerFeedbackPrefs().sound);
  const [feedbackHapticsEnabled, setFeedbackHapticsEnabled] = useState(() => getScannerFeedbackPrefs().haptics);

  const toggleFeedbackSound = useCallback(() => {
    const next = !getScannerFeedbackPrefs().sound;
    setScannerFeedbackPrefs({ sound: next });
    setFeedbackSoundEnabled(next);
  }, []);

  const toggleFeedbackHaptics = useCallback(() => {
    const next = !getScannerFeedbackPrefs().haptics;
    setScannerFeedbackPrefs({ haptics: next });
    setFeedbackHapticsEnabled(next);
  }, []);

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
    if (scanAnimationRef.current !== null) {
      cancelAnimationFrame(scanAnimationRef.current);
      scanAnimationRef.current = null;
    }
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (sheetDismissTimerRef.current !== null) {
      window.clearTimeout(sheetDismissTimerRef.current);
      sheetDismissTimerRef.current = null;
    }
    if (sheetAnimFrameRef.current !== null) {
      cancelAnimationFrame(sheetAnimFrameRef.current);
      sheetAnimFrameRef.current = null;
    }

    const sharedCameraSession = pickingCameraRef.current != null;

    if (!sharedCameraSession && streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    const engine = engineRef.current;
    if (engine?.type === 'worker') {
      if (!sharedCameraSession) {
        engine.worker.terminate();
      } else {
        engine.worker.onmessage = null;
      }
    }

    scanInFlightRef.current = false;
    engineRef.current = null;
    const video = videoRef.current;
    if (video) video.srcObject = null;
  }, []);

  const flashViewport = useCallback((color: 'green' | 'red') => {
    setFlashColor(color);
    window.setTimeout(() => {
      setFlashColor((current) => (current === color ? null : current));
    }, 220);
  }, []);

  const scheduleScan = useCallback((scan: () => void) => {
    scanFrameRef.current = scan;
    if (scanAnimationRef.current !== null) return;

    const loop = (timestamp: number) => {
      const activeScan = scanFrameRef.current;
      if (!activeScan) {
        scanAnimationRef.current = null;
        return;
      }

      const engine = engineRef.current;
      const baseInterval = engine?.type === 'worker' ? WORKER_SCAN_INTERVAL_MS : NATIVE_SCAN_INTERVAL_MS;
      const interval = Date.now() < burstUntilRef.current ? BURST_SCAN_INTERVAL_MS : baseInterval;
      if (!scanInFlightRef.current && timestamp - lastScanAtRef.current >= interval) {
        lastScanAtRef.current = timestamp;
        activeScan();
      }

      scanAnimationRef.current = requestAnimationFrame(loop);
    };

    scanAnimationRef.current = requestAnimationFrame(loop);
  }, []);

  const applyCameraZoom = useCallback(async (targetZoom: number) => {
    const track = streamRef.current?.getVideoTracks()[0];
    const maxZoom = maxZoomRef.current;
    if (!track || !maxZoom || maxZoom <= 1) return false;

    const nextZoom = Math.max(1, Math.min(maxZoom, targetZoom));
    try {
      await track.applyConstraints({
        advanced: [{ zoom: nextZoom } as MediaTrackConstraintSet],
      });
      currentZoomRef.current = nextZoom;
      setZoomLevel(nextZoom);
      return true;
    } catch {
      return false;
    }
  }, []);

  const nudgeZoomForTinyCodes = useCallback((areaRatio?: number) => {
    const maxZoom = maxZoomRef.current;
    if (!maxZoom || maxZoom <= 1) return;

    const currentZoom = currentZoomRef.current ?? 1;
    const shouldZoomForBox = areaRatio != null && areaRatio > 0 && areaRatio < 0.025;
    const shouldZoomForMisses = noHitFrameCountRef.current >= 18;
    if (!shouldZoomForBox && !shouldZoomForMisses) return;
    if (currentZoom >= Math.min(maxZoom, 3)) return;

    void applyCameraZoom(Math.min(maxZoom, currentZoom + 0.5, 3));
    noHitFrameCountRef.current = 0;
  }, [applyCameraZoom]);

  const handleResolvedScan = useCallback(async (rawValue: string) => {
    const debounceKey = normalizeScanCode(rawValue) || rawValue.trim();
    const debounceNow = Date.now();
    const prevFire = lastFiredPayloadRef.current;
    if (
      prevFire &&
      prevFire.key === debounceKey &&
      debounceNow - prevFire.at < LAST_PAYLOAD_DEBOUNCE_MS
    ) {
      return;
    }
    lastFiredPayloadRef.current = { key: debounceKey, at: debounceNow };

    const classified = classifyScanPayload(rawValue);
    const candidates = classified.normalizedCandidates;
    const packPayload = classified.packPayload;
    const lpnPayload = classified.lpnPayload;

    const uomResolved = await resolveScanToUom(rawValue);

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

    const uomTier = uomResolved.tier;
    const baseQtyEa = uomResolved.baseQtyEa;
    const packetQtyEa = uomResolved.packetQtyEa;
    const packetsPerBox = uomResolved.packetsPerBox;
    const uomSource = uomResolved.source;

    const suggestedQty =
      uomResolved.matched &&
      baseQtyEa != null &&
      Number.isFinite(baseQtyEa) &&
      baseQtyEa >= 1
        ? Math.floor(baseQtyEa)
        : classified.kind === 'pack'
          ? 1
          : classified.kind === 'lpn'
            ? Math.max(1, lpnPayload?.remainingQty ?? 1)
            : 1;

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
      suggestedQty,
      requiresBreakConfirmation: false,
      lpnCode: lpnPayload?.lpnCode ?? null,
      uomTier,
      baseQtyEa,
      packetQtyEa,
      packetsPerBox,
      uomSource,
      reason: matchesPickItem
        ? matchedBy === 'pack'
          ? `Verified reusable ${packPayload?.packType} pack QR.`
          : `Verified against ${matchedBy}.`
        : !lookup
          ? 'QR decoded, but no catalog item matched alias1, alias, or item code.'
          : `Scanned ${lookup.item.name}, but the picker is expected to verify ${scannerPickItem.name}.`,
    };

    setLastScan(result);
    if (collectMode) {
      setScanCount((n) => n + 1);
      // Clear any pending auto-dismiss
      if (sheetDismissTimerRef.current !== null) {
        window.clearTimeout(sheetDismissTimerRef.current);
        sheetDismissTimerRef.current = null;
      }
      if (sheetAnimFrameRef.current !== null) {
        cancelAnimationFrame(sheetAnimFrameRef.current);
        sheetAnimFrameRef.current = null;
      }
      // Open sheet (mount first, then transition on next frame)
      setSheetState('open');
      // Auto-dismiss after 3 s
      sheetDismissTimerRef.current = window.setTimeout(() => {
        setSheetState('closing');
        sheetDismissTimerRef.current = window.setTimeout(() => {
          setSheetState('hidden');
        }, 340);
      }, 3000);
    }
    lockedRef.current = true;
    setCanReset(false);
    onResolved(result);

    if (collectMode) {
      vibrateIfEnabled(60);
      playSuccessBeep();
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
      vibrateIfEnabled(100);
      playSuccessBeep();
      flashViewport('green');
      setErrorMessage(null);
      setStatus('Shelf verified');
      return;
    }

    vibrateIfEnabled([100, 50, 100]);
    playErrorBuzz();
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

    const scanFrame = () => {
      if (cancelled || completedRef.current || lockedRef.current) return;
      const engine = engineRef.current;
      const video = videoRef.current;

      if (!engine || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        return;
      }

      scanInFlightRef.current = true;
      const frameNumber = scanSequenceRef.current + 1;
      scanSequenceRef.current = frameNumber;

      void (async () => {
        try {
          if (engine.type === 'native') {
            const roiLevel = getNextRoiLevel(frameNumber);
            let selected: PickedDetectedValue | null = null;
            let roiCapture: Awaited<ReturnType<typeof captureRoiBitmap>> = null;

            if (roiLevel !== 'full') {
              roiCapture = await captureRoiBitmap(video, roiLevel, {
                maxLongEdge: ROI_MAX_LONG_EDGE_NATIVE,
                upscale: roiLevel === 'tight' ? 1.8 : 1.25,
              });
              if (roiCapture) {
                const roiCodes = await engine.detector.detect(roiCapture.bitmap);
                const roiPick = pickBestDetectedRawValue(roiCodes, collectMode, video);
                selected = roiPick ? projectRoiPickToVideo(roiPick, roiCapture) : null;
                roiCapture.bitmap.close();
              }
            }

            if (!selected && roiLevel === 'full') {
              const barcodes = await engine.detector.detect(video);
              selected = pickBestDetectedRawValue(barcodes, collectMode, video);
            }

            if (selected) {
              noHitFrameCountRef.current = 0;
              burstUntilRef.current = Date.now() + BURST_WINDOW_MS;
              const box = mapBoundingBoxToDisplay(selected, video);
              setDetectedBox(box);
              nudgeZoomForTinyCodes(box?.areaRatio);

              const now = Date.now();
              const state = stableScanRef.current;
              const isFresh = now - state.updatedAt <= STABLE_SCAN_TTL_MS;
              const isSame = isFresh && state.rawValue === selected.rawValue;
              stableScanRef.current = {
                rawValue: selected.rawValue,
                count: isSame ? state.count + 1 : 1,
                updatedAt: now,
              };
              if (stableScanRef.current.count >= STABLE_SCAN_MIN_FRAMES) {
                stableScanRef.current = { rawValue: null, count: 0, updatedAt: 0 };
                void handleResolvedScan(selected.rawValue).catch(() => {
                  setErrorMessage('Could not resolve scan. Try again.');
                });
              }
            } else {
              noHitFrameCountRef.current += 1;
              if (noHitFrameCountRef.current % 6 === 0) setDetectedBox(null);
              nudgeZoomForTinyCodes();
              stableScanRef.current = { rawValue: null, count: 0, updatedAt: 0 };
            }
          } else if (engine.type === 'worker') {
            if (engine.pending.size < WORKER_MAX_PENDING_FRAMES) {
              const roiLevel = getNextRoiLevel(frameNumber);
              const capture = captureRoiImageData(video, engine.workerCanvas, engine.workerCtx, roiLevel, {
                maxLongEdge: ROI_MAX_LONG_EDGE_WORKER,
                upscale: roiLevel === 'tight' ? 1.65 : 1.1,
              });
              if (capture) {
                const frameId = Date.now();
                engine.pending.add(frameId);
                engine.worker.postMessage(
                  {
                    type: 'scan',
                    frameId,
                    imageData: capture.imageData,
                    roiLevel: capture.level,
                  },
                  [capture.imageData.data.buffer],
                );
              }
            }
          }
        } catch (error) {
          console.error('QR scan failed:', error);
        } finally {
          scanInFlightRef.current = false;
        }
      })();
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

        const attachWorkerOnMessage = (worker: Worker) => {
          worker.onmessage = (event) => {
            const data = event.data;
            if (data.type === 'scan-result') {
              const engineNow = engineRef.current;
              if (engineNow?.type === 'worker') {
                engineNow.pending.delete(data.frameId);
              }
              if (data.rawValue && !cancelled && !completedRef.current && !lockedRef.current) {
                noHitFrameCountRef.current = 0;
                burstUntilRef.current = Date.now() + BURST_WINDOW_MS;
                setDetectedBox(null);
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
                  void handleResolvedScan(data.rawValue).catch(() => {
                    setErrorMessage('Could not resolve scan. Try again.');
                  });
                }
              } else if (!data.rawValue) {
                noHitFrameCountRef.current += 1;
                if (noHitFrameCountRef.current % 8 === 0) {
                  setDetectedBox(null);
                  nudgeZoomForTinyCodes();
                }
              }
            } else if (data.type === 'error') {
              console.error('QR Worker error:', data.message);
              const engineNow = engineRef.current;
              if (engineNow?.type === 'worker') {
                engineNow.pending.clear();
              }
            }
          };
        };

        const pickingCtx = pickingCameraRef.current;
        if (pickingCtx) {
          const deadline = Date.now() + 10000;
          while (Date.now() < deadline && !cancelled) {
            if (pickingCameraRef.current?.enginesReady) break;
            await new Promise((r) => setTimeout(r, 40));
          }
          if (cancelled) return;

          const warm = pickingCameraRef.current?.warmEngines;
          if (!warm) {
            setSupportMessage('Scanner engine could not start in this browser.');
            setStatus('Live QR is not available in this browser');
            return;
          }

          setStatus('Starting camera...');
          const mediaStream = await pickingCtx.ensureCamera();
          if (cancelled) return;

          streamRef.current = mediaStream;

          if (warm.kind === 'native') {
            engineRef.current = { type: 'native', detector: warm.detector };
          } else {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) {
              setSupportMessage('Canvas 2D context is required for QR scanning.');
              setStatus('Live QR is not available in this browser');
              return;
            }
            engineRef.current = {
              type: 'worker',
              worker: warm.worker,
              workerCanvas: canvas,
              workerCtx: ctx,
              pending: new Set(),
            };
            attachWorkerOnMessage(warm.worker);
          }

          const video = videoRef.current;
          if (!video) {
            throw new Error('Scanner video element is not available.');
          }

          video.srcObject = mediaStream;
          video.setAttribute('playsinline', 'true');
          await video.play();

          const vtrack = mediaStream.getVideoTracks()[0];
          const capabilities = (vtrack.getCapabilities?.() ?? {}) as CameraCapabilities;
          setTorchAvailable(Boolean(capabilities.torch));
          maxZoomRef.current = capabilities.zoom?.max ?? null;

          const settings = vtrack.getSettings?.() as { zoom?: number };
          if (settings?.zoom != null && Number.isFinite(settings.zoom)) {
            currentZoomRef.current = settings.zoom;
            setZoomLevel(settings.zoom);
          } else if (capabilities.zoom?.max && capabilities.zoom.max > 1) {
            const initialZoom = Math.min(2.25, capabilities.zoom.max);
            currentZoomRef.current = initialZoom;
            setZoomLevel(initialZoom);
          }

          setStatus(idleStatus ?? 'Point the QR inside the frame');
          scheduleScan(scanFrame);
          return;
        }

        const Detector = (window as Window & typeof globalThis & {
          BarcodeDetector?: BarcodeDetectorStatic;
        }).BarcodeDetector;
        const platform = detectScannerPlatform();

        let useFallback = false;
        if (Detector) {
          const supportedFormats = await Detector.getSupportedFormats?.();
          const formats = supportedFormats
            ? REQUESTED_BARCODE_FORMATS.filter((format) => supportedFormats.includes(format))
            : [...REQUESTED_BARCODE_FORMATS];
          if (formats.length === 0 || !platform.preferNativeDetector) {
            useFallback = true;
          } else {
            engineRef.current = { type: 'native', detector: new Detector({ formats }) };
          }
        } else {
          useFallback = true;
        }

        if (useFallback) {
          const worker = new Worker(new URL('../../workers/qrScanner.worker', import.meta.url), {
            type: 'module',
          });
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) {
            setSupportMessage('Canvas 2D context is required for QR scanning.');
            setStatus('Live QR is not available in this browser');
            return;
          }
          engineRef.current = { type: 'worker', worker, workerCanvas: canvas, workerCtx: ctx, pending: new Set() };

          attachWorkerOnMessage(worker);
        }

        setStatus('Starting camera...');

        const { stream: legacyStream, track: legacyTrack } = await acquireCameraStream();

        if (cancelled) {
          legacyStream.getTracks().forEach((t) => t.stop());
          return;
        }

        await applyContinuousCameraEnhancements(legacyTrack);

        streamRef.current = legacyStream;
        const video = videoRef.current;
        if (!video) {
          throw new Error('Scanner video element is not available.');
        }

        video.srcObject = legacyStream;
        video.setAttribute('playsinline', 'true');
        await video.play();

        const capabilities = (legacyTrack.getCapabilities?.() ?? {}) as CameraCapabilities;
        setTorchAvailable(Boolean(capabilities.torch));
        maxZoomRef.current = capabilities.zoom?.max ?? null;

        try {
          const advanced: Record<string, unknown> = {
            focusMode: 'continuous',
            exposureMode: 'continuous',
            whiteBalanceMode: 'continuous',
          };
          if (capabilities.zoom?.max && capabilities.zoom.max > 1) {
            const initialZoom = Math.min(2.25, capabilities.zoom.max);
            advanced.zoom = initialZoom;
            currentZoomRef.current = initialZoom;
            setZoomLevel(initialZoom);
          }
          await legacyTrack.applyConstraints({
            advanced: [advanced as MediaTrackConstraintSet],
          });
        } catch {
          // Best effort only.
        }

        setStatus(idleStatus ?? 'Point the QR inside the frame');
        scheduleScan(scanFrame);
      } catch (error) {
        if (cancelled) return;
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
  }, [collectMode, handleResolvedScan, idleStatus, nudgeZoomForTinyCodes, onError, scheduleScan, stopScanner]);

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

  const handleZoomToggle = useCallback(() => {
    const maxZoom = maxZoomRef.current;
    if (!maxZoom || maxZoom <= 1) return;

    const currentZoom = currentZoomRef.current ?? 1;
    const zoomStops = [1, Math.min(2, maxZoom), Math.min(3, maxZoom)]
      .filter((value, index, values) => values.indexOf(value) === index);
    const currentIndex = zoomStops.findIndex((value) => Math.abs(value - currentZoom) < 0.2);
    const nextZoom = zoomStops[(currentIndex + 1) % zoomStops.length] ?? 1;
    void applyCameraZoom(nextZoom);
  }, [applyCameraZoom]);

  const dismissSheet = useCallback(() => {
    if (sheetDismissTimerRef.current !== null) {
      window.clearTimeout(sheetDismissTimerRef.current);
      sheetDismissTimerRef.current = null;
    }
    setSheetState('closing');
    sheetDismissTimerRef.current = window.setTimeout(() => {
      setSheetState('hidden');
    }, 340);
  }, []);

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

  const isMatched = Boolean(lastScan?.matchedItem);
  const sheetVisible = sheetState !== 'hidden';
  const sheetOpen = sheetState === 'open';

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950 text-white">
      <div className="flex h-full flex-col">

        {/* ── Header ── */}
        <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-[max(0.875rem,env(safe-area-inset-top))]">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
              {eyebrow ?? (collectMode ? 'Scan Mode' : 'Shelf Verification')}
            </p>
            <h2 className="mt-0.5 text-base font-semibold leading-tight text-white">
              {title ?? scannerPickItem.name}
            </h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {collectMode && scanCount > 0 && (
              <span className="rounded-full bg-emerald-500/20 px-2.5 py-1 text-xs font-semibold tabular-nums text-emerald-300">
                {scanCount} scanned
              </span>
            )}
            <button
              type="button"
              onClick={toggleFeedbackSound}
              aria-label={feedbackSoundEnabled ? 'Mute scan beep' : 'Enable scan beep'}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/8 text-white/70 active:scale-95"
              style={{ transition: 'transform 120ms ease-out' }}
            >
              {feedbackSoundEnabled ? (
                <SpeakerSimpleHigh size={17} weight="bold" />
              ) : (
                <SpeakerSimpleSlash size={17} weight="bold" />
              )}
            </button>
            <button
              type="button"
              onClick={toggleFeedbackHaptics}
              aria-label={feedbackHapticsEnabled ? 'Disable vibration' : 'Enable vibration'}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/8 text-white/70 active:scale-95 disabled:opacity-35"
              style={{ transition: 'transform 120ms ease-out' }}
            >
              {feedbackHapticsEnabled ? (
                <HandGrabbing size={17} weight="bold" />
              ) : (
                <HandPalm size={17} weight="bold" />
              )}
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/8 text-white/70 active:scale-95"
              style={{ transition: 'transform 120ms ease-out' }}
            >
              <X size={16} weight="bold" />
            </button>
          </div>
        </div>

        {/* ── Status line ── */}
        <p className="px-4 pb-2 text-xs text-slate-400">{status}</p>

        {/* ── Viewfinder ── */}
        <div className="flex-1 px-3 pb-3">
          <div className="relative h-full overflow-hidden rounded-[24px] border border-white/10 bg-black">
            {supportMessage ? (
              <div className="flex h-full items-center justify-center p-5">
                <div className="max-w-sm rounded-[20px] border border-amber-400/20 bg-amber-400/10 p-5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300/80">
                    Browser Limitation
                  </p>
                  <p className="mt-3 text-base font-semibold text-white">
                    Live scanning not available
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-amber-50/80">
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
                  className="h-full w-full object-cover"
                />
                {/* Aim guide */}
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="h-48 w-64 rounded-[20px] border-2 border-emerald-400/70 shadow-[0_0_0_9999px_rgba(2,6,23,0.35)]" />
                </div>
                {detectedBox && (
                  <div
                    className="pointer-events-none absolute rounded-xl border-2 border-emerald-300 shadow-[0_0_24px_rgba(52,211,153,0.45)]"
                    style={{
                      left: detectedBox.left,
                      top: detectedBox.top,
                      width: detectedBox.width,
                      height: detectedBox.height,
                      transition: 'all 90ms linear',
                    }}
                  />
                )}
                {/* Scan flash */}
                {flashColor && (
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background: flashColor === 'green'
                        ? 'rgba(52,211,153,0.22)'
                        : 'rgba(239,68,68,0.2)',
                      transition: 'opacity 180ms ease-out',
                    }}
                  />
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Controls ── */}
        <div className="space-y-3 px-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {expectedCodes.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-1">
              {expectedCodes.map((code) => (
                <span
                  key={code}
                  className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-0.5 font-mono text-xs text-emerald-200"
                >
                  {code}
                </span>
              ))}
            </div>
          )}

          {errorMessage && (
            <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-3 text-sm">
              <div className="flex items-start gap-2.5">
                <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-red-300" />
                <div className="min-w-0">
                  <p className="font-semibold text-white">Verification failed</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-red-200">{errorMessage}</p>
                  {lastScan?.matchedItem && (
                    <p className="mt-1 text-xs text-red-100/80">
                      Got: {lastScan.matchedItem.name}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-4 gap-2">
            <button
              type="button"
              onClick={handleTorchToggle}
              disabled={!torchAvailable || Boolean(supportMessage)}
              className={`flex h-11 items-center justify-center gap-1.5 rounded-2xl text-sm font-medium text-white disabled:opacity-35 ${
                torchActive ? 'bg-amber-400/25 text-amber-100' : 'bg-white/10'
              }`}
              style={{ transition: 'transform 120ms ease-out, opacity 120ms ease-out' }}
            >
              <Lightning size={16} weight="fill" />
              Torch
            </button>
            <button
              type="button"
              onClick={handleZoomToggle}
              disabled={!zoomLevel || Boolean(supportMessage)}
              className="flex h-11 items-center justify-center rounded-2xl bg-white/10 text-sm font-medium text-white disabled:opacity-35"
              style={{ transition: 'transform 120ms ease-out, opacity 120ms ease-out' }}
            >
              {zoomLevel ? `${zoomLevel.toFixed(zoomLevel % 1 === 0 ? 0 : 1)}x` : 'Zoom'}
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={!lockedRef.current || !canReset || Boolean(supportMessage)}
              className="flex h-11 items-center justify-center gap-1.5 rounded-2xl bg-white/10 text-sm font-medium text-white disabled:opacity-35"
              style={{ transition: 'transform 120ms ease-out, opacity 120ms ease-out' }}
            >
              <CameraRotate size={16} weight="bold" />
              Again
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="flex h-11 items-center justify-center rounded-2xl bg-white/10 text-sm font-medium text-white"
              style={{ transition: 'transform 120ms ease-out' }}
            >
              Done
            </button>
          </div>

          {!collectMode && (
            <p className="px-1 text-center text-xs leading-relaxed text-slate-500">
              {helpText ?? 'Steady, fill the frame, use torch in dim aisles.'}
            </p>
          )}
        </div>
      </div>

      {/* ── Collect-mode result bottom sheet ── */}
      {collectMode && sheetVisible && lastScan && (
        <>
          {/* Scrim */}
          <div
            className="absolute inset-0 bg-slate-950/50"
            style={{
              opacity: sheetOpen ? 1 : 0,
              transition: 'opacity 280ms cubic-bezier(0.32, 0.72, 0, 1)',
            }}
            onClick={dismissSheet}
          />

          {/* Sheet */}
          <div
            className="absolute inset-x-0 bottom-0"
            style={{
              transform: sheetOpen ? 'translateY(0)' : 'translateY(100%)',
              transition: 'transform 340ms cubic-bezier(0.32, 0.72, 0, 1)',
            }}
          >
            <div className="rounded-t-[28px] border-t border-x border-white/10 bg-slate-900 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">
              {/* Drag handle */}
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />

              {/* Auto-dismiss progress bar — keyed on scan count so animation restarts each scan */}
              <div
                key={scanCount}
                className="mb-4 h-0.5 w-full overflow-hidden rounded-full bg-white/10"
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    background: isMatched ? 'rgb(52,211,153)' : 'rgb(251,191,36)',
                    transformOrigin: 'left center',
                    animation: 'shrinkX 3000ms linear forwards',
                  }}
                />
              </div>

              {/* Icon + status label */}
              <div className="flex items-center gap-2 mb-3">
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                    isMatched ? 'bg-emerald-500/20' : 'bg-amber-400/20'
                  }`}
                >
                  {isMatched ? (
                    <CheckCircle size={16} weight="fill" className="text-emerald-400" />
                  ) : (
                    <Package size={16} weight="fill" className="text-amber-400" />
                  )}
                </div>
                <p
                  className={`text-[10px] font-bold uppercase tracking-[0.18em] ${
                    isMatched ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  {isMatched ? 'Product recognized' : 'Not in catalog'}
                </p>
                <button
                  type="button"
                  onClick={dismissSheet}
                  className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/8 text-slate-400"
                  style={{ transition: 'transform 120ms ease-out' }}
                >
                  <X size={13} weight="bold" />
                </button>
              </div>

              {/* Product info */}
              {isMatched && lastScan.matchedItem ? (
                <div>
                  <p className="text-xl font-bold leading-tight text-white">
                    {lastScan.matchedItem.name}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {lastScan.matchedItem.busy_code != null && (
                      <span className="rounded-full border border-white/15 bg-white/8 px-2.5 py-0.5 font-mono text-xs text-slate-300">
                        Busy {lastScan.matchedItem.busy_code}
                      </span>
                    )}
                    {lastScan.matchedBy && (
                      <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
                        via {lastScan.matchedBy}
                      </span>
                    )}
                    {lastScan.codeType !== 'unknown' && (
                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs text-slate-400 uppercase tracking-wide">
                        {lastScan.codeType}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-xl font-bold text-amber-200">Unknown barcode</p>
                  <p className="mt-1 text-sm text-slate-400">
                    No product matched in the scan catalog.
                  </p>
                </div>
              )}

              {/* Raw barcode */}
              <div className="mt-4 rounded-xl border border-white/8 bg-white/5 px-3 py-2">
                <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Raw scan
                </p>
                <p className="break-all font-mono text-xs text-slate-300">
                  {lastScan.rawValue.length > 80
                    ? `${lastScan.rawValue.slice(0, 80)}…`
                    : lastScan.rawValue}
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Keyframe for the progress bar shrink animation */}
      <style>{`
        @keyframes shrinkX {
          from { transform: scaleX(1); }
          to   { transform: scaleX(0); }
        }
      `}</style>
    </div>
  );
}
