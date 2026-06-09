import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle, CurrencyInr, Hash, Warning } from '@phosphor-icons/react';
import { BottomSheet } from '../shared';
import { PickSheetContext } from './PickSheetContext';
import type { StockMrpHistoryEntry } from '../../types';
import { formatRoundedRs } from '../../lib/billing/mrpWorkflowCopy';
import { validatePickMrpBatchInput } from '../../lib/picking/mrpBatchEntry';
import { appHaptics } from '../../lib/haptics';

export interface PickMrpBatchSheetProps {
  isOpen: boolean;
  remainingQty: number;
  targetQty: number;
  pickedQty: number;
  history: StockMrpHistoryEntry[];
  isLoading?: boolean;
  partCode?: string | null;
  rackNo?: string | null;
  onConfirm: (batch: { mrp: number; qty: number; custom: boolean }) => Promise<boolean> | boolean;
  onClose: () => void;
}

export function PickMrpBatchSheet({
  isOpen,
  remainingQty,
  targetQty,
  pickedQty,
  history,
  isLoading = false,
  partCode = null,
  rackNo = null,
  onConfirm,
  onClose,
}: PickMrpBatchSheetProps): React.JSX.Element | null {
  const priceInputRef = useRef<HTMLInputElement>(null);
  const [priceBuf, setPriceBuf] = useState('');
  const [qtyBuf, setQtyBuf] = useState('');
  const [selectedSuggestedMrp, setSelectedSuggestedMrp] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setPriceBuf('');
    setQtyBuf(String(Math.max(0, remainingQty)));
    setSelectedSuggestedMrp(null);
    setError(null);
    setSaving(false);
    const t = window.setTimeout(() => priceInputRef.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, [isOpen, remainingQty]);

  const suggestions = useMemo(() => {
    const seen = new Set<number>();
    const out: StockMrpHistoryEntry[] = [];
    for (const entry of history) {
      const mrp = Math.round(Number(entry.mrp));
      if (!Number.isFinite(mrp) || mrp <= 0 || seen.has(mrp)) continue;
      seen.add(mrp);
      out.push(entry);
      if (out.length >= 4) break;
    }
    return out;
  }, [history]);

  const validation = validatePickMrpBatchInput({
    priceInput: priceBuf,
    qtyInput: qtyBuf,
    remainingQty,
  });
  const confirmLabel = validation.ok
    ? `Add ${validation.qty} pcs @ ${formatRoundedRs(validation.price)}`
    : 'Add batch';

  const chooseSuggestion = (mrp: number): void => {
    appHaptics.selection();
    setSelectedSuggestedMrp(mrp);
    setPriceBuf(String(Math.round(mrp)));
    setError(null);
  };

  const handleConfirm = async (): Promise<void> => {
    const result = validatePickMrpBatchInput({
      priceInput: priceBuf,
      qtyInput: qtyBuf,
      remainingQty,
    });
    if (!result.ok) {
      appHaptics.warning();
      setError(result.error);
      return;
    }

    setSaving(true);
    setError(null);
    const ok = await onConfirm({
      mrp: result.price,
      qty: result.qty,
      custom: selectedSuggestedMrp == null || Math.round(selectedSuggestedMrp) !== result.price,
    });
    setSaving(false);

    if (ok) {
      appHaptics.success();
      onClose();
    }
  };

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={saving ? () => undefined : onClose}
      title="Add label batch"
      closeOnly
      keyboardBehavior="static"
      sheetClassName="max-h-[min(92dvh,92vh)] pick-sheet-compact"
      contentClassName="pick-sheet-compact"
      footer={
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleConfirm()}
          className="flex w-full min-h-[52px] items-center justify-center gap-2 rounded-xl bg-[var(--bg-positive)] px-3 py-3.5 text-sm font-extrabold leading-snug text-white pick-pressable disabled:opacity-40 sm:min-h-[56px] sm:text-base"
        >
          <CheckCircle size={20} weight="fill" />
          {saving ? 'Saving batch…' : confirmLabel}
        </button>
      }
    >
      <PickSheetContext partCode={partCode} rackNo={rackNo} />

      <div className="mb-3 grid grid-cols-3 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]">
        <div className="px-3 py-2.5">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
            Need
          </p>
          <p className="mt-0.5 font-mono text-lg font-extrabold tabular-nums text-[var(--content-primary)]">
            {targetQty}
          </p>
        </div>
        <div className="border-x border-[var(--border-faint)] px-3 py-2.5">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
            Picked
          </p>
          <p className="mt-0.5 font-mono text-lg font-extrabold tabular-nums text-[var(--content-primary)]">
            {pickedQty}
          </p>
        </div>
        <div className="px-3 py-2.5">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
            Balance
          </p>
          <p className="mt-0.5 font-mono text-lg font-extrabold tabular-nums text-[var(--content-warning-on-light)]">
            {remainingQty}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <label className="block">
          <span className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
            <CurrencyInr size={14} weight="bold" />
            Price on label
          </span>
          <input
            ref={priceInputRef}
            type="number"
            inputMode="numeric"
            min="1"
            value={priceBuf}
            onChange={(event) => {
              setPriceBuf(event.target.value);
              setSelectedSuggestedMrp(null);
              setError(null);
            }}
            placeholder="Enter MRP"
            className="w-full rounded-xl border-[1.5px] border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3.5 font-mono text-2xl font-extrabold tabular-nums text-[var(--content-primary)] outline-none focus:border-[var(--border-accent)]"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
            <Hash size={14} weight="bold" />
            Qty picked
          </span>
          <input
            type="number"
            inputMode="numeric"
            min="1"
            max={remainingQty}
            value={qtyBuf}
            onChange={(event) => {
              setQtyBuf(event.target.value);
              setError(null);
            }}
            className="w-full rounded-xl border-[1.5px] border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3.5 font-mono text-2xl font-extrabold tabular-nums text-[var(--content-primary)] outline-none focus:border-[var(--border-accent)]"
          />
        </label>
      </div>

      {suggestions.length > 0 || isLoading ? (
        <div className="mt-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
            Quick prices
          </p>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {isLoading && suggestions.length === 0 ? (
              <span className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-3 py-2 text-xs font-semibold text-[var(--content-tertiary)]">
                Loading…
              </span>
            ) : null}
            {suggestions.map((entry) => {
              const mrp = Math.round(Number(entry.mrp));
              const selected = selectedSuggestedMrp != null && Math.round(selectedSuggestedMrp) === mrp;
              return (
                <button
                  key={`${entry.mrp}-${entry.source ?? 'stock'}`}
                  type="button"
                  onClick={() => chooseSuggestion(mrp)}
                  className={`shrink-0 rounded-xl border px-3 py-2 text-left pick-pressable ${
                    selected
                      ? 'border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-tertiary)] text-[var(--content-secondary)]'
                  }`}
                >
                  <span className="block font-mono text-sm font-extrabold tabular-nums">
                    {formatRoundedRs(mrp)}
                  </span>
                  <span className="block text-[9px] font-medium">
                    {entry.qty > 0 ? `${entry.qty} pcs in stock` : 'seen before'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-3 py-2.5 text-xs font-semibold text-[var(--content-warning-on-light)]">
          <Warning size={16} weight="fill" className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
    </BottomSheet>
  );
}
