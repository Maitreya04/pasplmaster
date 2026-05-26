import { useEffect, useState } from 'react';
import { BottomSheet } from '../shared';
import type { StockMrpHistoryEntry } from '../../types';
import { Numpad, NumpadConfirmButton, numKey } from './Numpad';
import { PickSheetContext } from '../picking/PickSheetContext';
import { appHaptics } from '../../lib/haptics';

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
    handleClose();
  };

  const submitCustom = (): void => {
    const v = parseInt(localBuf, 10);
    if (v > 0) {
      appHaptics.warning();
      onSelectCustomMrp(v);
      handleClose();
    }
  };

  const customParsed = parseInt(localBuf, 10);
  const canSaveCustom = Number.isFinite(customParsed) && customParsed > 0;

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={handleClose}
      title={selectBatchMode ? 'MRP for this batch' : 'MRP on label'}
      closeOnly
      keyboardBehavior="static"
      sheetClassName="max-h-[min(92dvh,92vh)] pick-sheet-compact"
      contentClassName="pick-sheet-compact"
      footer={
        mode === 'list' && singleMrp && confirmedMrp !== singleMrp.mrp ? (
          <NumpadConfirmButton
            onConfirm={() => selectMrp(singleMrp.mrp)}
            confirmLabel={`Confirm ₹${Math.round(singleMrp.mrp)} on label`}
          />
        ) : mode === 'custom' ? (
          <NumpadConfirmButton
            onConfirm={submitCustom}
            confirmLabel={canSaveCustom ? `Save ₹${customParsed} — will be flagged` : 'Enter MRP'}
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
              {selectBatchMode
                ? 'Which MRP is on this batch?'
                : 'What MRP does the label show?'}
            </p>
            <p className="mt-1 text-xs text-[var(--content-tertiary)]">
              {selectBatchMode
                ? 'Tap the MRP printed on the pieces you are picking now'
                : isMulti
                  ? `${history.length} MRP records found — tap the one on the label`
                  : singleMrp
                    ? 'One record found — confirm it matches the label'
                    : 'Confirm the MRP printed on the label'}
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
                No MRP in stock_mrpwise for this SKU — confirm what is printed on the label below.
              </p>
            ) : null}

            {history.map((h, i) => {
              const isLatest = i === 0 || h.is_latest;
              const isSelected = confirmedMrp === h.mrp && customMrp == null;
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
                      {h.qty > 0 ? `${h.qty} pcs` : '—'}
                      {h.date ? ` · recorded ${h.date}` : ''}
                      {isLatest && (
                        <span className="ml-1.5 rounded bg-[var(--bg-inverse-primary)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                          Latest
                        </span>
                      )}
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

            <button
              type="button"
              onClick={() => setMode('custom')}
              className="flex w-full items-center gap-2.5 rounded-xl border-[1.5px] border-dashed border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-4 py-3 pick-pressable"
            >
              <span className="text-lg text-[var(--content-tertiary)]">✎</span>
              <div className="text-left">
                <p className="text-sm font-bold text-[var(--content-secondary)]">Different MRP on label</p>
                <p className="text-[10px] text-[var(--content-tertiary)]">Label shows something else — enter it</p>
              </div>
            </button>
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
              Enter MRP from label
            </p>
            <p className="mt-1 text-xs text-[var(--content-tertiary)]">
              Will be flagged if it differs from system records
            </p>
          </div>

          <Numpad
            display={localBuf}
            onKey={(k) => numKey(k, localBuf, setLocalBuf)}
            onConfirm={submitCustom}
            confirmLabel={canSaveCustom ? `Save ₹${customParsed} — will be flagged` : 'Enter MRP'}
            tone="amber"
            hideConfirm
          />
        </>
      )}
    </BottomSheet>
  );
}
