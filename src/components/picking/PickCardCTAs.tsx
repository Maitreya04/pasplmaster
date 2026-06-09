import { Camera, CheckCircle, Flag, Hash, MapPin } from '@phosphor-icons/react';
import {
  MRP_SHEET_TITLE,
  PICKER_MRP_SPLIT_CHOOSER_SPLIT_HINT,
  PICKER_MRP_SPLIT_CHOOSER_SPLIT_LABEL,
  PICKER_MRP_TAP_TO_CONFIRM,
} from '../../lib/billing/mrpWorkflowCopy';

export type PickCardCtaPhase = 'rack' | 'pick';

export interface PickCardCTAsProps {
  phase: PickCardCtaPhase;
  scanLabel: string;
  cameraEngaged: boolean;
  disabled?: boolean;
  /** When MRP must be confirmed before item scan. */
  scanDisabled?: boolean;
  /** Split vs single-price choice shown above — dock stays minimal. */
  waitingForSplitChoice?: boolean;
  onManualQty: () => void;
  onFlag: () => void;
  onScan: () => void;
  /** Rack phase — manual "I'm here" when bin QR is missing. */
  onConfirmRack?: () => void;
  /** Shown as primary CTA when MRP confirmation is pending. */
  onConfirmMrp?: () => void;
  confirmMrpLabel?: string;
  /** Step 3 — enabled after rack + MRP + qty are verified. */
  onMarkPicked?: () => void;
  canMarkPicked?: boolean;
  markPickedLabel?: string;
  /** Split-by-MRP mode (active split only — chooser lives on the card). */
  splitMode?: boolean;
  splitRemaining?: number;
  splitNeedsFirstBatch?: boolean;
  splitNeedsNextBatch?: boolean;
  splitActiveBatchReady?: boolean;
  onPickFirstBatch?: () => void;
  onPickNextMrp?: () => void;
  onAllSameMrp?: () => void;
  onConfirmBatch?: () => void;
  confirmBatchLabel?: string;
  onFinishShort?: () => void;
}

export function PickCardCTAs({
  phase,
  scanLabel,
  cameraEngaged,
  disabled = false,
  scanDisabled = false,
  waitingForSplitChoice = false,
  onManualQty,
  onFlag,
  onScan,
  onConfirmRack,
  onConfirmMrp,
  confirmMrpLabel,
  onMarkPicked,
  canMarkPicked = false,
  markPickedLabel = 'Mark picked',
  splitMode = false,
  splitRemaining = 0,
  splitNeedsFirstBatch = false,
  splitNeedsNextBatch = false,
  splitActiveBatchReady = false,
  onPickFirstBatch,
  onPickNextMrp,
  onAllSameMrp,
  onConfirmBatch,
  confirmBatchLabel,
  onFinishShort,
}: PickCardCTAsProps): React.JSX.Element {
  if (waitingForSplitChoice) {
    return (
      <div className="border-t border-[var(--border-faint)] bg-[var(--bg-secondary)]">
        <div className="p-2.5 sm:p-3">
          <p className="mb-2 text-center text-[10px] font-medium text-[var(--content-tertiary)]">
            Record label batches or confirm one price above
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={onFlag}
            className="w-full rounded-xl bg-[var(--bg-warning-subtle)] py-2.5 text-xs font-semibold text-[var(--content-warning-on-light)] pick-pressable disabled:opacity-40"
          >
            Flag item
          </button>
        </div>
      </div>
    );
  }

  if (splitMode && splitNeedsFirstBatch && onPickFirstBatch) {
    return (
      <div className="border-t border-[var(--border-faint)] bg-[var(--bg-secondary)]">
        <div className="p-2.5 sm:p-3">
          <button
            type="button"
            disabled={disabled}
            onClick={onPickFirstBatch}
            className="flex w-full min-h-[52px] items-center justify-between gap-2 rounded-2xl border-[1.5px] border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-3 pick-pressable active:scale-[0.99] disabled:opacity-40 sm:min-h-[56px] sm:px-4"
          >
            <div className="min-w-0 flex-1 text-left">
              <p className="text-sm font-extrabold leading-snug text-[var(--content-warning-on-light)] sm:text-base">
                {PICKER_MRP_SPLIT_CHOOSER_SPLIT_LABEL} · batch 1
              </p>
              <p className="text-[10px] leading-snug text-[var(--content-warning-on-light)]/80 sm:text-[11px]">
                {PICKER_MRP_SPLIT_CHOOSER_SPLIT_HINT}
              </p>
            </div>
            <span className="shrink-0 text-lg text-[var(--content-warning-on-light)]">›</span>
          </button>
          {onAllSameMrp ? (
            <button
              type="button"
              disabled={disabled}
              onClick={onAllSameMrp}
              className="mt-2 w-full py-2 text-xs font-semibold text-[var(--content-secondary)] pick-pressable"
            >
              Cancel split · one price for all
            </button>
          ) : null}
          <button
            type="button"
            disabled={disabled}
            onClick={onFlag}
            className="mt-1 w-full py-2 text-xs font-semibold text-[var(--content-warning-on-light)] pick-pressable"
          >
            Flag item
          </button>
        </div>
      </div>
    );
  }

  if (splitMode && splitNeedsNextBatch && onPickNextMrp) {
    return (
      <div className="border-t border-[var(--border-faint)] bg-[var(--bg-secondary)]">
        <div className="p-2.5 sm:p-3">
          <button
            type="button"
            disabled={disabled}
            onClick={onPickNextMrp}
            className="flex w-full min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-[var(--bg-inverse-primary)] px-4 font-extrabold text-white pick-pressable active:scale-[0.99] disabled:opacity-40 sm:min-h-[56px]"
          >
            Add next batch · {splitRemaining} pcs left
          </button>
          {onFinishShort ? (
            <button
              type="button"
              disabled={disabled}
              onClick={onFinishShort}
              className="mt-2 w-full py-2 text-xs font-semibold text-[var(--content-secondary)] pick-pressable"
            >
              Finish short ({splitRemaining} unpicked)
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (splitMode && onConfirmBatch && splitActiveBatchReady) {
    return (
      <div className="border-t border-[var(--border-faint)] bg-[var(--bg-secondary)]">
        <div className="space-y-2 p-2.5 sm:p-3">
          {!canMarkPicked ? (
            <p className="text-center text-[10px] font-medium text-[var(--content-tertiary)]">
              Set batch qty first — tap Pick qty above or scan
            </p>
          ) : null}
          <button
            type="button"
            disabled={disabled || !canMarkPicked}
            onClick={onConfirmBatch}
            className={`flex w-full min-h-[52px] items-center justify-center gap-2.5 rounded-2xl px-4 font-extrabold pick-pressable active:scale-[0.99] sm:min-h-[56px] ${
              canMarkPicked
                ? 'bg-[var(--bg-positive)] text-[var(--content-on-color)] shadow-sm'
                : 'bg-[var(--bg-tertiary)] text-[var(--content-quaternary)] opacity-60'
            }`}
          >
            <CheckCircle size={22} weight="fill" />
            <span className="text-base sm:text-lg">{confirmBatchLabel ?? 'Confirm batch'}</span>
          </button>
          <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={onManualQty}
              className="flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-2xl bg-[var(--bg-tertiary)] px-1 text-[var(--content-secondary)] pick-pressable disabled:opacity-40"
            >
              <Hash size={20} weight="bold" />
              <span className="text-[10px] font-semibold leading-tight sm:text-[11px]">Batch qty</span>
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={onFlag}
              className="flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-2xl bg-[var(--bg-warning-subtle)] px-1 text-[var(--content-warning-on-light)] pick-pressable disabled:opacity-40"
            >
              <Flag size={20} weight="fill" />
              <span className="text-[10px] font-semibold leading-tight sm:text-[11px]">Flag</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (onConfirmMrp) {
    return (
      <div className="border-t border-[var(--border-faint)] bg-[var(--bg-secondary)]">
        <div className="p-2.5 sm:p-3">
          <button
            type="button"
            disabled={disabled}
            onClick={onConfirmMrp}
            className="flex w-full min-h-[52px] items-center justify-between gap-2 rounded-2xl border-[1.5px] border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-3 pick-pressable active:scale-[0.99] disabled:opacity-40 sm:min-h-[56px] sm:px-4"
          >
            <div className="min-w-0 flex-1 text-left">
              <p className="text-sm font-extrabold leading-snug text-[var(--content-warning-on-light)] break-words sm:text-base">
                {confirmMrpLabel ?? MRP_SHEET_TITLE}
              </p>
              {!confirmMrpLabel ? (
                <p className="text-[10px] leading-snug text-[var(--content-warning-on-light)]/80 sm:text-[11px]">
                  {PICKER_MRP_TAP_TO_CONFIRM}
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
              Enter qty
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
        <div className="p-2 sm:p-2.5">
          <button
            type="button"
            disabled={disabled || scanDisabled}
            onClick={onScan}
            aria-pressed={cameraEngaged}
            className={`flex w-full min-h-[48px] items-center justify-center gap-2 rounded-2xl px-4 font-bold pick-pressable active:scale-[0.99] disabled:opacity-40 ${
              cameraEngaged
                ? 'bg-[var(--bg-positive)] text-[var(--content-on-color)] ring-2 ring-[var(--border-positive)]'
                : 'bg-[var(--bg-inverse-primary)] text-[var(--content-on-color)] shadow-sm'
            }`}
          >
            <Camera size={20} weight="bold" />
            <span className="text-sm sm:text-base">{scanLabel}</span>
          </button>

          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {onConfirmRack ? (
              <button
                type="button"
                disabled={disabled}
                onClick={onConfirmRack}
                className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--border-opaque)] bg-[var(--bg-tertiary)] text-xs font-semibold text-[var(--content-secondary)] pick-pressable disabled:opacity-40"
              >
                <MapPin size={16} weight="fill" className="text-[var(--content-tertiary)]" />
                <span>At rack</span>
              </button>
            ) : (
              <div />
            )}
            <button
              type="button"
              disabled={disabled}
              onClick={onFlag}
              className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl bg-[var(--bg-warning-subtle)] text-xs font-semibold text-[var(--content-warning-on-light)] pick-pressable disabled:opacity-40"
            >
              <Flag size={16} weight="fill" />
              <span>Flag</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const showMarkPicked = onMarkPicked != null;

  return (
    <div
      className="border-t border-[var(--border-faint)] bg-[var(--bg-secondary)]"
      role="toolbar"
      aria-label="Pick item"
    >
      <div className="space-y-2 p-2.5 sm:p-3">
        {showMarkPicked ? (
          <button
            type="button"
            disabled={disabled || !canMarkPicked}
            onClick={onMarkPicked}
            className={`flex w-full min-h-[52px] items-center justify-center gap-2.5 rounded-2xl px-4 font-extrabold pick-pressable active:scale-[0.99] sm:min-h-[56px] ${
              canMarkPicked
                ? 'bg-[var(--bg-positive)] text-[var(--content-on-color)] shadow-sm'
                : 'bg-[var(--bg-tertiary)] text-[var(--content-quaternary)] opacity-60'
            }`}
          >
            <CheckCircle size={22} weight="fill" />
            <span className="text-base sm:text-lg">{markPickedLabel}</span>
          </button>
        ) : null}

        <button
          type="button"
          disabled={disabled || scanDisabled}
          onClick={onScan}
          aria-pressed={cameraEngaged}
          className={`flex w-full min-h-[48px] items-center justify-center gap-2.5 rounded-2xl px-4 font-bold pick-pressable active:scale-[0.99] disabled:opacity-40 ${
            showMarkPicked ? 'border border-[var(--border-subtle)]' : ''
          } ${
            cameraEngaged
              ? 'bg-[var(--bg-positive)] text-[var(--content-on-color)] ring-2 ring-[var(--border-positive)]'
              : scanDisabled
                ? 'bg-[var(--bg-tertiary)] text-[var(--content-tertiary)]'
                : showMarkPicked
                  ? 'bg-[var(--bg-secondary)] text-[var(--content-primary)]'
                  : 'bg-[var(--bg-inverse-primary)] text-[var(--content-on-color)] shadow-sm min-h-[52px] sm:min-h-[56px] font-extrabold'
          }`}
        >
          <Camera size={20} weight="bold" />
          <span className={showMarkPicked ? 'text-sm' : 'text-base sm:text-lg'}>{scanLabel}</span>
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

        {showMarkPicked && !canMarkPicked ? (
          <p className="text-center text-[10px] font-medium text-[var(--content-tertiary)]">
            Confirm MRP and enter qty to unlock Mark picked
          </p>
        ) : null}
      </div>
    </div>
  );
}
