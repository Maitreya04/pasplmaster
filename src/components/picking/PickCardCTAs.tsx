import { Camera, Flag, Hash } from '@phosphor-icons/react';

export interface PickCardCTAsProps {
  scanLabel: string;
  cameraEngaged: boolean;
  disabled?: boolean;
  /** When MRP must be confirmed before item scan. */
  scanDisabled?: boolean;
  onManualQty: () => void;
  onFlag: () => void;
  onScan: () => void;
  /** Shown as primary CTA when MRP confirmation is pending. */
  onConfirmMrp?: () => void;
  /** When set, replaces default "Confirm MRP on label" copy (e.g. single-band fast confirm). */
  confirmMrpLabel?: string;
}

export function PickCardCTAs({
  scanLabel,
  cameraEngaged,
  disabled = false,
  scanDisabled = false,
  onManualQty,
  onFlag,
  onScan,
  onConfirmMrp,
  confirmMrpLabel,
}: PickCardCTAsProps): React.JSX.Element {
  if (onConfirmMrp) {
    return (
      <div className="border-t border-[var(--border-faint)] bg-[var(--bg-secondary)] p-3">
        <button
          type="button"
          disabled={disabled}
          onClick={onConfirmMrp}
          className="flex w-full min-h-[52px] items-center justify-between rounded-2xl border-[1.5px] border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-4 pick-pressable disabled:opacity-40"
        >
          <div className="text-left">
            <p className="text-sm font-extrabold text-[var(--content-warning-on-light)]">
              {confirmMrpLabel ?? 'Confirm MRP on label'}
            </p>
            {!confirmMrpLabel ? (
              <p className="text-[11px] text-[var(--content-warning-on-light)]/80">
                Tap to match the price on the physical label
              </p>
            ) : null}
          </div>
          <span className="text-lg text-[var(--content-warning-on-light)]">›</span>
        </button>
        <div className="mt-2 grid grid-cols-2 gap-2">
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
    );
  }

  return (
    <div
      className="grid grid-cols-3 gap-2 border-t border-[var(--border-faint)] bg-[var(--bg-secondary)] p-3"
      role="toolbar"
      aria-label="Pick actions"
    >
      <button
        type="button"
        disabled={disabled}
        onClick={onManualQty}
        className="flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-2xl bg-[var(--bg-tertiary)] px-2 text-[var(--content-secondary)] pick-pressable disabled:opacity-40"
      >
        <Hash size={20} weight="bold" />
        <span className="text-[11px] font-semibold leading-tight">Manual qty</span>
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onFlag}
        className="flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-2xl bg-[var(--bg-warning-subtle)] px-2 text-[var(--content-warning-on-light)] pick-pressable disabled:opacity-40"
      >
        <Flag size={20} weight="fill" />
        <span className="text-[11px] font-semibold leading-tight">Flag item</span>
      </button>
      <button
        type="button"
        disabled={disabled || scanDisabled}
        onClick={onScan}
        aria-pressed={cameraEngaged}
        className={`flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-2xl px-2 font-semibold pick-pressable disabled:opacity-40 ${
          cameraEngaged
            ? 'bg-[var(--bg-positive)] text-[var(--content-on-color)] ring-2 ring-[var(--border-positive)]'
            : scanDisabled
              ? 'bg-[var(--bg-tertiary)] text-[var(--content-tertiary)]'
              : 'bg-[var(--bg-inverse-primary)] text-[var(--content-on-color)]'
        }`}
      >
        <Camera size={20} weight="bold" />
        <span className="text-[11px] font-semibold leading-tight">{scanLabel}</span>
      </button>
    </div>
  );
}
