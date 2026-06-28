import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BottomSheet } from '../../../components/shared';
import { appHaptics } from '../../../lib/haptics';
import { mrpBatchLabel } from '../../../lib/picking/pickerMicrocopy';
import type { StockMrpHistoryEntry } from '../../../types';
import type { UsePickEntryDraftReturn } from '../hooks/usePickEntryDraft';
import { GapState, PickCompleteState } from './GapState';
import { Numpad, NumpadConfirmButton, nextNumKey } from './Numpad';
import { OverPickBanner } from './OverPickBanner';
import { OverPickNoteSheet } from './OverPickNoteSheet';
import { PickedLedger } from './PickedLedger';
import { PriceFixOverlay } from './PriceFixOverlay';

export type PickModalView = 'mrp' | 'qty' | 'gap';
export type LedgerEditField = 'mrp' | 'qty' | null;

export interface PickEntryModalProps {
  isOpen: boolean;
  partCode: string;
  rackNo: string | null;
  draftState: UsePickEntryDraftReturn;
  modalView: PickModalView;
  ledgerEditField?: LedgerEditField;
  onEditGroupMrp: (groupId: string) => void;
  onEditGroupQty: (groupId: string) => void;
  onClose: () => void;
  onAdvanceToQty: () => void;
  onSwitchToQty: () => void;
  onConfirmGroup: () => void;
  onNextLabel: () => void;
  onShortStock: () => void;
  onMarkPicked: () => void;
  onOpenPriceFix: () => void;
  onPriceFixConfirm: (mrp: number) => void;
  priceFixOpen: boolean;
  onPriceFixClose: () => void;
  flashGroupId?: string | null;
  suggestedMrp?: number | null;
  stockMrp?: number | null;
  alternates?: StockMrpHistoryEntry[];
  mrpSuggestionLoading?: boolean;
  onSuggestedMrpApplied?: (mrp: number) => void;
}

function qtyTone(
  qty: number | null,
  remaining: number,
  isOverTarget: boolean,
): 'default' | 'success' | 'danger' {
  if (qty == null || qty <= 0) return 'default';
  if (isOverTarget) return 'danger';
  if (qty === remaining) return 'success';
  return 'default';
}

function qtyHelper(
  qty: number | null,
  remaining: number,
  isOverTarget: boolean,
  hasNote: boolean,
): string {
  if (qty == null || qty <= 0) return 'tap a number';
  if (isOverTarget) return hasNote ? 'Ready to pick ✓' : 'Tap banner or Add reason →';
  if (qty === remaining) return 'Finishes this item ✓';
  if (qty < remaining) return `still ${remaining - qty} left after this`;
  return '';
}

function qtyCtaLabel(
  qty: number | null,
  remaining: number,
  isOverTarget: boolean,
  hasNote: boolean,
  editQtyOnly: boolean,
): string {
  if (editQtyOnly) {
    if (qty == null || qty <= 0) return 'Enter qty →';
    if (isOverTarget) return hasNote ? `Save ${qty} →` : 'Add reason →';
    return `Save ${qty} →`;
  }
  if (qty == null || qty <= 0) return `Pick ${remaining} →`;
  if (isOverTarget) return hasNote ? `Pick ${qty} →` : 'Add reason →';
  if (qty === remaining) return `Pick all ${qty} →`;
  return `Pick ${qty} →`;
}

function alternateChipLabel(entry: StockMrpHistoryEntry): string {
  const mrp = Math.round(entry.mrp);
  if (entry.recent_pick_count != null && entry.recent_pick_count > 0) {
    return `₹${mrp} · ${entry.recent_pick_count}×`;
  }
  if (entry.source === 'stock_mrpwise') return `₹${mrp} stock`;
  if (entry.source === 'billing_verified') return `₹${mrp} billing`;
  if (entry.confirmation_count != null && entry.confirmation_count > 1) {
    return `₹${mrp} · ${entry.confirmation_count}×`;
  }
  return `₹${mrp}`;
}

export function PickEntryModal({
  isOpen,
  partCode,
  rackNo,
  draftState,
  modalView,
  ledgerEditField = null,
  onEditGroupMrp,
  onEditGroupQty,
  onClose,
  onAdvanceToQty,
  onSwitchToQty,
  onConfirmGroup,
  onNextLabel,
  onShortStock,
  onMarkPicked,
  onOpenPriceFix,
  onPriceFixConfirm,
  priceFixOpen,
  onPriceFixClose,
  flashGroupId,
  suggestedMrp = null,
  stockMrp = null,
  alternates = [],
  mrpSuggestionLoading = false,
  onSuggestedMrpApplied,
}: PickEntryModalProps): React.JSX.Element {
  const { draft, totalLogged, remaining, setNote, setMrp } = draftState;
  const ip = draft.inProgress;

  const [mrpBuf, setMrpBuf] = useState('');
  const [qtyBuf, setQtyBuf] = useState('');
  const [noteSheetOpen, setNoteSheetOpen] = useState(false);
  const [qtyShake, setQtyShake] = useState(false);
  const wasOverRef = useRef(false);
  const hadNoteRef = useRef(false);
  const editSessionRef = useRef<string | null>(null);
  const qtySessionRef = useRef<string | null>(null);
  const prefillSessionRef = useRef<string | null>(null);
  const mrpReplaceOnNextDigitRef = useRef(false);
  const qtyReplaceOnNextDigitRef = useRef(false);
  const mrpBufRef = useRef(mrpBuf);
  const qtyBufRef = useRef(qtyBuf);
  const [mrpReplaceHint, setMrpReplaceHint] = useState(false);
  const [qtyReplaceHint, setQtyReplaceHint] = useState(false);

  mrpBufRef.current = mrpBuf;
  qtyBufRef.current = qtyBuf;

  const activeBatchIndex =
    ip != null && modalView !== 'gap'
      ? draft.confirmedGroups.length
      : Math.max(0, draft.confirmedGroups.length - 1);
  const activeMrpLabel = mrpBatchLabel(activeBatchIndex);

  const mrpValue = useMemo(() => {
    const parsed = parseInt(mrpBuf, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [mrpBuf]);

  const qtyValue = useMemo(() => {
    const parsed = parseInt(qtyBuf, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [qtyBuf]);

  const effectiveRemaining = remaining;
  const overForQty = qtyValue != null && totalLogged + qtyValue > draft.targetQty;
  const extraForQty = qtyValue != null ? Math.max(0, qtyValue - effectiveRemaining) : 0;
  const noteRequired = overForQty;
  const hasNote = draft.noteText.trim().length > 0;
  const editQtyOnly = ledgerEditField === 'qty';

  useEffect(() => {
    if (overForQty && !wasOverRef.current) {
      appHaptics.warning();
      setQtyShake(true);
      const timer = window.setTimeout(() => setQtyShake(false), 420);
      wasOverRef.current = true;
      return () => window.clearTimeout(timer);
    }
  }, [overForQty]);

  useEffect(() => {
    if (!overForQty) {
      wasOverRef.current = false;
      if (draft.noteText.trim()) {
        setNote('');
      }
      setNoteSheetOpen(false);
    }
  }, [overForQty, draft.noteText, setNote]);

  useEffect(() => {
    if (hasNote && !hadNoteRef.current && noteRequired) {
      appHaptics.success();
    }
    hadNoteRef.current = hasNote;
  }, [hasNote, noteRequired]);

  const markMrpPrefilled = useCallback((): void => {
    mrpReplaceOnNextDigitRef.current = true;
    setMrpReplaceHint(true);
  }, []);

  const markQtyPrefilled = useCallback((): void => {
    qtyReplaceOnNextDigitRef.current = true;
    setQtyReplaceHint(true);
  }, []);

  const seedQtyBalance = (): void => {
    const balance = Math.max(0, effectiveRemaining);
    if (balance <= 0) {
      setQtyBuf('');
      draftState.setQty(null);
      qtyReplaceOnNextDigitRef.current = false;
      setQtyReplaceHint(false);
      return;
    }
    setQtyBuf(String(balance));
    draftState.setQty(balance);
    markQtyPrefilled();
  };

  useEffect(() => {
    if (!isOpen) {
      editSessionRef.current = null;
      qtySessionRef.current = null;
      prefillSessionRef.current = null;
      return;
    }
    if (modalView === 'gap') {
      qtySessionRef.current = null;
      setMrpBuf('');
      setQtyBuf('');
      return;
    }
    if (modalView === 'mrp') {
      qtySessionRef.current = null;
      setQtyBuf('');
    }
  }, [isOpen, modalView]);

  useEffect(() => {
    if (!isOpen || modalView !== 'qty' || editQtyOnly) return;

    const batchKey = `qty-${draft.confirmedGroups.length}-${ip?.mrp ?? 'none'}`;
    if (qtySessionRef.current === batchKey) return;
    qtySessionRef.current = batchKey;

    if (ip?.qty == null) {
      seedQtyBalance();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed when batch/mrp context changes
  }, [isOpen, modalView, editQtyOnly, draft.confirmedGroups.length, ip?.mrp, ip?.qty, effectiveRemaining]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (editQtyOnly && draft.editingGroupId) {
      const sessionKey = draft.editingGroupId;
      if (editSessionRef.current === sessionKey) return;
      editSessionRef.current = sessionKey;
      if (ip?.mrp != null) {
        setMrpBuf(String(Math.round(ip.mrp)));
        markMrpPrefilled();
      }
      if (ip?.qty != null) {
        setQtyBuf(String(ip.qty));
        markQtyPrefilled();
      }
      return;
    }
    if (modalView === 'mrp' && ip?.mrp != null) {
      const sessionKey = `mrp-sync-${draft.confirmedGroups.length}`;
      if (editSessionRef.current === sessionKey) return;
      editSessionRef.current = sessionKey;
      setMrpBuf(String(Math.round(ip.mrp)));
      markMrpPrefilled();
    }
  }, [draft.editingGroupId, editQtyOnly, ip, isOpen, modalView, draft.confirmedGroups.length, markMrpPrefilled, markQtyPrefilled]);

  useEffect(() => {
    if (!isOpen || modalView !== 'mrp' || editQtyOnly || draft.editingGroupId) return;
    if (mrpSuggestionLoading || suggestedMrp == null || suggestedMrp <= 0) return;

    const sessionKey = `prefill-${draft.confirmedGroups.length}`;
    if (prefillSessionRef.current === sessionKey) return;
    prefillSessionRef.current = sessionKey;

    setMrpBuf(String(Math.round(suggestedMrp)));
    setMrp(Math.round(suggestedMrp));
    markMrpPrefilled();
    onSuggestedMrpApplied?.(Math.round(suggestedMrp));
  }, [
    draft.confirmedGroups.length,
    draft.editingGroupId,
    editQtyOnly,
    isOpen,
    modalView,
    markMrpPrefilled,
    mrpSuggestionLoading,
    onSuggestedMrpApplied,
    setMrp,
    suggestedMrp,
  ]);

  const applyMrpSelection = (mrp: number): void => {
    const rounded = Math.round(mrp);
    setMrpBuf(String(rounded));
    draftState.setMrp(rounded);
    markMrpPrefilled();
    appHaptics.selection();
  };

  const showStockHint =
    stockMrp != null &&
    stockMrp > 0 &&
    (mrpValue == null || Math.round(stockMrp) !== mrpValue);

  const chipEntries = useMemo(() => {
    const seen = new Set<number>();
    const rows: StockMrpHistoryEntry[] = [];
    for (const entry of alternates) {
      const key = Math.round(entry.mrp);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(entry);
      if (rows.length >= 4) break;
    }
    return rows;
  }, [alternates]);

  const handleEditInProgressMrp = (): void => {
    if (ledgerEditField === 'qty') return;
    onOpenPriceFix();
  };

  const handleEditInProgressQty = (): void => {
    if (ledgerEditField === 'mrp') return;
    onSwitchToQty();
  };

  const ledgerProps = {
    draft,
    totalLogged,
    onEditGroupMrp,
    onEditGroupQty,
    onEditInProgressMrp: handleEditInProgressMrp,
    onEditInProgressQty: handleEditInProgressQty,
    flashGroupId,
    context: 'modal' as const,
  };

  const handleMrpKey = (key: string): void => {
    const next = nextNumKey(key, mrpBufRef.current, {
      replaceOnNextDigit: mrpReplaceOnNextDigitRef,
    });
    setMrpBuf(next);
    setMrpReplaceHint(false);
    const parsed = parseInt(next, 10);
    draftState.setMrp(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
  };

  const handleQtyKey = (key: string): void => {
    const next = nextNumKey(key, qtyBufRef.current, {
      replaceOnNextDigit: qtyReplaceOnNextDigitRef,
    });
    setQtyBuf(next);
    setQtyReplaceHint(false);
    const parsed = parseInt(next, 10);
    draftState.setQty(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
  };

  const handleClose = (): void => {
    setMrpBuf('');
    setQtyBuf('');
    setNoteSheetOpen(false);
    mrpReplaceOnNextDigitRef.current = false;
    qtyReplaceOnNextDigitRef.current = false;
    setMrpReplaceHint(false);
    setQtyReplaceHint(false);
    onClose();
  };

  const handleOpenNoteSheet = (): void => {
    appHaptics.selection();
    setNoteSheetOpen(true);
  };

  const handleQtyConfirm = (): void => {
    if (overForQty && !hasNote) {
      setNoteSheetOpen(true);
      appHaptics.warning();
      return;
    }
    onConfirmGroup();
  };

  const subtitle = `${partCode} · ${rackNo ?? '—'}`;
  const activeMrp = Math.round(ip?.mrp ?? mrpValue ?? 0);

  const qtyHeroSupporting =
    modalView === 'qty' && activeMrp > 0 ? (
      <>
        at{' '}
        {editQtyOnly ? (
          <span className="font-mono font-bold text-content-signal-ok">₹{activeMrp}</span>
        ) : (
          <button
            type="button"
            onClick={onOpenPriceFix}
            className="font-mono font-bold text-content-signal-ok pick-pressable"
            aria-label={`Edit ${activeMrpLabel}`}
          >
            ₹{activeMrp}
          </button>
        )}
        {' · '}
        {activeMrpLabel}
        {effectiveRemaining > 0 && !editQtyOnly
          ? ` · ${effectiveRemaining} left on line`
          : ''}
      </>
    ) : null;

  const ledgerRemaining =
    modalView === 'qty' && qtyValue
      ? Math.max(0, effectiveRemaining - qtyValue)
      : effectiveRemaining;

  const entryFooter =
    modalView === 'mrp' || modalView === 'qty' ? (
      <div className="pick-entry-deck space-y-2">
        {modalView === 'mrp' ? (
          <div className="pick-entry-deck pick-entry-deck--mrp">
            {mrpSuggestionLoading ? (
              <p className="text-center font-ds-micro text-[var(--content-tertiary)]">
                Loading price suggestions…
              </p>
            ) : null}
            {showStockHint ? (
              <button
                type="button"
                onClick={() => applyMrpSelection(stockMrp!)}
                className="w-full text-center font-ds-micro text-[var(--content-tertiary)] pick-pressable"
              >
                Stock band ₹{Math.round(stockMrp!)} · tap to use
              </button>
            ) : null}
            {chipEntries.length > 0 ? (
              <div className="flex flex-wrap justify-center gap-1.5">
                {chipEntries.map((entry) => {
                  const rounded = Math.round(entry.mrp);
                  const selected = mrpValue === rounded;
                  return (
                    <button
                      key={`${entry.mrp}-${entry.source ?? 'x'}`}
                      type="button"
                      onClick={() => applyMrpSelection(rounded)}
                      className={`rounded-full border px-2.5 py-1 font-mono text-xs font-bold tabular-nums pick-pressable ${
                        selected
                          ? 'border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--content-primary)]'
                      }`}
                    >
                      {alternateChipLabel(entry)}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <Numpad
              display={mrpBuf}
              tone="money"
              layout="deck"
              heroMoney
              compactHero
              heroHint={mrpReplaceHint ? 'Suggested · type a digit to replace, then keep typing' : undefined}
              emptyPlaceholder="—"
              onKey={handleMrpKey}
            />
          </div>
        ) : (
          <div className="pick-entry-deck pick-entry-deck--qty">
            <div className={qtyShake ? 'animate-shake' : undefined}>
              <Numpad
                display={qtyBuf}
                tone={qtyTone(qtyValue, effectiveRemaining, overForQty)}
                layout="deck"
                heroQty
                compactHero
                heroSupporting={qtyHeroSupporting}
                heroHint={
                  qtyReplaceHint && !editQtyOnly
                    ? 'Prefilled · type a digit to replace, then keep typing'
                    : undefined
                }
                emptyPlaceholder="—"
                onKey={handleQtyKey}
              />
            </div>
            <p
              className={`pick-entry-deck-hint text-center font-ds-micro transition-colors ${
                overForQty
                  ? hasNote
                    ? 'text-[var(--content-positive)]'
                    : 'text-[var(--content-negative)]'
                  : qtyValue === effectiveRemaining
                    ? 'text-[var(--content-positive)]'
                    : 'text-[var(--content-tertiary)]'
              }`}
            >
              {qtyHelper(qtyValue, effectiveRemaining, overForQty, hasNote)}
            </p>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="min-h-11 rounded-xl border border-[var(--border-subtle)] font-ds-body-size font-semibold text-[var(--content-secondary)] pick-pressable"
          >
            Cancel
          </button>
          <div className="col-span-2">
            {modalView === 'mrp' ? (
              <NumpadConfirmButton
                confirmLabel={
                  mrpValue ? `How many at ₹${mrpValue} →` : 'How many at this price? →'
                }
                disabled={!mrpValue}
                      onConfirm={() => {
                        if (mrpValue) {
                          draftState.setMrp(mrpValue);
                          draftState.advanceToQty();
                          if (!editQtyOnly) {
                            seedQtyBalance();
                            qtySessionRef.current = `qty-${draft.confirmedGroups.length}-${mrpValue}`;
                          }
                          onAdvanceToQty();
                        }
                      }}
              />
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setQtyBuf(String(effectiveRemaining));
                    draftState.setQty(effectiveRemaining);
                  }}
                  className="min-h-11 rounded-xl border border-[var(--border-subtle)] font-ds-caption-size font-bold text-[var(--content-secondary)] pick-pressable"
                >
                  All {effectiveRemaining}
                </button>
                <NumpadConfirmButton
                  confirmLabel={qtyCtaLabel(
                    qtyValue,
                    effectiveRemaining,
                    overForQty,
                    hasNote,
                    editQtyOnly,
                  )}
                  disabled={!qtyValue}
                  tone={
                    overForQty && !hasNote
                      ? 'amber'
                      : overForQty && hasNote
                        ? 'danger'
                        : qtyValue === effectiveRemaining
                          ? 'success'
                          : 'default'
                  }
                  onConfirm={handleQtyConfirm}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    ) : null;

  return (
    <>
      <BottomSheet
        isOpen={isOpen}
        onClose={handleClose}
        title=""
        keepMounted
        keyboardBehavior="static"
        sheetClassName="max-h-[min(94dvh,94vh)] pick-sheet-compact pick-entry-sheet"
        contentClassName="pick-sheet-compact pick-entry-sheet-body !px-3 !pb-2"
        footer={entryFooter}
      >
        {modalView === 'gap' ? (
          <>
            <PickedLedger
              {...ledgerProps}
              remaining={effectiveRemaining}
              mode="full"
            />
            {effectiveRemaining > 0 ? (
              <GapState
                remainingQty={effectiveRemaining}
                totalLogged={totalLogged}
                uom={draft.uom}
                onNextLabel={onNextLabel}
                onShortStock={onShortStock}
              />
            ) : (
              <PickCompleteState
                targetQty={draft.targetQty}
                uom={draft.uom}
                onMarkPicked={onMarkPicked}
              />
            )}
          </>
        ) : (
          <>
            <div className="pb-2">
              {modalView === 'mrp' ? (
                <>
                  <p className="font-ds-body-size font-medium leading-snug text-[var(--content-primary)]">
                    What&apos;s the {activeMrpLabel} on the label?
                  </p>
                  <p className="font-ds-micro text-[var(--content-tertiary)]">{subtitle}</p>
                </>
              ) : (
                <p className="font-mono font-ds-caption-size font-semibold text-[var(--content-secondary)]">
                  {subtitle}
                </p>
              )}
            </div>

            {(totalLogged > 0 || ledgerRemaining > 0) && (
              <div className="mb-2">
                <PickedLedger
                  {...ledgerProps}
                  remaining={ledgerRemaining}
                  mode="strip"
                />
              </div>
            )}

            {modalView === 'qty' && overForQty ? (
              <div className="mb-1">
                <OverPickBanner
                  extraQty={extraForQty}
                  remainingQty={effectiveRemaining}
                  uom={draft.uom}
                  note={draft.noteText}
                  onOpenNote={handleOpenNoteSheet}
                />
              </div>
            ) : null}
          </>
        )}
      </BottomSheet>

      <OverPickNoteSheet
        isOpen={noteSheetOpen && isOpen && modalView === 'qty'}
        extraQty={extraForQty}
        remainingQty={effectiveRemaining}
        uom={draft.uom}
        note={draft.noteText}
        onNoteChange={setNote}
        onClose={() => setNoteSheetOpen(false)}
        onSave={() => setNoteSheetOpen(false)}
      />

      <PriceFixOverlay
        isOpen={priceFixOpen && !editQtyOnly}
        qty={ip?.qty ?? qtyValue ?? 0}
        uom={draft.uom}
        oldMrp={ip?.mrp ?? 0}
        onClose={onPriceFixClose}
        onConfirm={onPriceFixConfirm}
      />
    </>
  );
}
