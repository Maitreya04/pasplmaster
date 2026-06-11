import { PencilSimple, Flag } from '@phosphor-icons/react';
import { Numpad, NumpadConfirmButton, numKey } from './Numpad';
import { NoteInput } from './NoteInput';
import { OverTargetBanner } from './OverTargetBanner';
import { UomBadge } from './UomBadge';
import {
  getQtyState,
  isQtyCtaDisabled,
  QTY_STATE_STYLES,
} from '../../lib/picking/qtyEntryState';
import {
  commitPreviewSentence,
  normalizeUom,
  noteButtonLabel,
  qtyCtaLabel,
  qtyFeedbackText,
  uomLabel,
  uomOrderedLabel,
} from '../../lib/picking/pickerMicrocopy';
import type { PickerV10LoggedBatch } from './types';

export interface QtyEntryScreenProps {
  rackNo: string | null;
  partCode: string;
  itemName: string;
  targetQty: number;
  loggedQty: number;
  uom: string;
  mrp: number | null;
  numBuf: string;
  note: string;
  noteOpen: boolean;
  positionLabel?: string;
  loggedBatches?: PickerV10LoggedBatch[];
  onNumKey: (key: string) => void;
  onEditMrp: () => void;
  onNoteChange: (value: string) => void;
  onToggleNote: () => void;
  onLogBatch: () => void;
  onFillAll: () => void;
  onFlag?: () => void;
  onBack?: () => void;
}

function parseDisplayQty(buf: string): number {
  const n = parseInt(buf, 10);
  return Number.isFinite(n) ? n : 0;
}

export function QtyEntryScreen({
  rackNo,
  partCode,
  itemName,
  targetQty,
  loggedQty,
  uom,
  mrp,
  numBuf,
  note,
  noteOpen,
  positionLabel,
  loggedBatches = [],
  onNumKey,
  onEditMrp,
  onNoteChange,
  onToggleNote,
  onLogBatch,
  onFillAll,
  onFlag,
  onBack,
}: QtyEntryScreenProps): React.JSX.Element {
  const uomNorm = normalizeUom(uom);
  const n = parseDisplayQty(numBuf);
  const batchTarget = Math.max(0, targetQty - loggedQty);
  const state = getQtyState(n, batchTarget);
  const styles = QTY_STATE_STYLES[state];
  const hasNote = note.trim().length > 0;
  const ctaDisabled = isQtyCtaDisabled(state, note);
  const ctaLabel = qtyCtaLabel(state, n, mrp, uomNorm, hasNote);
  const feedback = qtyFeedbackText(state, n, batchTarget, uomNorm, 0);
  const tallyPct = targetQty > 0 ? Math.min(100, (loggedQty / targetQty) * 100) : 0;
  const remainingAfter = Math.max(0, batchTarget - n);
  const isOver = state === 'over';

  const handleCta = (): void => {
    if (isOver && !hasNote) {
      onToggleNote();
      return;
    }
    if (!ctaDisabled) onLogBatch();
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
      <div className="shrink-0 border-b border-[var(--border-subtle)] px-3 py-2 sm:px-4">
        <div className="flex items-center justify-between gap-2">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="text-sm font-medium text-[var(--content-secondary)] pick-pressable"
            >
              ← Back
            </button>
          ) : (
            <span />
          )}
          {positionLabel ? (
            <span className="rounded-full bg-[var(--bg-tertiary)] px-2.5 py-1 text-[10px] font-semibold text-[var(--content-tertiary)]">
              {positionLabel}
            </span>
          ) : null}
        </div>
      </div>

      <div
        className="shrink-0 border-b px-3 py-3 sm:px-4"
        style={{
          backgroundColor: 'var(--bg-positive-subtle)',
          borderColor: 'var(--border-positive)',
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-positive)]">
              ⊙ {rackNo ?? '—'}
            </p>
            <p className="pick-hero-code mt-0.5 font-mono font-bold text-[var(--content-primary)]">
              {partCode}
            </p>
            <p className="mt-0.5 line-clamp-2 text-xs text-[var(--content-secondary)]">{itemName}</p>
          </div>
          <div className="shrink-0 text-right">
            <p
              className="font-mono text-2xl font-extrabold tabular-nums leading-none"
              style={{ color: state === 'exact' ? 'var(--content-positive)' : 'var(--content-primary)' }}
            >
              {targetQty}
            </p>
            <p className="mt-0.5 text-[9px] font-medium text-[var(--content-positive)]">
              {uomOrderedLabel(uomNorm)}
            </p>
            <UomBadge uom={uomNorm} className="mt-1" />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="flex flex-col items-center px-4 pb-2 pt-4 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
            MRP on the label
          </p>
          <button
            type="button"
            onClick={onEditMrp}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-3 py-1.5 pick-pressable"
          >
            <span className="text-xs text-[var(--content-tertiary)]">₹</span>
            <span className="font-mono text-sm font-bold tabular-nums text-[var(--content-primary)]">
              {mrp != null ? Math.round(mrp) : '—'}
            </span>
            <PencilSimple size={11} className="text-[var(--content-quaternary)]" />
          </button>

          <div
            className="pick-sheet-display mt-3 font-mono font-medium tabular-nums"
            style={{ color: styles.qtyColor, minHeight: '4.25rem' }}
          >
            {numBuf.length === 0 ? '—' : numBuf}
          </div>

          <p
            className="mt-1 rounded-md px-2.5 py-0.5 text-xs font-medium"
            style={{ color: styles.feedbackColor, backgroundColor: styles.feedbackBg }}
          >
            {feedback}
          </p>
        </div>

        <div
          className="mx-3 flex items-center justify-between rounded-lg border px-3 py-2 sm:mx-4"
          style={{ borderColor: styles.previewBorder, backgroundColor: 'var(--bg-secondary)' }}
        >
          <p className="text-sm font-medium text-[var(--content-primary)]">
            <span style={{ color: isOver ? 'var(--content-negative)' : 'var(--content-primary)' }}>
              {n > 0 ? n : '—'}
            </span>
            {n > 0 ? (
              <span className="text-[var(--content-secondary)]"> {uomLabel(uomNorm, n)}</span>
            ) : (
              <span className="text-[var(--content-secondary)]"> {uomLabel(uomNorm, 2)}</span>
            )}
            {mrp != null && n > 0 ? (
              <>
                <span className="text-[var(--content-quaternary)]"> at </span>
                <span className="text-[var(--content-positive)]">₹{Math.round(mrp)}</span>
              </>
            ) : null}
          </p>
          <button
            type="button"
            onClick={onToggleNote}
            className={`shrink-0 rounded-md border px-2 py-1 text-[10px] font-semibold pick-pressable ${
              hasNote
                ? 'border-[var(--border-positive)] text-[var(--content-positive)]'
                : 'border-[var(--border-subtle)] text-[var(--content-tertiary)]'
            }`}
          >
            {noteButtonLabel(hasNote)}
          </button>
        </div>

        {styles.showOverBanner && n > 0 ? (
          <OverTargetBanner n={n} target={batchTarget} uom={uomNorm} />
        ) : null}

        <NoteInput value={note} onChange={onNoteChange} isOver={isOver} isOpen={noteOpen || isOver} />

        <div className="mx-3 mt-3 sm:mx-4">
          <div className="flex justify-between text-[10px] text-[var(--content-tertiary)]">
            <span>Logged</span>
            <span className="font-mono font-semibold tabular-nums text-[var(--content-secondary)]">
              {loggedQty} / {targetQty}
            </span>
          </div>
          <div className="mt-1 h-0.5 overflow-hidden rounded bg-[var(--border-subtle)]">
            <div
              className="h-full rounded bg-[var(--content-positive)] transition-all duration-300"
              style={{ width: `${tallyPct}%` }}
            />
          </div>
          {loggedBatches.length > 0 || (state === 'partial' && n > 0) ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {loggedBatches.map((b, i) => (
                <span
                  key={`${b.mrp}-${b.qty}-${i}`}
                  className="inline-flex rounded-full border border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] px-2 py-0.5 text-[9px] font-semibold text-[var(--content-positive)]"
                >
                  ₹{Math.round(b.mrp)} ×{b.qty}
                </span>
              ))}
              {state === 'partial' && n > 0 ? (
                <span className="inline-flex rounded-full border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-2 py-0.5 text-[9px] font-semibold text-[var(--content-warning-on-light)]">
                  {remainingAfter} to log
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="mx-3 mt-2 flex items-center justify-between px-1 text-[10px] text-[var(--content-quaternary)] sm:mx-4">
          <button type="button" onClick={onFlag} className="pick-pressable">
            <Flag size={12} className="mr-1 inline" />
            Flag issue
          </button>
          <span>per {uomLabel(uomNorm, 1)}</span>
        </div>
      </div>

      <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <div className="px-3 pt-2 sm:px-4">
          <Numpad
            display={numBuf}
            onKey={onNumKey}
            onConfirm={handleCta}
            confirmLabel={ctaLabel}
            hideConfirm
          />
        </div>
        <div className="grid grid-cols-[1fr_2fr] gap-0.5 border-t border-[var(--border-subtle)] p-0.5">
          <button
            type="button"
            onClick={onFillAll}
            className="min-h-[46px] bg-[var(--bg-primary)] text-sm font-semibold text-[var(--content-primary)] pick-pressable"
          >
            All {batchTarget}
          </button>
          <NumpadConfirmButton
            onConfirm={handleCta}
            confirmLabel={ctaLabel}
            disabled={ctaDisabled && !(isOver && !hasNote)}
            tone={state === 'over' && hasNote ? 'amber' : 'default'}
          />
        </div>
      </div>
    </div>
  );
}

/** Read-only preview of commit sentence for tests / storybook. */
export function qtyPreviewText(n: number, mrp: number | null, uom: string): string {
  return commitPreviewSentence(n, mrp, uom);
}
