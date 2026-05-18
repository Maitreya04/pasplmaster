/* eslint-disable @typescript-eslint/no-explicit-any -- BarcodeDetector is platform-specific */
import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import {
  captureRoiBitmap,
  captureRoiImageData,
  getNextRoiLevel,
} from '../lib/scanner/roiProcessor';
import type { BarcodeDetectorLike, BarcodeDetectorResult } from '../context/CameraContext';
import { useOptionalPickingCamera } from '../context/CameraContext';
import { REQUESTED_BARCODE_FORMATS } from '../lib/scanner/barcodeFormats';
import { detectScannerPlatform } from '../lib/scanner/scannerPlatform';
import {
  acquireCameraStream,
  applyContinuousCameraEnhancements,
} from '../lib/scanner/acquireCamera';
import { createVideoScanLoop } from '../lib/scanner/videoLoop';
import { scoreDetectedValue } from '../lib/scanner/scoring';
import { isScannerDebugEnabled, scannerDebugLog } from '../lib/scanner/scannerDebug';

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

export interface PickedDetectedValue {
  rawValue: string;
  format?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface DisplayBox {
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

function scoreSpatialPriority(entry: BarcodeDetectorResult, video: HTMLVideoElement): number {
  const area = getBoundingBoxArea(entry);
  if (!area || video.videoWidth <= 0 || video.videoHeight <= 0) return 0;

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
  let bestScore =
    scoreDetectedValue(best.rawValue, best.format, collectMode) + best.scoreBoost;

  for (let i = 1; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const score =
      scoreDetectedValue(candidate.rawValue, candidate.format, collectMode) + candidate.scoreBoost;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

export function mapBoundingBoxToDisplay(entry: PickedDetectedValue, video: HTMLVideoElement): DisplayBox | null {
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
  zoom?: { min?: number; max?: number };
};

export interface UseQRScannerArgs {
  collectMode: boolean;
  completedRef: RefObject<boolean>;
  lockedRef: RefObject<boolean>;
  onStableRawDecode: (raw: string) => void;
  onError: (message: string) => void;
  /** Fires once preview is playing and decode loop starts. */
  onScannerReady?: () => void;
}

export function useQRScanner({
  collectMode,
  completedRef,
  lockedRef,
  onStableRawDecode,
  onError,
  onScannerReady,
}: UseQRScannerArgs): {
  videoRef: RefObject<HTMLVideoElement | null>;
  streamRef: RefObject<MediaStream | null>;
  supportMessage: string | null;
  torchAvailable: boolean;
  torchActive: boolean;
  setTorchActive: (v: boolean) => void;
  zoomLevel: number | null;
  detectedBox: DisplayBox | null;
  restartVideoLoopRef: MutableRefObject<(() => void) | null>;
  scanFrameRefMutable: MutableRefObject<(() => void) | null>;
  stopScannerBase: () => void;
  applyCameraZoom: (targetZoom: number) => Promise<boolean>;
  nudgeZoomForTinyCodesRef: MutableRefObject<(areaRatio?: number) => void>;
  maxZoomRefOut: MutableRefObject<number | null>;
  burstUntilRefOut: MutableRefObject<number>;
} {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const engineRef = useRef<ScannerEnginePath | null>(null);
  const videoLoopStopRef = useRef<(() => void) | null>(null);
  const scanFrameRef = useRef<(() => void) | null>(null);
  const scanInFlightRef = useRef(false);
  const lastScanAtRef = useRef(0);
  const scanSequenceRef = useRef(0);
  const burstUntilRef = useRef(0);
  const noHitFrameCountRef = useRef(0);
  const maxZoomRef = useRef<number | null>(null);
  const currentZoomRef = useRef<number | null>(null);
  const stableScanRef = useRef<{ rawValue: string | null; count: number; updatedAt: number }>({
    rawValue: null,
    count: 0,
    updatedAt: 0,
  });

  const STABLE_SCAN_MIN_FRAMES = 1;
  const STABLE_SCAN_TTL_MS = 600;

  const [supportMessage, setSupportMessage] = useState<string | null>(null);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchActive, setTorchActive] = useState(false);
  const [zoomLevel, setZoomLevel] = useState<number | null>(null);
  const [detectedBox, setDetectedBox] = useState<DisplayBox | null>(null);

  const pickingCamera = useOptionalPickingCamera();
  const pickingCameraRef = useRef(pickingCamera);
  useEffect(() => {
    pickingCameraRef.current = pickingCamera;
  });

  const onStableRawDecodeRef = useRef(onStableRawDecode);
  const onErrorRef = useRef(onError);
  const onScannerReadyRef = useRef(onScannerReady);
  onStableRawDecodeRef.current = onStableRawDecode;
  onErrorRef.current = onError;
  onScannerReadyRef.current = onScannerReady;

  const firstFrameAtRef = useRef<number | null>(null);
  const firstDecodeAtRef = useRef<number | null>(null);
  const sessionStartRef = useRef<number | null>(null);

  const stopScannerBase = useCallback(() => {
    if (videoLoopStopRef.current) {
      videoLoopStopRef.current();
      videoLoopStopRef.current = null;
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

  const nudgeZoomForTinyCodesRef = useRef<(areaRatio?: number) => void>(() => {});

  const emitStableDecode = useCallback((raw: string) => {
    if (isScannerDebugEnabled() && firstDecodeAtRef.current == null) {
      firstDecodeAtRef.current = performance.now();
      scannerDebugLog('time_to_first_decode', {
        ms: Math.round(firstDecodeAtRef.current - (sessionStartRef.current ?? firstDecodeAtRef.current)),
      });
    }
    onStableRawDecodeRef.current(raw);
  }, []);

  useEffect(() => {
    nudgeZoomForTinyCodesRef.current = (areaRatio?: number) => {
      const maxZoom = maxZoomRef.current;
      if (!maxZoom || maxZoom <= 1) return;

      const currentZoom = currentZoomRef.current ?? 1;
      const shouldZoomForBox = areaRatio != null && areaRatio > 0 && areaRatio < 0.025;
      const shouldZoomForMisses = noHitFrameCountRef.current >= 18;
      if (!shouldZoomForBox && !shouldZoomForMisses) return;
      if (currentZoom >= Math.min(maxZoom, 3)) return;

      void applyCameraZoom(Math.min(maxZoom, currentZoom + 0.5, 3));
      noHitFrameCountRef.current = 0;
    };
  }, [applyCameraZoom]);

  const restartVideoLoopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    const scanFrame = () => {
      if (cancelled || completedRef.current || lockedRef.current) return;
      const engine = engineRef.current;
      const video = videoRef.current;

      if (!engine || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        return;
      }

      if (isScannerDebugEnabled() && firstFrameAtRef.current == null && video.videoWidth > 0) {
        firstFrameAtRef.current = performance.now();
        scannerDebugLog('time_to_first_frame', {
          ms: Math.round(firstFrameAtRef.current - (sessionStartRef.current ?? firstFrameAtRef.current)),
        });
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
              nudgeZoomForTinyCodesRef.current(box?.areaRatio);

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
                emitStableDecode(selected.rawValue);
              }
            } else {
              noHitFrameCountRef.current += 1;
              if (noHitFrameCountRef.current % 6 === 0) setDetectedBox(null);
              nudgeZoomForTinyCodesRef.current();
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

    const startVideoLoop = () => {
      const video = videoRef.current;
      if (!video) return;
      videoLoopStopRef.current?.();
      const loop = createVideoScanLoop(video, (timeMs) => {
        if (cancelled) return;
        const engine = engineRef.current;
        const baseInterval = engine?.type === 'worker' ? WORKER_SCAN_INTERVAL_MS : NATIVE_SCAN_INTERVAL_MS;
        const interval = Date.now() < burstUntilRef.current ? BURST_SCAN_INTERVAL_MS : baseInterval;
        if (!scanInFlightRef.current && timeMs - lastScanAtRef.current >= interval) {
          lastScanAtRef.current = timeMs;
          scanFrameRef.current?.();
        }
      });
      loop.start();
      videoLoopStopRef.current = () => loop.stop();
    };

    restartVideoLoopRef.current = startVideoLoop;

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
              emitStableDecode(data.rawValue);
            }
          } else if (!data.rawValue) {
            noHitFrameCountRef.current += 1;
            if (noHitFrameCountRef.current % 8 === 0) {
              setDetectedBox(null);
              nudgeZoomForTinyCodesRef.current();
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

    const startScanner = async () => {
      sessionStartRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
      firstFrameAtRef.current = null;
      firstDecodeAtRef.current = null;
      scannerDebugLog('scanner_session_start');

      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera access is not available on this device.');
        }

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
            return;
          }

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
          if (!video) throw new Error('Scanner video element is not available.');
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

          startVideoLoop();
          onScannerReadyRef.current?.();
          if (isScannerDebugEnabled()) {
            scannerDebugLog('time_to_engine_ready', {
              ms: Math.round(
                performance.now() - (sessionStartRef.current ?? performance.now()),
              ),
            });
          }
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
          const worker = new Worker(new URL('../workers/qrScanner.worker', import.meta.url), {
            type: 'module',
          });
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) {
            setSupportMessage('Canvas 2D context is required for QR scanning.');
            return;
          }
          engineRef.current = { type: 'worker', worker, workerCanvas: canvas, workerCtx: ctx, pending: new Set() };
          attachWorkerOnMessage(worker);
        }

        const { stream: legacyStream, track: legacyTrack } = await acquireCameraStream();
        if (cancelled) {
          legacyStream.getTracks().forEach((t) => t.stop());
          return;
        }

        await applyContinuousCameraEnhancements(legacyTrack);
        streamRef.current = legacyStream;

        const video = videoRef.current;
        if (!video) throw new Error('Scanner video element is not available.');
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
          /* best effort */
        }

        startVideoLoop();
        onScannerReadyRef.current?.();
        if (isScannerDebugEnabled()) {
          scannerDebugLog('time_to_engine_ready', {
            ms: Math.round(
              performance.now() - (sessionStartRef.current ?? performance.now()),
            ),
          });
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Could not start the QR scanner.';
        onErrorRef.current(message);
      }
    };

    void startScanner();

    return () => {
      cancelled = true;
      scanFrameRef.current = null;
      stopScannerBase();
    };
  }, [collectMode, emitStableDecode, stopScannerBase]);

  return {
    videoRef,
    streamRef,
    supportMessage,
    torchAvailable,
    torchActive,
    setTorchActive,
    zoomLevel,
    detectedBox,
    restartVideoLoopRef,
    scanFrameRefMutable: scanFrameRef,
    stopScannerBase,
    applyCameraZoom,
    nudgeZoomForTinyCodesRef,
    maxZoomRefOut: maxZoomRef,
    burstUntilRefOut: burstUntilRef,
  };
}
