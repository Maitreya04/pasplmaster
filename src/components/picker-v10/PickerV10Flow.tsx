import { useCallback, useMemo, useState } from 'react';
import { BottomSheet } from '../shared';
import { useStockMrpHistory } from '../../hooks/useStockMrpHistory';
import type { StockMrpHistoryEntry } from '../../types';
import { DoneList } from './DoneList';
import { MrpHistorySheet } from './MrpHistorySheet';
import { Numpad, numKey } from './Numpad';
import { PickDock } from './PickDock';
import { PickItemCard } from './PickItemCard';
import type {
  PickDockStep,
  PickerV10DoneEntry,
  PickerV10Line,
  PickerV10PickResult,
  PickerV10Sheet,
} from './types';
import { VerifySheet } from './VerifySheet';

export interface PickerV10FlowProps {
  lines: PickerV10Line[];
  orderLabel: string;
  customerLabel?: string;
  /** When true, onPickLineComplete is called for each finished line. */
  liveWrite?: boolean;
  onPickLineComplete?: (result: PickerV10PickResult) => void | Promise<void>;
  onAllComplete?: (entries: PickerV10DoneEntry[]) => void;
}

const FLAG_REASONS = ['Wrong item', 'Damaged goods', 'Wrong location', 'Duplicate pick', 'Other'];

export function PickerV10Flow({
  lines,
  orderLabel,
  customerLabel,
  liveWrite = false,
  onPickLineComplete,
  onAllComplete,
}: PickerV10FlowProps): React.JSX.Element {
  const total = lines.length;
  const [itemIdx, setItemIdx] = useState(0);
  const [done, setDone] = useState<PickerV10DoneEntry[]>([]);
  const [verified, setVerified] = useState(false);
  const [confirmedMrp, setConfirmedMrp] = useState<number | null>(null);
  const [customMrp, setCustomMrp] = useState<number | null>(null);
  const [editedQty, setEditedQty] = useState<number | null>(null);
  const [outOfStock, setOutOfStock] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sheet, setSheet] = useState<PickerV10Sheet>(null);
  const [numBuf, setNumBuf] = useState('');
  const [typeBuf, setTypeBuf] = useState('');
  const [typeErr, setTypeErr] = useState(false);
  const [flagRsn, setFlagRsn] = useState('');

  const item = lines[itemIdx % Math.max(total, 1)] ?? lines[0]!;

  const { data: fetchedMrp, isLoading: mrpLoading } = useStockMrpHistory(
    item.busyCode,
    item.stockLocationCode ?? null,
    null,
    !item.mrpHistory?.length && item.busyCode != null,
  );

  const mrpHistory: StockMrpHistoryEntry[] = useMemo(() => {
    if (item.mrpHistory?.length) return item.mrpHistory;
    if (fetchedMrp?.history?.length) return fetchedMrp.history;
    return [];
  }, [item.mrpHistory, fetchedMrp?.history]);

  const latestMrp = mrpHistory[0]?.mrp ?? fetchedMrp?.latest_mrp ?? null;
  const finalMrp = customMrp ?? confirmedMrp;
  const mrpFlagged = finalMrp != null && latestMrp != null && finalMrp !== latestMrp;
  const dispQty = outOfStock ? 0 : (editedQty ?? item.qty);
  const canDone =
    verified && (outOfStock || (finalMrp != null && dispQty > 0));
  const pct = total > 0 ? (done.length / total) * 100 : 0;

  const dockStep: PickDockStep = !verified
    ? 'verify'
    : finalMrp == null && !outOfStock
      ? 'mrp'
      : 'done';

  const resetItem = useCallback((): void => {
    setVerified(false);
    setConfirmedMrp(null);
    setCustomMrp(null);
    setEditedQty(null);
    setOutOfStock(false);
    setConfirming(false);
    setSheet(null);
    setNumBuf('');
    setTypeBuf('');
    setTypeErr(false);
    setFlagRsn('');
  }, []);

  const confirmDone = useCallback(async (): Promise<void> => {
    if (!canDone) return;
    setConfirming(true);

    const entry: PickerV10DoneEntry = {
      code: item.code,
      qty: dispQty,
      confirmedMrp: finalMrp,
      latestMrp,
      mrpFlagged,
      outOfStock,
      historyCount: mrpHistory.length,
    };

    const pickResult: PickerV10PickResult = {
      line: item,
      qty: dispQty,
      confirmedMrp: finalMrp,
      latestMrp,
      mrpFlagged,
      outOfStock,
      mrpSource: customMrp != null ? 'custom' : fetchedMrp?.source === 'items_fallback' ? 'items_fallback' : 'stock_mrpwise',
      historyCount: mrpHistory.length,
    };

    if (liveWrite && onPickLineComplete) {
      await onPickLineComplete(pickResult);
    }

    window.setTimeout(() => {
      const nextDone = [...done, entry];
      setDone(nextDone);
      const nextIdx = itemIdx + 1;
      if (nextIdx >= total) {
        onAllComplete?.(nextDone);
      } else {
        setItemIdx(nextIdx);
      }
      resetItem();
    }, 300);
  }, [
    canDone,
    customMrp,
    dispQty,
    done,
    fetchedMrp?.source,
    finalMrp,
    item,
    itemIdx,
    latestMrp,
    liveWrite,
    mrpFlagged,
    mrpHistory.length,
    onAllComplete,
    onPickLineComplete,
    outOfStock,
    resetItem,
    total,
  ]);

  const typeVerify = (): void => {
    if (typeBuf.toUpperCase() === item.code.slice(-4)) {
      setVerified(true);
      setSheet(null);
      setTypeErr(false);
    } else {
      setTypeErr(true);
    }
  };

  const verifySheetOpen = sheet === 'verify' || sheet === 'verify-type';

  if (total === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-[var(--content-tertiary)]">No pick lines to show.</p>
    );
  }

  if (itemIdx >= total && done.length >= total) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-2xl font-bold text-[var(--content-positive)]">All items picked</p>
        <p className="mt-2 text-sm text-[var(--content-tertiary)]">{done.length} lines complete</p>
        <DoneList entries={done} />
      </div>
    );
  }

  return (
    <div className="role-picking relative mx-auto min-h-[70vh] max-w-[390px] bg-[var(--bg-primary)]">
      <div className="px-5 pb-3.5 pt-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-bold tracking-tight text-[var(--content-primary)]">{orderLabel}</p>
            {customerLabel && (
              <p className="mt-0.5 text-[11px] text-[var(--content-tertiary)]">{customerLabel}</p>
            )}
          </div>
          <div className="text-right">
            <p className="font-mono text-3xl font-extrabold leading-none tracking-tight text-[var(--content-primary)]">
              {done.length}
              <span className="text-sm font-normal text-[var(--content-tertiary)]">/{total}</span>
            </p>
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
              items picked
            </p>
          </div>
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded bg-[var(--border-subtle)]">
          <div
            className="h-full rounded bg-[var(--bg-inverse-primary)] transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="pb-52">
        <PickItemCard
          item={item}
          itemIndex={itemIdx}
          total={total}
          verified={verified}
          confirming={confirming}
          confirmedMrp={confirmedMrp}
          customMrp={customMrp}
          editedQty={editedQty}
          outOfStock={outOfStock}
          mrpHistory={mrpHistory}
          onEditQty={() => {
            setNumBuf(String(dispQty));
            setSheet('qty');
          }}
          onEditMrp={() => setSheet('mrp-history')}
        />
        {mrpLoading && !item.mrpHistory?.length && (
          <p className="mt-2 text-center text-xs text-[var(--content-tertiary)]">Loading MRP history…</p>
        )}
        <DoneList entries={done} />
      </div>

      <div className="fixed bottom-0 left-1/2 z-30 w-full max-w-[390px] -translate-x-1/2 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] pb-7">
        <PickDock
          step={dockStep}
          item={item}
          mrpHistory={mrpHistory}
          finalMrp={finalMrp}
          mrpFlagged={mrpFlagged}
          dispQty={dispQty}
          outOfStock={outOfStock}
          confirming={confirming}
          onVerify={() => setSheet('verify')}
          onConfirmMrp={() => setSheet('mrp-history')}
          onDone={() => void confirmDone()}
          onFlag={() => setSheet('flag')}
        />
      </div>

      <VerifySheet
        isOpen={verifySheetOpen}
        item={item}
        mode={sheet === 'verify-type' ? 'verify-type' : 'verify'}
        typeBuf={typeBuf}
        typeErr={typeErr}
        onTypeBufChange={(v) => {
          setTypeBuf(v);
          setTypeErr(false);
        }}
        onTypeVerify={typeVerify}
        onVerified={() => {
          setVerified(true);
          setSheet(null);
        }}
        onOpenTypeMode={() => setSheet('verify-type')}
        onClose={() => setSheet(null)}
      />

      <MrpHistorySheet
        isOpen={sheet === 'mrp-history'}
        history={mrpHistory}
        confirmedMrp={confirmedMrp}
        customMrp={customMrp}
        onSelectMrp={(mrp) => {
          setConfirmedMrp(mrp);
          setCustomMrp(null);
          setSheet(null);
        }}
        onSelectCustomMrp={(mrp) => {
          setCustomMrp(mrp);
          setConfirmedMrp(null);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
      />

      <BottomSheet isOpen={sheet === 'qty'} onClose={() => setSheet(null)} title="Edit quantity" closeOnly>
        <button
          type="button"
          onClick={() => {
            setOutOfStock(true);
            setEditedQty(0);
            setSheet(null);
          }}
          className="mb-4 w-full rounded-xl border-[1.5px] border-[var(--border-negative)] bg-[var(--bg-negative-subtle)] py-3.5 text-sm font-bold text-[var(--content-negative)] pick-pressable"
        >
          Out of stock — skip item
        </button>
        <Numpad
          display={numBuf}
          onKey={(k) => numKey(k, numBuf, setNumBuf)}
          onConfirm={() => {
            const v = parseInt(numBuf, 10);
            if (v > 0) setEditedQty(v);
            setSheet(null);
          }}
          confirmLabel={`Set ${numBuf || 0} pcs`}
        />
      </BottomSheet>

      <BottomSheet isOpen={sheet === 'flag'} onClose={() => setSheet(null)} title="Flag this item" closeOnly>
        <div className="mb-4 flex flex-wrap gap-2">
          {FLAG_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setFlagRsn(r)}
              className={`rounded-full border-[1.5px] px-3.5 py-2 text-sm font-semibold pick-pressable ${
                flagRsn === r
                  ? 'border-[var(--bg-inverse-primary)] bg-[var(--bg-inverse-primary)] text-white'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--content-primary)]'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={!flagRsn}
          onClick={() => setSheet(null)}
          className="w-full rounded-xl bg-[var(--bg-inverse-primary)] py-4 text-base font-extrabold text-white pick-pressable disabled:opacity-40"
        >
          Submit flag
        </button>
      </BottomSheet>
    </div>
  );
}
