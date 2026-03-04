import { useRef, useState, useMemo } from 'react';
import {
  Camera,
  CheckCircle,
  XCircle,
  ArrowCounterClockwise,
  Keyboard,
  SpinnerGap,
} from '@phosphor-icons/react';
import { BottomSheet } from '../../components/shared';
import type { OrderItem, ScanResult } from '../../types';

// Keep the old export name so other files that import the type don't break
export type LiveScanUiState =
  | 'requesting_camera'
  | 'camera_ready'
  | 'reading'
  | 'matched'
  | 'mismatch'
  | 'error';

export function OcrScannerSheet({
  isOpen,
  expectedItem,
  itemAlias1,
  photoState,
  thumbnailUrl,
  scanResult,
  onClose,
  onPhoto,
  onConfirm,
  onRetake,
  onManualSubmit,
}: {
  isOpen: boolean;
  expectedItem: OrderItem;
  itemAlias1?: string | null;
  photoState: 'idle' | 'processing' | 'done';
  thumbnailUrl: string | null;
  scanResult: ScanResult | null;
  onClose: () => void;
  onPhoto: (file: File) => void;
  onConfirm: () => void;
  onRetake: () => void;
  onManualSubmit: (value: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualValue, setManualValue] = useState('');

  const expectedCode = useMemo(
    () => expectedItem.item_alias ?? itemAlias1 ?? null,
    [expectedItem.item_alias, itemAlias1],
  );

  const detectedCode = useMemo(
    () => scanResult?.ocrExtracted?.partNumber ?? null,
    [scanResult],
  );

  const signalPills = useMemo(() => {
    const signals = scanResult?.signals;
    if (!signals || signals.length === 0) return [];
    const labelMap: Record<string, string> = {
      partNumber: 'Part code',
      brand: 'Brand',
      vehicle: 'Vehicle',
      mrp: 'MRP',
      productType: 'Type',
    };
    return signals
      .filter((s) => s.score > 0)
      .map((s) => ({
        key: s.signal,
        label: labelMap[s.signal] ?? s.signal,
        strong: s.score / s.maxScore >= 0.6,
      }));
  }, [scanResult]);

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Scan part number">
      {/* Hidden file input — triggers native camera */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPhoto(file);
          e.target.value = '';
        }}
      />

      <div className="space-y-4">
        {/* ── Expected part ── */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)] mb-0.5">
              Expected
            </p>
            <p className="text-sm font-medium text-[var(--content-primary)] leading-snug">
              {expectedItem.item_name}
            </p>
          </div>
          {expectedCode && (
            <span className="shrink-0 self-start mt-4 inline-flex items-center rounded-full bg-[var(--bg-tertiary)] h-6 px-3 text-xs font-mono font-semibold text-[var(--content-secondary)] ring-1 ring-[var(--border-subtle)]">
              {expectedCode}
            </span>
          )}
        </div>

        {/* ── Viewfinder area — changes per state ── */}
        <div className="relative w-full rounded-2xl overflow-hidden bg-[var(--bg-tertiary)]" style={{ aspectRatio: '4/3' }}>

          {/* ── IDLE: camera placeholder with affordance ── */}
          {photoState === 'idle' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6">
              {/* Dashed scan-box affordance */}
              <div className="relative w-full max-w-[260px] aspect-[2/1] rounded-xl border-2 border-dashed border-[var(--border-subtle)] flex flex-col items-center justify-center gap-2">
                {/* Corner marks */}
                {(['tl','tr','bl','br'] as const).map((c) => (
                  <span
                    key={c}
                    className={`
                      absolute w-4 h-4
                      ${c === 'tl' ? 'top-[-2px] left-[-2px] border-t-2 border-l-2 rounded-tl-lg border-[var(--content-secondary)]' : ''}
                      ${c === 'tr' ? 'top-[-2px] right-[-2px] border-t-2 border-r-2 rounded-tr-lg border-[var(--content-secondary)]' : ''}
                      ${c === 'bl' ? 'bottom-[-2px] left-[-2px] border-b-2 border-l-2 rounded-bl-lg border-[var(--content-secondary)]' : ''}
                      ${c === 'br' ? 'bottom-[-2px] right-[-2px] border-b-2 border-r-2 rounded-br-lg border-[var(--content-secondary)]' : ''}
                    `}
                  />
                ))}
                <Camera size={28} weight="light" className="text-[var(--content-secondary)]" />
                <p className="text-[11px] text-[var(--content-tertiary)] text-center leading-tight px-3">
                  Fit the part label inside the box
                </p>
              </div>
            </div>
          )}

          {/* ── PROCESSING & DONE: photo thumbnail ── */}
          {(photoState === 'processing' || photoState === 'done') && thumbnailUrl && (
            <img
              src={thumbnailUrl}
              alt="Captured label"
              className="absolute inset-0 w-full h-full object-cover"
            />
          )}

          {/* Processing overlay */}
          {photoState === 'processing' && (
            <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-2">
              <SpinnerGap size={28} weight="bold" className="text-white animate-spin" />
              <p className="text-sm font-semibold text-white">Checking part…</p>
            </div>
          )}

          {/* Done — Match overlay */}
          {photoState === 'done' && scanResult?.isMatch && (
            <div className="absolute inset-0 bg-[color-mix(in_srgb,var(--bg-positive)_70%,black)] flex flex-col items-center justify-center gap-2">
              <CheckCircle size={44} weight="fill" className="text-[var(--content-positive)]" />
              <p className="text-base font-bold text-[var(--content-on-color)]">Part confirmed</p>
              {detectedCode && (
                <p className="text-xs font-mono text-[var(--content-on-color)] opacity-80">{detectedCode}</p>
              )}
            </div>
          )}

          {/* Done — Mismatch overlay */}
          {photoState === 'done' && scanResult && !scanResult.isMatch && (
            <div className="absolute inset-0 bg-[var(--bg-overlay)] flex flex-col items-center justify-center gap-1.5 px-5">
              <XCircle size={40} weight="fill" className="text-[var(--content-negative)]" />
              <p className="text-base font-bold text-[var(--content-negative)]">Wrong part</p>
              <div className="mt-1 space-y-0.5 text-center">
                {detectedCode && (
                  <p className="text-xs text-white/60">
                    Read: <span className="font-mono text-white/80">{detectedCode}</span>
                  </p>
                )}
                {expectedCode && (
                  <p className="text-xs text-white/60">
                    Expected: <span className="font-mono text-white/80">{expectedCode}</span>
                  </p>
                )}
              </div>
              {signalPills.length > 0 && (
                <div className="flex flex-wrap justify-center gap-1 mt-2">
                  {signalPills.map((p) => (
                    <span
                      key={p.key}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        p.strong
                          ? 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)] border border-[var(--border-positive)]'
                          : 'bg-white/10 text-white/50 border border-white/10'
                      }`}
                    >
                      {p.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Actions ── */}

        {/* IDLE: single primary CTA */}
        {photoState === 'idle' && (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="
              w-full min-h-[56px] rounded-2xl
              bg-[var(--bg-secondary)] text-[var(--content-primary)] font-bold text-[15px]
              flex items-center justify-center gap-2.5
              active:scale-[0.97] transition-transform duration-100
              shadow-sm
            "
          >
            <Camera size={22} weight="bold" />
            Take Photo
          </button>
        )}

        {/* PROCESSING: disabled button so user knows to wait */}
        {photoState === 'processing' && (
          <button
            disabled
            className="
              w-full min-h-[56px] rounded-2xl
              bg-[var(--bg-tertiary)] text-[var(--content-disabled)] font-bold text-[15px]
              flex items-center justify-center gap-2.5
              cursor-not-allowed
            "
          >
            <SpinnerGap size={20} className="animate-spin" />
            Checking…
          </button>
        )}

        {/* DONE — MATCH: just show that it's confirming (auto-closes) */}
        {photoState === 'done' && scanResult?.isMatch && (
          <button
            onClick={onConfirm}
            className="
              w-full min-h-[56px] rounded-2xl
              bg-[var(--bg-positive)] text-[var(--content-on-color)] font-bold text-[15px]
              flex items-center justify-center gap-2.5
              active:scale-[0.97] transition-transform duration-100
            "
          >
            <CheckCircle size={22} weight="fill" />
            Confirmed — continue
          </button>
        )}

        {/* DONE — MISMATCH: retake (primary) + override (ghost) */}
        {photoState === 'done' && scanResult && !scanResult.isMatch && (
          <div className="space-y-2">
            <button
              onClick={onRetake}
              className="
                w-full min-h-[52px] rounded-2xl
                bg-[var(--bg-secondary)] text-[var(--content-primary)] font-bold text-[15px]
                flex items-center justify-center gap-2.5
                active:scale-[0.97] transition-transform duration-100
              "
            >
              <ArrowCounterClockwise size={20} weight="bold" />
              Retake photo
            </button>
            <button
              onClick={onConfirm}
              className="
                w-full min-h-[44px] rounded-xl
                text-[var(--content-tertiary)] text-sm font-medium
                flex items-center justify-center gap-1.5
                active:opacity-60 transition-opacity
              "
            >
              Override and continue anyway
            </button>
          </div>
        )}

        {/* ── Manual entry (collapsed, always available) ── */}
        {photoState !== 'processing' && (
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
                  placeholder={expectedCode ?? 'e.g. P-L30'}
                  autoFocus
                  className="
                    flex-1 h-11 px-3 rounded-xl
                    bg-[var(--bg-tertiary)] text-[var(--content-primary)]
                    placeholder-[var(--content-disabled)]
                    border border-[var(--border-subtle)]
                    focus:outline-none focus:ring-2 focus:ring-[var(--border-warning)]
                  "
                />
                <button
                  onClick={() => {
                    onManualSubmit(manualValue);
                    setManualValue('');
                  }}
                  disabled={!manualValue.trim()}
                  className="
                    h-11 px-4 rounded-xl
                    bg-[var(--bg-warning)] text-[var(--content-primary)] font-semibold
                    disabled:opacity-40 disabled:cursor-not-allowed
                    active:scale-95 transition-transform duration-100
                  "
                >
                  Submit
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
