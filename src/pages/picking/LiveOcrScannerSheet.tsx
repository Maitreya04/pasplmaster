import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Keyboard, UploadSimple } from '@phosphor-icons/react';
import { BottomSheet } from '../../components/shared';
import type { OrderItem } from '../../types';

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
  videoRef,
  uiState,
  statusText,
  candidateText,
  onClose,
  onUsePhoto,
  onManualSubmit,
  onStartCamera,
}: {
  isOpen: boolean;
  expectedItem: OrderItem;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  uiState: LiveScanUiState;
  statusText: string;
  candidateText: string | null;
  onClose: () => void;
  onUsePhoto: (file: File) => void;
  onManualSubmit: (value: string) => void;
  onStartCamera: (videoEl: HTMLVideoElement) => Promise<MediaStream | null>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [manualValue, setManualValue] = useState('');

  const borderClass = useMemo(() => {
    switch (uiState) {
      case 'matched':
        return 'border-emerald-500';
      case 'mismatch':
        return 'border-red-500';
      case 'reading':
        return 'border-amber-500';
      default:
        return 'border-[var(--border-subtle)]';
    }
  }, [uiState]);

  const badgeClass = useMemo(() => {
    switch (uiState) {
      case 'matched':
        return 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/25';
      case 'mismatch':
        return 'bg-red-500/15 text-red-300 ring-1 ring-red-500/25';
      case 'reading':
        return 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/25';
      case 'error':
        return 'bg-red-500/15 text-red-300 ring-1 ring-red-500/25';
      default:
        return 'bg-[var(--bg-tertiary)] text-[var(--content-secondary)] ring-1 ring-[var(--border-subtle)]';
    }
  }, [uiState]);

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
      {/* Hidden file input for fallback photo scan */}
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
        <div className="space-y-1">
          <p className="text-xs font-semibold text-[var(--content-tertiary)] uppercase tracking-wider">
            Expected
          </p>
          <p className="text-sm text-[var(--content-primary)] leading-snug">
            {expectedItem.item_name}
          </p>
          {expectedItem.item_alias && (
            <p className="text-xs text-[var(--content-tertiary)] font-mono">
              {expectedItem.item_alias}
            </p>
          )}
        </div>

        {/* Camera preview + ROI */}
        <div className="relative w-full overflow-hidden rounded-2xl bg-black/80">
          <div className="relative w-full aspect-[3/4]">
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover"
              playsInline
              muted
              autoPlay
            />

            {/* ROI overlay (center box) */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute inset-0 bg-black/20" />
              <div
                className={`
                  absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
                  w-[86%] h-[28%] rounded-2xl border-2 ${borderClass}
                  shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]
                `}
              />
              <div className="absolute left-0 right-0 bottom-3 flex justify-center">
                <span className={`px-3 py-1.5 rounded-full text-xs font-semibold ${badgeClass}`}>
                  {statusText}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Live candidate */}
        <div className="space-y-1">
          <p className="text-xs font-semibold text-[var(--content-tertiary)] uppercase tracking-wider">
            Detected
          </p>
          <p className="text-sm font-mono text-[var(--content-primary)] break-words min-h-[20px]">
            {candidateText ?? '—'}
          </p>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="
              min-h-[48px] rounded-xl
              bg-[var(--bg-tertiary)] text-[var(--content-secondary)]
              flex items-center justify-center gap-2
              active:scale-95 transition-transform duration-100
            "
          >
            <UploadSimple size={18} weight="bold" />
            Use photo
          </button>
          <button
            onClick={() => videoRef.current?.focus()}
            className="
              min-h-[48px] rounded-xl
              bg-[var(--bg-tertiary)] text-[var(--content-secondary)]
              flex items-center justify-center gap-2
              active:scale-95 transition-transform duration-100
            "
          >
            <Camera size={18} weight="bold" />
            Live scan
          </button>
        </div>

        {/* Manual entry fallback */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-[var(--content-tertiary)] uppercase tracking-wider">
              Manual entry
            </p>
            <Keyboard size={16} className="text-[var(--content-tertiary)]" />
          </div>
          <div className="flex gap-2">
            <input
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              placeholder="Enter part number"
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
                disabled:opacity-50 disabled:cursor-not-allowed
                active:scale-95 transition-transform duration-100
              "
            >
              Submit
            </button>
          </div>
        </div>
      </div>
    </BottomSheet>
  );
}
