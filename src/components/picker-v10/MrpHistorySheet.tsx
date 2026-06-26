import { useEffect, useState } from 'react';
import { BottomSheet } from '../shared';
import type { StockMrpHistoryEntry } from '../../types';
import { Numpad, NumpadConfirmButton, numKey } from './Numpad';
import { PickSheetContext } from '../picking/PickSheetContext';
import { appHaptics } from '../../lib/haptics';
import {
  MRP_BADGE_BILLING_CONFIRMED,
  MRP_BADGE_LATEST_STOCK,
  MRP_BADGE_SEEN_ON_LABEL,
  MRP_BADGE_SUGGESTED,
  MRP_SHEET_CONFIRM_ON_LABEL,
  MRP_SHEET_CUSTOM_CONFIRM,
  MRP_SHEET_CUSTOM_HINT,
  MRP_SHEET_CUSTOM_TITLE,
  MRP_SHEET_EMPTY,
  MRP_SHEET_HEADING,
  MRP_SHEET_SUBHEADING_BATCH,
  MRP_SHEET_SUBHEADING_BATCH_MANUAL,
  MRP_SHEET_BATCH_STEP,
  MRP_SHEET_SUBHEADING_MULTI,
  MRP_SHEET_SUBHEADING_SINGLE,
  MRP_SHEET_TITLE,
} from '../../lib/billing/mrpWorkflowCopy';

function mrpHistorySourceBadge(
  entry: StockMrpHistoryEntry,
  isSuggested: boolean,
): React.ReactNode | null {
  if (entry.source === 'billing_verified') {
    return (
      <span className="ml-1.5 rounded bg-[var(--bg-positive)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
        {MRP_BADGE_BILLING_CONFIRMED}
      </span>
    );
  }
  if (entry.source === 'picker_verified') {
    const pickCount =
      entry.confirmation_count != null && entry.confirmation_count > 1
        ? ` · ${entry.confirmation_count} picks`
        : '';
    return (
      <span className="ml-1.5 rounded bg-[var(--bg-accent-subtle)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[var(--content-accent)] border border-[var(--border-accent)]">
        {MRP_BADGE_SEEN_ON_LABEL}{pickCount}
      </span>
    );
  }
  if (isSuggested) {
    return (
      <span className="ml-1.5 rounded bg-[var(--bg-inverse-primary)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
        {entry.source === 'stock_mrpwise' ? MRP_BADGE_LATEST_STOCK : MRP_BADGE_SUGGESTED}
      </span>
    );
  }
  return null;
}

export interface MrpHistorySheetProps {
  isOpen: boolean;
  history: StockMrpHistoryEntry[];
  isLoading?: boolean;
  confirmedMrp: number | null;
  customMrp: number | null;
  partCode?: string | null;
  rackNo?: string | null;
  /** When true, selection starts an active batch instead of setting line MRP. */
  selectBatchMode?: boolean;
  /** 1-based batch index when picking split line. */
  batchNumber?: number;
  onSelectMrp: (mrp: number) => void;
  onSelectCustomMrp: (mrp: number) => void;
  onClose: () => void;
}

export function MrpHistorySheet({
  isOpen,
  history,
  isLoading = false,
  confirmedMrp,
  customMrp,
  partCode = null,
  rackNo = null,
  selectBatchMode = false,
  batchNumber,
  onSelectMrp,
  onSelectCustomMrp,
  onClose,
}: MrpHistorySheetProps): React.JSX.Element | null {
  const [mode, setMode] = useState<'list' | 'custom'>('list');
  const [localBuf, setLocalBuf] = useState('');
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const isMulti = history.length > 1;
  const singleMrp = history.length === 1 ? history[0] : null;

  useEffect(() => {
    if (isOpen) {
      setMode('list');
      setLocalBuf('');
      setDiscardPrompt(false);
    }
  }, [isOpen]);

  const handleClose = (): void => {
    if (mode === 'custom' && localBuf.length > 0 && !discardPrompt) {
      setDiscardPrompt(true);
      appHaptics.warning();
      return;
    }
    setMode('list');
    setLocalBuf('');
    setDiscardPrompt(false);
    onClose();
  };

  const selectMrp = (mrp: number): void => {
    appHaptics.success();
    onSelectMrp(mrp);
  };

  const submitCustom = (): void => {
    const v = parseInt(localBuf, 10);
    if (v > 0) {
      appHaptics.warning();
      onSelectCustomMrp(v);
      setMode('list');
      setLocalBuf('');
      setDiscardPrompt(false);
    }
  };

  const customParsed = parseInt(localBuf, 10);
  const canSaveCustom = Number.isFinite(customParsed) && customParsed > 0;

  const batchLabel =
    selectBatchMode && batchNumber != null && batchNumber > 0
      ? MRP_SHEET_BATCH_STEP(batchNumber)
      : selectBatchMode
        ? 'MRP for this batch'
        : MRP_SHEET_TITLE;

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={handleClose}
      title={batchLabel}
      closeOnly
      keepMounted
      keyboardBehavior="static"
      sheetClassName="max-h-[min(92dvh,92vh)] pick-sheet-compact"
      contentClassName="pick-sheet-compact"
      footer={
        mode === 'list' && singleMrp && confirmedMrp !== singleMrp.mrp ? (
          <NumpadConfirmButton
            onConfirm={() => selectMrp(singleMrp.mrp)}
            confirmLabel={MRP_SHEET_CONFIRM_ON_LABEL(Math.round(singleMrp.mrp))}
          />
        ) : mode === 'custom' ? (
          <NumpadConfirmButton
            onConfirm={submitCustom}
            confirmLabel={canSaveCustom ? MRP_SHEET_CUSTOM_CONFIRM(customParsed) : 'Enter label price'}
            disabled={!canSaveCustom}
            tone="amber"
          />
        ) : null
      }
    >
      <PickSheetContext partCode={partCode} rackNo={rackNo} />

      {discardPrompt ? (
        <div className="mb-4 rounded-xl border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] p-4">
          <p className="text-sm font-bold text-[var(--content-warning-on-light)]">Discard entered MRP?</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setDiscardPrompt(false)}
              className="flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] py-3 text-sm font-bold pick-pressable"
            >
              Keep editing
            </button>
            <button
              type="button"
              onClick={() => {
                setDiscardPrompt(false);
                setMode('list');
                setLocalBuf('');
                onClose();
              }}
              className="flex-1 rounded-xl bg-[var(--bg-warning)] py-3 text-sm font-bold text-white pick-pressable"
            >
              Discard
            </button>
          </div>
        </div>
      ) : mode === 'list' ? (
        <>
          <div className="mb-4">
            <p className="text-base font-extrabold text-[var(--content-primary)]">
              {selectBatchMode ? MRP_SHEET_SUBHEADING_BATCH : MRP_SHEET_HEADING}
            </p>
            <p className="mt-1 text-xs text-[var(--content-tertiary)]">
              {selectBatchMode
                ? isMulti
                  ? MRP_SHEET_SUBHEADING_BATCH
                  : MRP_SHEET_SUBHEADING_BATCH_MANUAL
                : isMulti
                  ? MRP_SHEET_SUBHEADING_MULTI
                  : MRP_SHEET_SUBHEADING_SINGLE}
            </p>
          </div>

          <div className="mb-3 flex flex-col gap-1.5 sm:mb-3 sm:gap-2">
            {isLoading && history.length === 0 ? (
              <p className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-6 text-center text-sm text-[var(--content-tertiary)]">
                Loading MRP from stock…
              </p>
            ) : null}

            {!isLoading && history.length === 0 ? (
              <p className="rounded-xl border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-4 py-3 text-sm text-[var(--content-warning-on-light)]">
                {MRP_SHEET_EMPTY}
              </p>
            ) : null}

            {selectBatchMode && !isMulti && !isLoading ? (
              <button
                type="button"
                onClick={() => setMode('custom')}
                className="flex w-full items-center gap-2.5 rounded-xl border-[1.5px] border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-4 py-3 pick-pressable"
              >
                <span className="text-lg text-[var(--content-warning-on-light)]">✎</span>
                <div className="text-left">
                  <p className="text-sm font-bold text-[var(--content-warning-on-light)]">
                    Enter label price for this batch
                  </p>
                  <p className="text-[10px] text-[var(--content-warning-on-light)]/80">
                    Use when stock does not list every MRP on the shelf
                  </p>
                </div>
              </button>
            ) : null}

            {history.map((h, i) => {
              const isSuggested = h.is_latest;
              const isSelected = confirmedMrp === h.mrp && customMrp == null;
              const qtyLabel =
                h.source === 'picker_verified' || h.source === 'billing_verified'
                  ? 'warehouse verified'
                  : h.qty > 0
                    ? `${h.qty} pcs`
                    : '—';
              return (
                <button
                  key={`${h.mrp}-${i}`}
                  type="button"
                  onClick={() => selectMrp(h.mrp)}
                  className={`flex w-full min-w-0 items-center justify-between gap-2 rounded-xl border-[1.5px] px-3 py-2.5 pick-pressable sm:px-4 sm:py-3 ${
                    isSelected
                      ? 'border-[var(--border-positive)] bg-[var(--bg-positive-subtle)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)]'
                  }`}
                >
                  <div className="min-w-0 text-left">
                    <div
                      className={`pick-sheet-mrp-value font-mono font-extrabold tracking-tight ${
                        isSelected ? 'text-[var(--content-positive)]' : 'text-[var(--content-primary)]'
                      }`}
                    >
                      ₹{Math.round(h.mrp)}
                    </div>
                    <p
                      className={`mt-0.5 line-clamp-2 text-[10px] font-medium leading-snug ${
                        isSelected ? 'text-[var(--content-positive)]' : 'text-[var(--content-tertiary)]'
                      }`}
                    >
                      {qtyLabel}
                      {h.date && h.source === 'stock_mrpwise' ? ` · recorded ${h.date}` : ''}
                      {h.date && (h.source === 'picker_verified' || h.source === 'billing_verified')
                        ? ` · ${h.date}`
                        : ''}
                      {mrpHistorySourceBadge(h, isSuggested)}
                    </p>
                  </div>
                  <div
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] ${
                      isSelected
                        ? 'border-[var(--border-positive)] bg-[var(--bg-positive)]'
                        : 'border-[var(--border-subtle)]'
                    }`}
                  >
                    {isSelected && <span className="text-xs font-bold text-white">✓</span>}
                  </div>
                </button>
              );
            })}

            {!selectBatchMode || isMulti ? (
            <button
              type="button"
              onClick={() => setMode('custom')}
              className="flex w-full items-center gap-2.5 rounded-xl border-[1.5px] border-dashed border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-4 py-3 pick-pressable"
            >
              <span className="text-lg text-[var(--content-tertiary)]">✎</span>
              <div className="text-left">
                <p className="text-sm font-bold text-[var(--content-secondary)]">Different price on label</p>
                <p className="text-[10px] text-[var(--content-tertiary)]">Enter what is printed on the product</p>
              </div>
            </button>
            ) : (
              <button
                type="button"
                onClick={() => setMode('custom')}
                className="flex w-full items-center gap-2.5 rounded-xl border-[1.5px] border-dashed border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-4 py-3 pick-pressable"
              >
                <span className="text-lg text-[var(--content-tertiary)]">✎</span>
                <div className="text-left">
                  <p className="text-sm font-bold text-[var(--content-secondary)]">Another label price for next batch</p>
                  <p className="text-[10px] text-[var(--content-tertiary)]">After this batch, enter the next MRP manually</p>
                </div>
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => {
              setMode('list');
              setLocalBuf('');
            }}
            className="mb-3 text-sm font-semibold text-[var(--content-secondary)] pick-pressable"
          >
            ← Back to list
          </button>

          <div className="mb-2">
            <p className="text-base font-extrabold text-[var(--content-warning-on-light)]">
              {MRP_SHEET_CUSTOM_TITLE}
            </p>
            <p className="mt-1 text-xs text-[var(--content-tertiary)]">{MRP_SHEET_CUSTOM_HINT}</p>
          </div>

          <Numpad
            display={localBuf}
            onKey={(k) => numKey(k, localBuf, setLocalBuf)}
            onConfirm={submitCustom}
            confirmLabel={canSaveCustom ? MRP_SHEET_CUSTOM_CONFIRM(customParsed) : 'Enter label price'}
            tone="amber"
            hideConfirm
          />
        </>
      )}
    </BottomSheet>
  );
}
