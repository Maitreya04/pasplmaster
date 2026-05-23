import { Camera, Flag, Hash } from '@phosphor-icons/react';

export interface PickCardCTAsProps {
  scanLabel: string;
  cameraEngaged: boolean;
  disabled?: boolean;
  onManualQty: () => void;
  onFlag: () => void;
  onScan: () => void;
}

export function PickCardCTAs({
  scanLabel,
  cameraEngaged,
  disabled = false,
  onManualQty,
  onFlag,
  onScan,
}: PickCardCTAsProps): React.JSX.Element {
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
        disabled={disabled}
        onClick={onScan}
        aria-pressed={cameraEngaged}
        className={`flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-2xl px-2 font-semibold pick-pressable disabled:opacity-40 ${
          cameraEngaged
            ? 'bg-[var(--bg-positive)] text-[var(--content-on-color)] ring-2 ring-[var(--border-positive)]'
            : 'bg-[var(--bg-inverse-primary)] text-[var(--content-on-color)]'
        }`}
      >
        <Camera size={20} weight="bold" />
        <span className="text-[11px] font-semibold leading-tight">{scanLabel}</span>
      </button>
    </div>
  );
}
