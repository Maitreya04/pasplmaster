import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  HandGrabbing,
  HandPalm,
  SpeakerSimpleHigh,
  SpeakerSimpleSlash,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import { normalizeScanCode } from '../../lib/scanner/qrPayload';
import { useItemScanIndexStore } from '../../stores/itemScanIndex';
import { useQRScanner } from '../../hooks/useQRScanner';
import { buildResolvedScanPayload, uniqueCodes } from '../../lib/scanner/resolvePickedScan';
import {
  playErrorBuzz,
  playSuccessBeep,
  getScannerFeedbackPrefs,
  primeScannerAudioContext,
  setScannerFeedbackPrefs,
  vibrateIfEnabled,
} from '../../lib/scanner/feedback';
import { isScannerDebugEnabled, scannerDebugLog } from '../../lib/scanner/scannerDebug';
import { ViewfinderOverlay } from './scanner/ViewfinderOverlay';
import { ScannerControls } from './scanner/ScannerControls';
import { CollectResultSheet } from './scanner/CollectResultSheet';

export type { LiveQrScannerPickItem, LiveQrScannerResolved } from '../../lib/scanner/liveQrScannerTypes';

import type {
  LiveQrScannerPickItem,
  LiveQrScannerResolved,
} from '../../lib/scanner/liveQrScannerTypes';

const LAST_PAYLOAD_DEBOUNCE_MS = 1200;
const AUTO_RETRY_DELAY_MS = 1000;
const RESET_COOLDOWN_MS = 350;

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
  const idleLine = idleStatus ?? 'Point the QR inside the frame';
  const [lockedUi, setLockedUi] = useState(false);
  const [status, setStatus] = useState('Starting camera…');
  const [canReset, setCanReset] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<LiveQrScannerResolved | null>(null);
  const [flashColor, setFlashColor] = useState<'green' | 'red' | null>(null);
  const [sheetState, setSheetState] = useState<'hidden' | 'open' | 'closing'>('hidden');
  const [scanCount, setScanCount] = useState(0);

  const completedRef = useRef(false);
  const lockedRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);
  const sheetDismissTimerRef = useRef<number | null>(null);
  const lastFiredPayloadRef = useRef<{ key: string; at: number } | null>(null);
  const onStableDecodeRef = useRef<(raw: string) => void>(() => {});

  const [feedbackSoundEnabled, setFeedbackSoundEnabled] = useState(() => getScannerFeedbackPrefs().sound);
  const [feedbackHapticsEnabled, setFeedbackHapticsEnabled] = useState(() => getScannerFeedbackPrefs().haptics);

  const scanIndexStatus = useItemScanIndexStore((state) => state.status);
  const scanIndexError = useItemScanIndexStore((state) => state.error);

  useEffect(() => {
    primeScannerAudioContext();
  }, []);

  const collectMode = mode === 'collect';

  useEffect(() => {
    if (isScannerDebugEnabled()) {
      scannerDebugLog('scanner_modal_mount');
    }
  }, []);

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

  const flashViewport = useCallback((color: 'green' | 'red') => {
    setFlashColor(color);
    window.setTimeout(() => {
      setFlashColor((current) => (current === color ? null : current));
    }, 220);
  }, []);

  const handleScannerError = useCallback(
    (message: string) => {
      setStatus('Scanner unavailable');
      setErrorMessage(message);
      onError(message);
    },
    [onError],
  );

  const stopScannerTimers = useCallback(() => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (sheetDismissTimerRef.current !== null) {
      window.clearTimeout(sheetDismissTimerRef.current);
      sheetDismissTimerRef.current = null;
    }
  }, []);

  const {
    videoRef,
    streamRef,
    supportMessage,
    torchAvailable,
    torchActive,
    setTorchActive,
    zoomLevel,
    detectedBox,
    restartVideoLoopRef,
    stopScannerBase,
    applyCameraZoom,
  } = useQRScanner({
    collectMode,
    completedRef,
    lockedRef,
    onStableRawDecode: (raw) => onStableDecodeRef.current(raw),
    onError: handleScannerError,
    onScannerReady: () => setStatus(idleLine),
  });

  const stopScanner = useCallback(() => {
    stopScannerTimers();
    stopScannerBase();
  }, [stopScannerBase, stopScannerTimers]);

  const resumeVideoLoop = useCallback(() => {
    restartVideoLoopRef.current?.();
  }, [restartVideoLoopRef]);

  const handleResolvedPayload = useCallback(
    async (rawValue: string) => {
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

      try {
        const result = await buildResolvedScanPayload(rawValue, scannerPickItem);

        setLastScan(result);
        if (collectMode) {
          setScanCount((n) => n + 1);
          stopScannerTimers();
          setSheetState('open');
          sheetDismissTimerRef.current = window.setTimeout(() => {
            setSheetState('closing');
            sheetDismissTimerRef.current = window.setTimeout(() => {
              setSheetState('hidden');
            }, 340);
          }, 3000);
        }

        lockedRef.current = true;
        setLockedUi(true);
        setCanReset(false);
        onResolved(result);

        if (collectMode) {
          vibrateIfEnabled(60);
          playSuccessBeep();
          flashViewport('green');
          setErrorMessage(null);
          setStatus('Scan logged. Point at the next label…');
          window.setTimeout(() => {
            lockedRef.current = false;
            setLockedUi(false);
            setCanReset(true);
            setStatus(idleLine);
            resumeVideoLoop();
          }, RESET_COOLDOWN_MS);
          return;
        }

        window.setTimeout(() => {
          setCanReset(true);
        }, RESET_COOLDOWN_MS);

        if (result.matchesPickItem) {
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
        setStatus(`Verification failed. Retrying in ${AUTO_RETRY_DELAY_MS / 1000}s…`);

        if (retryTimerRef.current !== null) {
          window.clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          lockedRef.current = false;
          setLockedUi(false);
          setCanReset(true);
          setErrorMessage(null);
          setStatus(idleLine);
          resumeVideoLoop();
        }, AUTO_RETRY_DELAY_MS);
      } catch {
        setErrorMessage('Could not resolve scan. Try again.');
      }
    },
    [
      collectMode,
      flashViewport,
      idleLine,
      onResolved,
      resumeVideoLoop,
      scannerPickItem,
      stopScanner,
      stopScannerTimers,
    ],
  );

  onStableDecodeRef.current = (raw) => {
    void handleResolvedPayload(raw).catch(() => {
      setErrorMessage('Could not resolve scan. Try again.');
    });
  };

  useEffect(() => {
    if (!supportMessage) return;
    setStatus('Live QR is not available in this browser');
  }, [supportMessage]);

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
  }, [torchActive, setTorchActive, streamRef]);

  const handleZoomToggle = useCallback(() => {
    const track = streamRef.current?.getVideoTracks()[0];
    const capabilities = (track?.getCapabilities?.() ?? {}) as { zoom?: { max?: number } };
    const maxZoom = capabilities.zoom?.max;
    if (!maxZoom || maxZoom <= 1) return;

    const currentZoom = zoomLevel ?? 1;
    const zoomStops = [1, Math.min(2, maxZoom), Math.min(3, maxZoom)].filter(
      (value, index, values) => values.indexOf(value) === index,
    );
    const currentIndex = zoomStops.findIndex((value) => Math.abs(value - currentZoom) < 0.2);
    const nextZoom = zoomStops[(currentIndex + 1) % zoomStops.length] ?? 1;
    void applyCameraZoom(nextZoom);
  }, [applyCameraZoom, streamRef, zoomLevel]);

  const dismissSheet = useCallback(() => {
    stopScannerTimers();
    setSheetState('closing');
    sheetDismissTimerRef.current = window.setTimeout(() => {
      setSheetState('hidden');
      sheetDismissTimerRef.current = null;
    }, 340);
  }, [stopScannerTimers]);

  const handleReset = useCallback(() => {
    if (!canReset) return;
    stopScannerTimers();
    completedRef.current = false;
    lockedRef.current = false;
    setLockedUi(false);
    setErrorMessage(null);
    setLastScan(null);
    setStatus(idleLine);
    resumeVideoLoop();
  }, [canReset, idleLine, resumeVideoLoop, stopScannerTimers]);

  const sheetVisible = sheetState !== 'hidden';
  const sheetOpen = sheetState === 'open';

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950 text-white">
      <div className="relative flex min-h-full flex-col">
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

        <p className="px-4 pb-2 text-xs text-slate-400">{status}</p>

        <div className="flex flex-1 flex-col px-3 pb-3 min-h-0">
          <div className="relative min-h-[200px] flex-1 overflow-hidden rounded-[24px] border border-white/10 bg-black">
            <ViewfinderOverlay
              videoRef={videoRef}
              supportMessage={supportMessage}
              detectedBox={detectedBox}
              flashColor={flashColor}
            />
          </div>
        </div>

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
                    <p className="mt-1 text-xs text-red-100/80">Got: {lastScan.matchedItem.name}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          <ScannerControls
            torchAvailable={torchAvailable}
            torchActive={torchActive}
            onTorchToggle={() => void handleTorchToggle()}
            zoomLevel={zoomLevel}
            onZoomToggle={handleZoomToggle}
            supportMessage={supportMessage}
            onReset={handleReset}
            resetDisabled={!lockedUi || !canReset}
            onClose={handleClose}
          />

          {!collectMode && (
            <p className="px-1 text-center text-xs leading-relaxed text-slate-500">
              {helpText ?? 'Steady, fill the frame, use torch in dim aisles.'}
            </p>
          )}
        </div>

        {collectMode && sheetVisible && lastScan && (
          <CollectResultSheet
            visible
            open={sheetOpen}
            lastScan={lastScan}
            scanCount={scanCount}
            onDismiss={dismissSheet}
          />
        )}
      </div>
    </div>
  );
}
