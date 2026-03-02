import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Keyboard, ArrowsIn } from '@phosphor-icons/react';
import { BottomSheet } from '../../components/shared';
import type { OrderItem, ScanResult } from '../../types';

export type LiveScanUiState =
  | 'requesting_camera'
  | 'camera_ready'
  | 'reading'
  | 'matched'
  | 'mismatch'
  | 'error';

export function LiveOcrScannerSheet({
  isOpen,
  expectedItem,
  itemAlias1,
  videoRef,
  uiState,
  statusText,
  candidateText,
  lastScanResult,
  onClose,
  onUsePhoto,
  onManualSubmit,
  onStartCamera,
}: {
  isOpen: boolean;
  expectedItem: OrderItem;
  itemAlias1?: string | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  uiState: LiveScanUiState;
  statusText: string;
  candidateText: string | null;
  lastScanResult: ScanResult | null;
  onClose: () => void;
  onUsePhoto: (file: File) => void;
  onManualSubmit: (value: string) => void;
  onStartCamera: (videoEl: HTMLVideoElement) => Promise<MediaStream | null>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [manualValue, setManualValue] = useState('');
  const [manualOpen, setManualOpen] = useState(false);

  const expectedPrimaryCode = useMemo(
    () => expectedItem.item_alias ?? itemAlias1 ?? null,
    [expectedItem.item_alias, itemAlias1],
  );

  /* ── ROI border colour driven by live-mode state ── */
  const roiBorderClass = useMemo(() => {
    switch (uiState) {
      case 'matched':   return 'border-emerald-400';
      case 'mismatch':  return 'border-red-400';
      case 'reading':   return 'border-amber-400';
      default:          return 'border-white/50';
    }
  }, [uiState]);

  /* ── Live-mode status chip shown inside the viewfinder ── */
  const liveChip = useMemo(() => {
    if (uiState === 'requesting_camera') {
      return { text: 'Starting camera…', cls: 'bg-white/10 text-white/60' };
    }
    if (uiState === 'reading') {
      return { text: 'Reading…', cls: 'bg-amber-500/20 text-amber-300' };
    }
    if (uiState === 'matched' && lastScanResult) {
      const pn = lastScanResult.ocrExtracted?.partNumber ?? expectedPrimaryCode;
      return {
        text: pn ? `Matched: ${pn}` : 'Matched',
        cls: 'bg-emerald-500/20 text-emerald-300',
      };
    }
    if (uiState === 'mismatch' && candidateText) {
      return {
        text: `Read: ${candidateText} — wrong part`,
        cls: 'bg-red-500/20 text-red-300',
      };
    }
    if (uiState === 'error') {
      return { text: 'Camera unavailable', cls: 'bg-red-500/20 text-red-300' };
    }
    // camera_ready — show hint
    return { text: 'Fit label inside the box', cls: 'bg-white/10 text-white/70' };
  }, [candidateText, expectedPrimaryCode, lastScanResult, uiState]);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) t.stop();
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      stopStream();
      setManualValue('');
      setManualOpen(false);
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    (async () => {
      const stream = await onStartCamera(video);
      if (cancelled) {
        if (stream) for (const t of stream.getTracks()) t.stop();
        return;
      }
      streamRef.current = stream;
    })();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [isOpen, onStartCamera, stopStream]);

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Scan part number">
      {/* Hidden file input — triggers native camera capture */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUsePhoto(file);
          e.target.value = '';
        }}
      />

      <div className="space-y-4">
        {/* Expected part info */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)] mb-0.5">
              Expected
            </p>
            <p className="text-sm font-medium text-[var(--content-primary)] leading-snug truncate">
              {expectedItem.item_name}
            </p>
          </div>
          {expectedPrimaryCode && (
            <span className="shrink-0 self-start mt-4 inline-flex items-center gap-1 rounded-full bg-[var(--bg-tertiary)] px-2.5 py-1 text-xs font-mono text-[var(--content-secondary)] ring-1 ring-[var(--border-subtle)]">
              <ArrowsIn size={11} className="opacity-60" />
              {expectedPrimaryCode}
            </span>
          )}
        </div>

        {/* ── Viewfinder ── */}
        <div className="relative w-full overflow-hidden rounded-2xl bg-black">
          <div className="relative w-full aspect-[3/4]">
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover"
              playsInline
              muted
              autoPlay
            />

            {/* Dark vignette + scan-box cutout */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute inset-0 bg-black/25" />

              {/* ROI box */}
              <div
                className={`
                  absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
                  w-[86%] h-[35%] rounded-2xl border-2 transition-colors duration-300
                  ${roiBorderClass}
                  shadow-[0_0_0_9999px_rgba(0,0,0,0.38)]
                `}
              >
                {/* Corner marks */}
                {(['tl','tr','bl','br'] as const).map((corner) => (
                  <span
                    key={corner}
                    className={`
                      absolute w-4 h-4 border-white/80
                      ${corner === 'tl' ? '-top-px -left-px border-t-2 border-l-2 rounded-tl-xl'  : ''}
                      ${corner === 'tr' ? '-top-px -right-px border-t-2 border-r-2 rounded-tr-xl' : ''}
                      ${corner === 'bl' ? '-bottom-px -left-px border-b-2 border-l-2 rounded-bl-xl' : ''}
                      ${corner === 'br' ? '-bottom-px -right-px border-b-2 border-r-2 rounded-br-xl' : ''}
                    `}
                  />
                ))}
              </div>

              {/* Live-mode status chip — sits at bottom of viewfinder */}
              <div className="absolute bottom-3 left-0 right-0 flex justify-center px-4">
                <span
                  className={`
                    px-3 py-1.5 rounded-full text-[11px] font-semibold backdrop-blur-sm
                    ${liveChip.cls}
                  `}
                >
                  {liveChip.text}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Primary CTA: Take Photo ── */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="
            w-full min-h-[56px] rounded-2xl
            bg-white text-gray-950 font-semibold text-[15px]
            flex items-center justify-center gap-2.5
            active:scale-[0.97] transition-transform duration-100
            shadow-sm
          "
        >
          <Camera size={20} weight="bold" />
          Take photo
        </button>

        <p className="text-center text-[11px] text-[var(--content-tertiary)]">
          Photo gives the best accuracy — live mode also runs in the background
        </p>

        {/* ── Manual entry (collapsed by default) ── */}
        <div className="border-t border-[var(--border-subtle)] pt-3">
          <button
            onClick={() => setManualOpen((v) => !v)}
            className="flex items-center gap-2 text-xs text-[var(--content-tertiary)] w-full"
          >
            <Keyboard size={14} />
            <span>Enter part number manually</span>
            <span className="ml-auto text-[var(--content-disabled)]">
              {manualOpen ? '▲' : '▼'}
            </span>
          </button>

          {manualOpen && (
            <div className="flex gap-2 mt-3">
              <input
                value={manualValue}
                onChange={(e) => setManualValue(e.target.value)}
                placeholder="e.g. P-L30"
                autoFocus
                className="
                  flex-1 h-11 px-3 rounded-xl
                  bg-[var(--bg-tertiary)] text-[var(--content-primary)]
                  placeholder-[var(--content-disabled)]
                  border border-[var(--border-subtle)]
                  focus:outline-none focus:ring-2 focus:ring-amber-500/50
                "
              />
              <button
                onClick={() => onManualSubmit(manualValue)}
                disabled={!manualValue.trim()}
                className="
                  h-11 px-4 rounded-xl
                  bg-amber-500 text-gray-950 font-semibold
                  disabled:opacity-40 disabled:cursor-not-allowed
                  active:scale-95 transition-transform duration-100
                "
              >
                Submit
              </button>
            </div>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
