import { Camera, Flag, Hash, MapPin } from '@phosphor-icons/react';

export type PickCardCtaPhase = 'rack' | 'pick';

export interface PickCardCTAsProps {
  phase: PickCardCtaPhase;
  scanLabel: string;
  cameraEngaged: boolean;
  disabled?: boolean;
  /** When MRP must be confirmed before item scan. */
  scanDisabled?: boolean;
  onManualQty: () => void;
  onFlag: () => void;
  onScan: () => void;
  /** Rack phase — manual "I'm here" when bin QR is missing. */
  onConfirmRack?: () => void;
  /** Shown as primary CTA when MRP confirmation is pending. */
  onConfirmMrp?: () => void;
  confirmMrpLabel?: string;
}

function StepHint({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="border-b border-[var(--border-faint)] bg-[var(--bg-tertiary)] px-3 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)] sm:px-4">
      {children}
    </p>
  );
}

export function PickCardCTAs({
  phase,
  scanLabel,
  cameraEngaged,
  disabled = false,
  scanDisabled = false,
  onManualQty,
  onFlag,
  onScan,
  onConfirmRack,
  onConfirmMrp,
  confirmMrpLabel,
}: PickCardCTAsProps): React.JSX.Element {
  if (onConfirmMrp) {
    return (
      <div className="border-t border-[var(--border-faint)] bg-[var(--bg-secondary)]">
        <StepHint>Step 2 · Confirm MRP on label</StepHint>
        <div className="p-2.5 sm:p-3">
          <button
            type="button"
            disabled={disabled}
            onClick={onConfirmMrp}
            className="flex w-full min-h-[52px] items-center justify-between gap-2 rounded-2xl border-[1.5px] border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-3 pick-pressable disabled:opacity-40 sm:min-h-[56px] sm:px-4"
          >
            <div className="min-w-0 flex-1 text-left">
              <p className="text-sm font-extrabold leading-snug text-[var(--content-warning-on-light)] break-words sm:text-base">
                {confirmMrpLabel ?? 'Confirm MRP on label'}
              </p>
              {!confirmMrpLabel ? (
                <p className="text-[10px] leading-snug text-[var(--content-warning-on-light)]/80 sm:text-[11px]">
                  Tap to match the price on the physical label
                </p>
              ) : null}
            </div>
            <span className="shrink-0 text-lg text-[var(--content-warning-on-light)]">›</span>
          </button>
          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={onManualQty}
              className="min-h-[44px] rounded-xl bg-[var(--bg-tertiary)] text-xs font-semibold text-[var(--content-secondary)] pick-pressable disabled:opacity-40"
            >
              Edit qty
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={onFlag}
              className="min-h-[44px] rounded-xl bg-[var(--bg-warning-subtle)] text-xs font-semibold text-[var(--content-warning-on-light)] pick-pressable disabled:opacity-40"
            >
              Flag
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'rack') {
    return (
      <div
        className="border-t border-[var(--border-faint)] bg-[var(--bg-secondary)]"
        role="toolbar"
        aria-label="Verify rack location"
      >
        <StepHint>Step 1 · Verify rack · then you can pick</StepHint>
        <div className="space-y-2 p-2.5 sm:p-3">
          <button
            type="button"
            disabled={disabled || scanDisabled}
            onClick={onScan}
            aria-pressed={cameraEngaged}
            className={`flex w-full min-h-[52px] items-center justify-center gap-2.5 rounded-2xl px-4 font-extrabold pick-pressable disabled:opacity-40 sm:min-h-[56px] ${
              cameraEngaged
                ? 'bg-[var(--bg-positive)] text-[var(--content-on-color)] ring-2 ring-[var(--border-positive)]'
                : 'bg-[var(--bg-inverse-primary)] text-[var(--content-on-color)] shadow-sm'
            }`}
          >
            <Camera size={22} weight="bold" />
            <span className="text-base sm:text-lg">{scanLabel}</span>
          </button>
          {onConfirmRack ? (
            <button
              type="button"
              disabled={disabled}
              onClick={onConfirmRack}
              className="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-opaque)] bg-[var(--bg-tertiary)] text-sm font-semibold text-[var(--content-secondary)] pick-pressable disabled:opacity-40"
            >
              <MapPin size={18} weight="fill" className="text-[var(--content-tertiary)]" />
              At rack — no bin QR
            </button>
          ) : null}
          <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={onFlag}
              className="min-h-[44px] rounded-xl bg-[var(--bg-warning-subtle)] text-xs font-semibold text-[var(--content-warning-on-light)] pick-pressable disabled:opacity-40"
            >
              <Flag size={16} weight="fill" className="mx-auto mb-0.5" />
              Flag item
            </button>
            <button
              type="button"
              disabled
              className="min-h-[44px] rounded-xl bg-[var(--bg-tertiary)] text-xs font-semibold text-[var(--content-quaternary)] opacity-50"
              aria-disabled
            >
              Pick unlocks after rack
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="border-t border-[var(--border-faint)] bg-[var(--bg-secondary)]"
      role="toolbar"
      aria-label="Pick item"
    >
      <StepHint>Step 2 · Scan item or enter qty</StepHint>
      <div className="space-y-2 p-2.5 sm:p-3">
        <button
          type="button"
          disabled={disabled || scanDisabled}
          onClick={onScan}
          aria-pressed={cameraEngaged}
          className={`flex w-full min-h-[52px] items-center justify-center gap-2.5 rounded-2xl px-4 font-extrabold pick-pressable disabled:opacity-40 sm:min-h-[56px] ${
            cameraEngaged
              ? 'bg-[var(--bg-positive)] text-[var(--content-on-color)] ring-2 ring-[var(--border-positive)]'
              : scanDisabled
                ? 'bg-[var(--bg-tertiary)] text-[var(--content-tertiary)]'
                : 'bg-[var(--bg-inverse-primary)] text-[var(--content-on-color)] shadow-sm'
          }`}
        >
          <Camera size={22} weight="bold" />
          <span className="text-base sm:text-lg">{scanLabel}</span>
        </button>
        <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={onManualQty}
            className="flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-2xl bg-[var(--bg-tertiary)] px-1 text-[var(--content-secondary)] pick-pressable disabled:opacity-40"
          >
            <Hash size={20} weight="bold" />
            <span className="text-[10px] font-semibold leading-tight sm:text-[11px]">Manual qty</span>
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={onFlag}
            className="flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-2xl bg-[var(--bg-warning-subtle)] px-1 text-[var(--content-warning-on-light)] pick-pressable disabled:opacity-40"
          >
            <Flag size={20} weight="fill" />
            <span className="text-[10px] font-semibold leading-tight sm:text-[11px]">Flag item</span>
          </button>
        </div>
      </div>
    </div>
  );
}
