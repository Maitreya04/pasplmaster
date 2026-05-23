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
import {
  buildResolvedScanPayload,
  buildResolvedScanPayloadSync,
  uniqueCodes,
} from '../../lib/scanner/resolvePickedScan';
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
import { PickScanLabResultSheet } from './scanner/PickScanLabResultSheet';
import {
  computePickScanQuantity,
  type PickScanQuantityResult,
} from '../../lib/scanner/pickScanQuantity';
import type { ItemPackDefinition } from '../../types';
import type { PickBarcodeContext } from '../../lib/scanner/pickBarcodeSelection';
import { isTafeLine } from '../../lib/picking/tafeBrand';

export type { LiveQrScannerPickItem, LiveQrScannerResolved } from '../../lib/scanner/liveQrScannerTypes';

import type {
  LiveQrScannerPickItem,
  LiveQrScannerResolved,
} from '../../lib/scanner/liveQrScannerTypes';

/** Same label re-fired within this window is ignored (prevents double-log). */
const LAST_PAYLOAD_DEBOUNCE_MS = 450;
const AUTO_RETRY_DELAY_MS = 450;
/** Brief lock after accept so decode does not fire twice; keep short for rapid multi-scan. */
const RESET_COOLDOWN_MS = 90;

export interface LiveQrScannerPickLabContext {
  targetQty: number;
  pickedSoFar: number;
  partNo: string;
  busyCode: number | null;
  packDefinition: ItemPackDefinition | null;
}

interface LiveQrScannerProps {
  title?: string;
  eyebrow?: string;
  helpText?: string;
  idleStatus?: string;
  mode?: 'verify' | 'collect' | 'pickLab';
  pickItem?: LiveQrScannerPickItem;
  pickLabContext?: LiveQrScannerPickLabContext;
  /** Pick flow: barcode unreadable — verify printed product code + manual qty. */
  onManualVerify?: () => void;
  onClose: () => void;
  onResolved: (result: LiveQrScannerResolved) => void;
  /** Fired on every accepted decode in continuous mode (scanner stays open). */
  onScanAccepted?: (result: LiveQrScannerResolved) => void;
  onError: (message: string) => void;
  /** When true, awaits UOM RPC before onResolved (slower; for UoM onboarding). Default false. */
  resolveUomOnScan?: boolean;
  /** Keep scanning after a successful match (embedded pick card). */
  continuous?: boolean;
  /** Inline card layout instead of full-screen modal. */
  embedded?: boolean;
  /** Pause camera decode (sheet open, off-screen card). */
  paused?: boolean;
  /** Overlay progress chip on viewfinder (continuous pick). */
  pickedSoFar?: number;
  targetQty?: number;
}

export function LiveQrScanner({
  title,
  eyebrow,
  helpText,
  idleStatus,
  mode = 'verify',
  pickItem,
  pickLabContext,
  onManualVerify,
  onClose,
  onResolved,
  onScanAccepted,
  onError,
  resolveUomOnScan = false,
  continuous = false,
  embedded = false,
  paused = false,
  pickedSoFar,
  targetQty,
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
  const [pickLabQuantity, setPickLabQuantity] = useState<PickScanQuantityResult | null>(null);

  const completedRef = useRef(false);
  const lockedRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);
  const sheetDismissTimerRef = useRef<number | null>(null);
  const lastFiredPayloadRef = useRef<{ key: string; at: number } | null>(null);
  const onStableDecodeRef = useRef<(raw: string) => void>(() => {});
  const pickLabPickedRef = useRef(0);

  const [feedbackSoundEnabled, setFeedbackSoundEnabled] = useState(() => getScannerFeedbackPrefs().sound);
  const [feedbackHapticsEnabled, setFeedbackHapticsEnabled] = useState(() => getScannerFeedbackPrefs().haptics);

  const scanIndexStatus = useItemScanIndexStore((state) => state.status);
  const scanIndexError = useItemScanIndexStore((state) => state.error);

  useEffect(() => {
    primeScannerAudioContext();
  }, []);

  const collectMode = mode === 'collect';
  const pickLabMode = mode === 'pickLab';
  const sheetMode = collectMode || pickLabMode;
  const continuousMode = continuous || pickLabMode;

  useEffect(() => {
    pickLabPickedRef.current = pickLabContext?.pickedSoFar ?? 0;
  }, [pickLabContext?.pickedSoFar]);

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

  const pickScanContext = useMemo<PickBarcodeContext | undefined>(() => {
    if (collectMode || scannerPickItem.itemId <= 0) return undefined;
    const codes = expectedCodes.map((c) => normalizeScanCode(c)).filter((c) => c.length > 0);
    if (codes.length === 0) return undefined;
    return {
      expectedCodes: codes,
      oemMultiBarcodeMode: true,
    };
  }, [collectMode, expectedCodes, scannerPickItem.itemId]);

  const isTafePick = useMemo(
    () =>
      isTafeLine({
        item_name: scannerPickItem.name,
        main_group: scannerPickItem.mainGroup,
        parent_group: scannerPickItem.parentGroup,
      }),
    [scannerPickItem.mainGroup, scannerPickItem.name, scannerPickItem.parentGroup],
  );

  const resolvedHelpText = useMemo(() => {
    if (helpText) return helpText;
    if (isTafePick && pickScanContext) {
      return 'TAFE: fill the upper label in frame. Use torch on plastic glare. Scan the QR or top part barcode — ignore the bottom serial stamp.';
    }
    if (pickScanContext) {
      return 'Damaged or wrinkled label? Hold steady, use torch, and aim at the part-number QR or top barcode.';
    }
    return 'Steady, fill the frame, use torch in dim aisles.';
  }, [helpText, isTafePick, pickScanContext]);

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
    viewfinderRef,
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
    collectMode: collectMode || pickLabMode,
    pickContext: pickScanContext,
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

  useEffect(() => {
    if (paused) {
      stopScanner();
      return;
    }
    if (embedded || continuous) {
      completedRef.current = false;
      lockedRef.current = false;
      resumeVideoLoop();
    }
  }, [paused, embedded, continuous, resumeVideoLoop, stopScanner]);

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
        const result = resolveUomOnScan
          ? await buildResolvedScanPayload(rawValue, scannerPickItem, { resolveUom: true })
          : buildResolvedScanPayloadSync(rawValue, scannerPickItem);

        setLastScan(result);

        if (!resolveUomOnScan) {
          if (pickLabMode) {
            if (result.matchesPickItem) {
              vibrateIfEnabled('success');
              playSuccessBeep();
              flashViewport('green');
            } else {
              vibrateIfEnabled('error');
              playErrorBuzz();
              flashViewport('red');
            }
          } else if (collectMode) {
            vibrateIfEnabled('success');
            playSuccessBeep();
            flashViewport('green');
          } else if (result.matchesPickItem) {
            vibrateIfEnabled('success');
            playSuccessBeep();
            flashViewport('green');
          } else {
            vibrateIfEnabled('error');
            playErrorBuzz();
            flashViewport('red');
          }
        }

        let labQuantity: PickScanQuantityResult | null = null;
        if (pickLabMode && pickLabContext) {
          labQuantity = computePickScanQuantity({
            rawValue,
            isMatch: result.matchesPickItem,
            busyCode: pickLabContext.busyCode,
            targetQty: pickLabContext.targetQty,
            totalBefore: pickLabPickedRef.current,
            packDefinition: pickLabContext.packDefinition,
            resolvedEa: result.baseQtyEa,
          });
          if (labQuantity.qtyAdded > 0) {
            pickLabPickedRef.current = labQuantity.totalAfter;
          }
          setPickLabQuantity(labQuantity);
        }

        if (sheetMode) {
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
        if (continuous && onScanAccepted) {
          onScanAccepted(result);
        }

        if (pickLabMode) {
          setErrorMessage(result.matchesPickItem ? null : result.reason);
          setStatus(
            result.matchesPickItem
              ? labQuantity && labQuantity.qtyAdded > 0
                ? `+${labQuantity.qtyAdded} pcs · scan next label…`
                : 'Verified — scan next label…'
              : 'Wrong label for this line — try again…',
          );
          window.setTimeout(() => {
            lockedRef.current = false;
            setLockedUi(false);
            setCanReset(true);
            setErrorMessage(null);
            setStatus(idleLine);
            resumeVideoLoop();
          }, RESET_COOLDOWN_MS);
          return;
        }

        if (collectMode) {
          if (resolveUomOnScan) {
            vibrateIfEnabled('success');
            playSuccessBeep();
            flashViewport('green');
          }
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

        if (continuousMode) {
          if (result.matchesPickItem) {
            setErrorMessage(null);
            setStatus('Matched — scan next label…');
          } else {
            setErrorMessage(result.reason);
            setStatus('Wrong label — aim at this line and scan again…');
          }
          window.setTimeout(() => {
            lockedRef.current = false;
            setLockedUi(false);
            setCanReset(true);
            if (result.matchesPickItem) {
              setErrorMessage(null);
            }
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
          if (resolveUomOnScan) {
            vibrateIfEnabled('success');
            playSuccessBeep();
            flashViewport('green');
          }
          setErrorMessage(null);
          setStatus('Shelf verified');
          return;
        }

        if (resolveUomOnScan) {
          vibrateIfEnabled('error');
          playErrorBuzz();
          flashViewport('red');
        }
        setErrorMessage(result.reason);
        setStatus('Wrong label — aim at this line and scan again…');

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
      continuous,
      continuousMode,
      onScanAccepted,
      pickLabMode,
      pickLabContext,
      flashViewport,
      idleLine,
      onResolved,
      resolveUomOnScan,
      resumeVideoLoop,
      scannerPickItem,
      sheetMode,
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

  const pickLabOuterQty = pickLabContext?.packDefinition?.outer_pack_qty ?? null;
  const pickLabInnerQty = pickLabContext?.packDefinition?.inner_pack_qty ?? null;

  const progressLabel =
    targetQty != null && pickedSoFar != null
      ? `${pickedSoFar} / ${targetQty}`
      : null;

  const rootClass = embedded
    ? 'relative flex h-full min-h-[180px] flex-col rounded-2xl bg-slate-950 text-white overflow-hidden'
    : 'fixed inset-0 z-[70] bg-slate-950 text-white';

  return (
    <div className={rootClass}>
      <div className={`relative flex ${embedded ? 'h-full' : 'min-h-full'} flex-col`}>
        {!embedded && (
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
        )}

        {!embedded && <p className="px-4 pb-2 text-xs text-slate-400">{status}</p>}

        <div className={`flex flex-1 flex-col min-h-0 ${embedded ? 'p-0' : 'px-3 pb-3'}`}>
          <div className={`relative flex-1 overflow-hidden bg-black ${embedded ? 'min-h-[160px]' : 'min-h-[200px] rounded-[24px] border border-white/10'}`}>
            <ViewfinderOverlay
              videoRef={videoRef}
              viewfinderRef={viewfinderRef}
              supportMessage={supportMessage}
              detectedBox={detectedBox}
              flashColor={flashColor}
            />
            {progressLabel && (
              <div className="absolute left-3 top-3 z-10 rounded-full bg-black/70 px-3 py-1.5 font-mono text-sm font-bold tabular-nums text-emerald-300 ring-1 ring-emerald-400/30">
                {progressLabel}
              </div>
            )}
            {embedded && (
              <div className="absolute right-2 top-2 z-10 flex gap-1">
                <button
                  type="button"
                  onClick={toggleFeedbackSound}
                  aria-label={feedbackSoundEnabled ? 'Mute scan beep' : 'Enable scan beep'}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white/70"
                >
                  {feedbackSoundEnabled ? (
                    <SpeakerSimpleHigh size={14} weight="bold" />
                  ) : (
                    <SpeakerSimpleSlash size={14} weight="bold" />
                  )}
                </button>
              </div>
            )}
            {embedded && errorMessage && (
              <div className="absolute inset-x-2 bottom-2 z-10 rounded-lg bg-red-500/90 px-2 py-1 text-[10px] font-medium text-white">
                {errorMessage}
              </div>
            )}
          </div>
        </div>

        <div className={`space-y-3 ${embedded ? 'hidden' : 'px-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]'}`}>
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

          {(pickLabMode || !sheetMode) && onManualVerify && (
            <button
              type="button"
              onClick={onManualVerify}
              className="w-full rounded-2xl border border-white/15 bg-white/8 px-4 py-3 text-sm font-medium text-white/90 active:scale-[0.98]"
              style={{ transition: 'transform 120ms ease-out' }}
            >
              Barcode not scanning? Enter product code
            </button>
          )}

          {(pickLabMode || !sheetMode) && (
            <p className="px-1 text-center text-xs leading-relaxed text-slate-500">
              {resolvedHelpText}
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

        {pickLabMode && sheetVisible && lastScan && pickLabContext && pickLabQuantity && (
          <PickScanLabResultSheet
            visible
            open={sheetOpen}
            partNo={pickLabContext.partNo}
            itemName={scannerPickItem.name}
            quantity={pickLabQuantity}
            scanCount={scanCount}
            outerCatalogQty={pickLabOuterQty}
            innerCatalogQty={pickLabInnerQty}
            onDismiss={dismissSheet}
          />
        )}
      </div>
    </div>
  );
}
