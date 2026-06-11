import { useCallback, useMemo, useState } from 'react';
import { BottomSheet } from '../shared';
import { useStockMrpHistory } from '../../hooks/useStockMrpHistory';
import { appHaptics } from '../../lib/haptics';
import type { StockMrpHistoryEntry } from '../../types';
import { GapStateScreen } from './GapStateScreen';
import { IdentifyScreen } from './IdentifyScreen';
import { ItemCompleteOverlay } from './ItemCompleteOverlay';
import { MrpEntryScreen, numKey } from './MrpEntryScreen';
import { numKey as qtyNumKey } from './Numpad';
import { QtyEntryScreen } from './QtyEntryScreen';
import { RackListScreen } from './RackListScreen';
import { SessionSummaryScreen } from './SessionSummaryScreen';
import { VerifySheet } from './VerifySheet';
import type {
  PickerV10DoneEntry,
  PickerV10Line,
  PickerV10LineProgress,
  PickerV10LoggedBatch,
  PickerV10Phase,
  PickerV10PickResult,
} from './types';

export interface PickerV10FlowProps {
  lines: PickerV10Line[];
  orderLabel: string;
  customerLabel?: string;
  /** When true, onPickLineComplete is called for each finished line. */
  liveWrite?: boolean;
  onPickLineComplete?: (result: PickerV10PickResult) => void | Promise<void>;
  onAllComplete?: (entries: PickerV10DoneEntry[]) => void;
  onHandoff?: (payload: { boxCount: number; entries: PickerV10DoneEntry[] }) => void;
}

const FLAG_REASONS = ['Wrong item', 'Damaged goods', 'Wrong location', 'Short stock', 'Other'];

function emptyProgress(): PickerV10LineProgress {
  return { status: 'pending', loggedQty: 0, batches: [] };
}

function positionLabel(itemIdx: number, total: number): string {
  return `${itemIdx + 1} / ${total} lines`;
}

export function PickerV10Flow({
  lines,
  orderLabel,
  customerLabel,
  liveWrite = false,
  onPickLineComplete,
  onAllComplete,
  onHandoff,
}: PickerV10FlowProps): React.JSX.Element {
  const total = lines.length;
  const [itemIdx, setItemIdx] = useState(0);
  const [phase, setPhase] = useState<PickerV10Phase>('rack_list');
  const [lineProgress, setLineProgress] = useState<Record<number, PickerV10LineProgress>>({});
  const [doneEntries, setDoneEntries] = useState<PickerV10DoneEntry[]>([]);
  const [boxCount, setBoxCount] = useState(1);

  const [verifyOpen, setVerifyOpen] = useState(false);
  const [typeBuf, setTypeBuf] = useState('');
  const [typeErr, setTypeErr] = useState(false);
  const [verifySheetMode, setVerifySheetMode] = useState<'verify' | 'verify-type'>('verify');

  const [mrpBuf, setMrpBuf] = useState('');
  const [currentMrp, setCurrentMrp] = useState<number | null>(null);
  const [qtyBuf, setQtyBuf] = useState('');
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [remainingQty, setRemainingQty] = useState(0);

  const [flagOpen, setFlagOpen] = useState(false);
  const [flagRsn, setFlagRsn] = useState('');

  const item = lines[itemIdx % Math.max(total, 1)] ?? lines[0];
  const progress = lineProgress[item?.id ?? 0] ?? emptyProgress();

  const { data: fetchedMrp, isLoading: mrpLoading } = useStockMrpHistory(
    item?.busyCode ?? null,
    item?.stockLocationCode ?? null,
    null,
    item != null && !item.mrpHistory?.length && item.busyCode != null,
  );

  const mrpHistory: StockMrpHistoryEntry[] = useMemo(() => {
    if (!item) return [];
    if (item.mrpHistory?.length) return item.mrpHistory;
    if (fetchedMrp?.history?.length) return fetchedMrp.history;
    return [];
  }, [item, fetchedMrp?.history]);

  const latestMrp = mrpHistory[0]?.mrp ?? fetchedMrp?.latest_mrp ?? null;

  const nextItem = useMemo(() => {
    for (let i = itemIdx + 1; i < lines.length; i++) {
      const p = lineProgress[lines[i]!.id];
      if (p?.status !== 'done' && p?.status !== 'flagged') return lines[i]!;
    }
    return null;
  }, [itemIdx, lineProgress, lines]);

  const resetLineEntry = useCallback((): void => {
    setMrpBuf('');
    setCurrentMrp(null);
    setQtyBuf('');
    setNote('');
    setNoteOpen(false);
    setRemainingQty(0);
    setTypeBuf('');
    setTypeErr(false);
  }, []);

  const goToLine = useCallback(
    (idx: number): void => {
      setItemIdx(idx);
      resetLineEntry();
      setPhase('identify');
      setVerifyOpen(false);
    },
    [resetLineEntry],
  );

  const pickNextUndone = useCallback((): void => {
    const idx = lines.findIndex((l) => {
      const p = lineProgress[l.id];
      return p?.status !== 'done' && p?.status !== 'flagged';
    });
    if (idx >= 0) goToLine(idx);
    else setPhase('session_summary');
  }, [goToLine, lineProgress, lines]);

  const finishLine = useCallback(
    async (
      lineId: number,
      loggedQty: number,
      batches: PickerV10LoggedBatch[],
      flagged: boolean,
      flagReason?: string,
    ): Promise<void> => {
      const line = lines.find((l) => l.id === lineId);
      if (!line) return;

      const primaryMrp = batches[0]?.mrp ?? currentMrp ?? latestMrp;
      const mrpFlagged =
        primaryMrp != null &&
        latestMrp != null &&
        Math.round(primaryMrp) !== Math.round(latestMrp);

      setLineProgress((map) => ({
        ...map,
        [lineId]: {
          status: flagged ? 'flagged' : 'done',
          loggedQty,
          batches,
          flagged,
          flagReason,
        },
      }));

      const entry: PickerV10DoneEntry = {
        code: line.code,
        qty: loggedQty,
        confirmedMrp: primaryMrp,
        latestMrp,
        mrpFlagged,
        outOfStock: loggedQty === 0 && flagged,
        historyCount: mrpHistory.length,
        batches,
      };

      const pickResult: PickerV10PickResult = {
        line,
        qty: loggedQty,
        confirmedMrp: primaryMrp,
        latestMrp,
        mrpFlagged,
        outOfStock: entry.outOfStock,
        mrpSource: 'stock_mrpwise',
        historyCount: mrpHistory.length,
        batches,
        picker_note: batches.find((b) => b.picker_note)?.picker_note,
      };

      if (liveWrite && onPickLineComplete) {
        await onPickLineComplete(pickResult);
      }

      setDoneEntries((prev) => [...prev, entry]);
      appHaptics.success();
      setPhase('item_complete');
    },
    [currentMrp, latestMrp, lines, liveWrite, mrpHistory.length, onPickLineComplete],
  );

  const commitBatch = useCallback(
    async (batchQty: number, batchMrp: number, batchNote?: string): Promise<void> => {
      if (!item || batchQty <= 0 || batchMrp == null) return;

      const batch: PickerV10LoggedBatch = {
        mrp: batchMrp,
        qty: batchQty,
        picker_note: batchNote?.trim() || undefined,
      };

      const prev = lineProgress[item.id] ?? emptyProgress();
      const newLogged = prev.loggedQty + batchQty;
      const newBatches = [...prev.batches, batch];
      const batchTarget = Math.max(0, item.qty - prev.loggedQty);
      const isOver = batchQty > batchTarget;
      const isPartial = newLogged < item.qty && !isOver;

      setLineProgress((map) => ({
        ...map,
        [item.id]: {
          ...prev,
          status: 'in_progress',
          loggedQty: newLogged,
          batches: newBatches,
        },
      }));

      appHaptics.selection();

      resetLineEntry();
      setCurrentMrp(null);

      if (isPartial) {
        setRemainingQty(item.qty - newLogged);
        setPhase('gap');
        return;
      }

      await finishLine(item.id, newLogged, newBatches, false);
    },
    [finishLine, item, lineProgress, resetLineEntry],
  );

  const handleLogBatch = useCallback((): void => {
    const n = parseInt(qtyBuf, 10);
    if (!Number.isFinite(n) || n <= 0 || currentMrp == null) return;
    void commitBatch(n, currentMrp, note);
  }, [commitBatch, currentMrp, note, qtyBuf]);

  const handleFillAll = useCallback((): void => {
    const remaining = Math.max(0, item.qty - progress.loggedQty);
    setQtyBuf(String(remaining));
  }, [item, progress.loggedQty]);

  const handleMrpConfirm = useCallback((): void => {
    const mrp = parseInt(mrpBuf, 10);
    if (!Number.isFinite(mrp) || mrp <= 0) return;
    setCurrentMrp(mrp);
    appHaptics.selection();
    setPhase('qty');
  }, [mrpBuf]);

  const handleIdentifyConfirm = useCallback((): void => {
    if (item?.verifyMode === 'scan' || item?.verifyMode === 'type') {
      setVerifySheetMode(item.verifyMode === 'type' ? 'verify-type' : 'verify');
      setVerifyOpen(true);
      return;
    }
    setPhase('mrp');
  }, [item?.verifyMode]);

  const handleVerified = useCallback((): void => {
    setVerifyOpen(false);
    appHaptics.selection();
    setPhase('mrp');
  }, []);

  const typeVerify = useCallback((): void => {
    if (!item) return;
    if (typeBuf.toUpperCase() === item.code.slice(-4)) {
      handleVerified();
      setTypeErr(false);
    } else {
      setTypeErr(true);
      appHaptics.error();
    }
  }, [handleVerified, item, typeBuf]);

  const handleGapNextLabel = useCallback((): void => {
    setPhase('mrp');
    if (mrpHistory[0]) setMrpBuf(String(Math.round(mrpHistory[0].mrp)));
  }, [mrpHistory]);

  const handleGapFlagShort = useCallback((): void => {
    if (!item) return;
    void finishLine(item.id, progress.loggedQty, progress.batches, true, 'Short stock');
  }, [finishLine, item, progress.batches, progress.loggedQty]);

  const handleItemCompleteNext = useCallback((): void => {
    const allDone = lines.every((l) => {
      const p = lineProgress[l.id];
      return p?.status === 'done' || p?.status === 'flagged';
    });
    if (allDone) {
      onAllComplete?.(doneEntries);
      setPhase('session_summary');
      return;
    }
    pickNextUndone();
  }, [doneEntries, lineProgress, lines, onAllComplete, pickNextUndone]);

  const handleFlagSubmit = useCallback((): void => {
    if (!item || !flagRsn) return;
    void finishLine(item.id, progress.loggedQty, progress.batches, true, flagRsn);
    setFlagOpen(false);
    setFlagRsn('');
  }, [finishLine, flagRsn, item, progress.batches, progress.loggedQty]);

  if (total === 0 || !item) {
    return (
      <p className="px-4 py-8 text-center text-sm text-[var(--content-tertiary)]">No pick lines to show.</p>
    );
  }

  const partNo = item.code;
  const uom = item.uom ?? 'PCS';
  const pos = positionLabel(itemIdx, total);

  return (
    <div className="role-picking relative mx-auto flex h-[min(100dvh,900px)] max-w-[390px] flex-col overflow-hidden bg-[var(--bg-primary)]">
      {phase === 'rack_list' ? (
        <RackListScreen
          lines={lines}
          progress={lineProgress}
          orderLabel={orderLabel}
          customerLabel={customerLabel}
          onSelectLine={goToLine}
          onPickNext={pickNextUndone}
        />
      ) : null}

      {phase === 'identify' ? (
        <IdentifyScreen
          rackNo={item.rack}
          partCode={partNo}
          itemName={item.name}
          targetQty={item.qty}
          uom={uom}
          positionLabel={pos}
          onConfirm={handleIdentifyConfirm}
          onBack={() => setPhase('rack_list')}
        />
      ) : null}

      {phase === 'mrp' ? (
        <MrpEntryScreen
          rackNo={item.rack}
          partCode={partNo}
          itemName={item.name}
          targetQty={Math.max(0, item.qty - progress.loggedQty)}
          uom={uom}
          numBuf={mrpBuf}
          mrpHistory={mrpHistory}
          mrpLoading={mrpLoading}
          positionLabel={pos}
          onNumKey={(k) => numKey(k, mrpBuf, setMrpBuf)}
          onConfirm={handleMrpConfirm}
          onSelectSuggestion={(mrp) => setMrpBuf(String(Math.round(mrp)))}
          onBack={() => (progress.loggedQty > 0 ? setPhase('gap') : setPhase('identify'))}
        />
      ) : null}

      {phase === 'qty' && currentMrp != null ? (
        <QtyEntryScreen
          rackNo={item.rack}
          partCode={partNo}
          itemName={item.name}
          targetQty={item.qty}
          loggedQty={progress.loggedQty}
          uom={uom}
          mrp={currentMrp}
          numBuf={qtyBuf}
          note={note}
          noteOpen={noteOpen}
          positionLabel={pos}
          loggedBatches={progress.batches}
          onNumKey={(k) => qtyNumKey(k, qtyBuf, setQtyBuf)}
          onEditMrp={() => setPhase('mrp')}
          onNoteChange={setNote}
          onToggleNote={() => setNoteOpen((v) => !v)}
          onLogBatch={handleLogBatch}
          onFillAll={handleFillAll}
          onFlag={() => setFlagOpen(true)}
          onBack={() => setPhase('mrp')}
        />
      ) : null}

      {phase === 'gap' ? (
        <GapStateScreen
          rackNo={item.rack}
          partCode={partNo}
          itemName={item.name}
          targetQty={item.qty}
          remainingQty={remainingQty || Math.max(0, item.qty - progress.loggedQty)}
          uom={uom}
          loggedBatches={progress.batches}
          onNextLabel={handleGapNextLabel}
          onFlagShort={handleGapFlagShort}
        />
      ) : null}

      {phase === 'session_summary' ? (
        <SessionSummaryScreen
          lines={lines}
          progress={lineProgress}
          boxCount={boxCount}
          onBoxCountChange={setBoxCount}
          onHandoff={() => onHandoff?.({ boxCount, entries: doneEntries })}
        />
      ) : null}

      <ItemCompleteOverlay
        isOpen={phase === 'item_complete'}
        item={item}
        loggedBatches={progress.batches}
        totalLoggedQty={progress.loggedQty}
        nextItem={nextItem}
        onPickNext={handleItemCompleteNext}
        onSeeRackList={() => setPhase('rack_list')}
      />

      <VerifySheet
        isOpen={verifyOpen}
        item={item}
        mode={verifySheetMode}
        typeBuf={typeBuf}
        typeErr={typeErr}
        onTypeBufChange={(v) => {
          setTypeBuf(v);
          setTypeErr(false);
        }}
        onTypeVerify={typeVerify}
        onVerified={handleVerified}
        onOpenTypeMode={() => setVerifySheetMode('verify-type')}
        onClose={() => setVerifyOpen(false)}
      />

      <BottomSheet isOpen={flagOpen} onClose={() => setFlagOpen(false)} title="Flag this item" closeOnly>
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
          onClick={handleFlagSubmit}
          className="w-full rounded-xl bg-[var(--bg-inverse-primary)] py-4 text-base font-extrabold text-white pick-pressable disabled:opacity-40"
        >
          Submit flag
        </button>
      </BottomSheet>
    </div>
  );
}
