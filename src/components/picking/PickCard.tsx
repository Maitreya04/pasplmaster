import { memo } from 'react';
import type { OrderItem, ScanResult, StockMrpHistoryEntry } from '../../types';
import type { ItemPackDefinition } from '../../lib/packLpn';
import type { BinPickerShelfLayer } from '../../types';
import { CardHero, type CardPhase } from './CardHero';
import { PickCardCTAs } from './PickCardCTAs';
import { PickLineResolvedDock, type PickLineOutcomeKind } from './PickLineResolvedDock';
import type { NextPickLinePreview } from '../../lib/picking/deckOrder';
import { PickLineDoneHint } from './PickLineDoneHint';
import { PickMetricRow } from './PickMetricRow';
import { PickMrpSplitProgress } from './PickMrpSplitProgress';
import {
  PICKER_MRP_SPLIT_BANNER_HINT,
  PICKER_MRP_SPLIT_BANNER_TITLE,
} from '../../lib/billing/mrpWorkflowCopy';
import {
  distinctShelfMrpCount,
  getActiveSegment,
  isPickLineMrpConfirmed,
  isSplitInProgress,
  isSplitMode,
  pickLineSegmentsCommittedQty,
  pickLineSplitRemaining,
  shouldSuggestMrpSplit,
  splitNeedsNextBatch,
} from '../../lib/picking/pickLineMrp';
import type { PickLineMrpState } from '../../lib/picking/pickLineMrp';

export interface PickCardProps {
  orderItem: OrderItem;
  uiState: string;
  scanResult: ScanResult | null;
  phase: CardPhase;
  isCurrent: boolean;
  isCelebrating?: boolean;
  rackVerified: boolean;
  pickedQty: number;
  targetQty: number;
  positionLabel?: string;
  flagReason?: string | null;
  scannerPaused?: boolean;
  cameraEngaged?: boolean;
  packDef?: ItemPackDefinition | null;
  shelfLayers?: BinPickerShelfLayer[] | null;
  shelfLoading?: boolean;
  preferredLayerId?: number | null;
  mrpHistory?: StockMrpHistoryEntry[];
  mrpHistoryLoading?: boolean;
  lineMrp?: PickLineMrpState;
  onRackTap?: () => void;
  onManualQty?: () => void;
  onEditMrp?: () => void;
  onConfirmMrp?: () => void;
  onMarkPicked?: () => void;
  markPickedLabel?: string;
  onUndoLinePick?: () => void;
  onUndoLineQty?: () => void;
  onFlag?: () => void;
  onEngageScanner?: () => void;
  onSelectLayer?: (layerId: number) => void;
  lineOutcome?: PickLineOutcomeKind | null;
  outcomeHeadline?: string;
  outcomeDetail?: string;
  onAdvanceNext?: () => void;
  nextLinePreview?: NextPickLinePreview | null;
  onPickFirstBatch?: () => void;
  onPickNextMrp?: () => void;
  onAllSameMrp?: () => void;
  onConfirmBatch?: () => void;
  onFinishShort?: () => void;
  onUndoLastSegment?: () => void;
  onResetSplitLine?: () => void;
  activeBatchQty?: number;
}

export const PickCard = memo(function PickCard({
  orderItem,
  uiState,
  isCurrent,
  isCelebrating = false,
  rackVerified,
  pickedQty,
  targetQty,
  positionLabel,
  flagReason,
  scannerPaused = false,
  cameraEngaged = false,
  shelfLayers,
  shelfLoading,
  preferredLayerId,
  mrpHistory = [],
  mrpHistoryLoading = false,
  lineMrp,
  onRackTap,
  onManualQty,
  onEditMrp,
  onConfirmMrp,
  onMarkPicked,
  markPickedLabel,
  onUndoLinePick,
  onUndoLineQty,
  onFlag,
  onEngageScanner,
  onSelectLayer,
  lineOutcome = null,
  outcomeHeadline,
  outcomeDetail,
  onAdvanceNext,
  nextLinePreview = null,
  onPickFirstBatch,
  onPickNextMrp,
  onAllSameMrp,
  onConfirmBatch,
  onFinishShort,
  onUndoLastSegment,
  onResetSplitLine,
  activeBatchQty = 0,
}: PickCardProps): React.JSX.Element {
  const splitInProgress = isSplitInProgress(lineMrp, targetQty);
  const splitActive = isSplitMode(lineMrp);
  const splitRemaining = pickLineSplitRemaining(lineMrp, targetQty);
  const splitCommitted = pickLineSegmentsCommittedQty(lineMrp);
  const splitGoal = lineMrp?.originalTargetQty ?? targetQty;
  const effectivePickedQty = splitActive ? splitCommitted : pickedQty;
  const effectiveTargetQty = splitActive ? splitGoal : targetQty;

  const isDoneBase = uiState === 'picked' || uiState === 'flagged' || uiState === 'overridden';
  const isDone = isDoneBase && !splitInProgress;
  const showingOutcome = isCurrent && lineOutcome != null;
  const isAwaitingRack = !rackVerified && !isDone && !splitInProgress;
  const isVerified = rackVerified && !isDone && !showingOutcome;

  const partNo =
    orderItem.catalog_alias1 ??
    orderItem.catalog_alias ??
    orderItem.item_alias ??
    String(orderItem.item_id);

  const cardPhase: CardPhase = showingOutcome && (lineOutcome === 'picked' || lineOutcome === 'partial')
    ? 'celebrating'
    : isCelebrating
      ? 'celebrating'
      : uiState === 'flagged'
        ? 'flagged'
        : isDone
          ? 'picked'
          : isAwaitingRack
            ? 'awaiting_rack'
            : 'verified';

  const scanLabel = isAwaitingRack ? 'Scan bin' : 'Scan item';
  const scannerLive = isCurrent && !scannerPaused && cameraEngaged;
  const remainingQty = splitActive ? splitRemaining : Math.max(0, targetQty - pickedQty);

  const shelfMrpBands = distinctShelfMrpCount(shelfLayers);
  const splitMrpBands = Math.max(mrpHistory.length, shelfMrpBands);
  const suggestSplit =
    isVerified &&
    shouldSuggestMrpSplit(mrpHistory.length, targetQty, shelfMrpBands) &&
    !splitActive;
  const mrpConfirmed = isPickLineMrpConfirmed(lineMrp);
  const hasMrpBands = mrpHistory.length > 0;
  const needsMrpConfirm =
    isVerified && hasMrpBands && !mrpConfirmed && !suggestSplit && !splitActive;
  const mrpGateOk = splitActive ? mrpConfirmed : !hasMrpBands || mrpConfirmed;
  const qtyGateOk = splitActive ? activeBatchQty > 0 : effectivePickedQty > 0;
  const markPickedReady = isVerified && mrpGateOk && qtyGateOk && !isDone && !showingOutcome;
  const singlePendingMrp =
    needsMrpConfirm && mrpHistory.length === 1 ? mrpHistory[0]!.mrp : null;
  const showMetricRow = isVerified || splitInProgress || (isDone && isCurrent);
  const canUndoLine =
    isCurrent &&
    !showingOutcome &&
    (effectivePickedQty > 0 || mrpConfirmed);

  const splitCommittedQty = splitCommitted;
  const splitNeedsFirst =
    suggestSplit ||
    (splitActive && !getActiveSegment(lineMrp) && splitCommittedQty === 0);
  const splitNeedsNext =
    splitActive &&
    splitNeedsNextBatch(lineMrp, targetQty) &&
    !getActiveSegment(lineMrp) &&
    splitCommittedQty > 0;
  const splitHasActiveBatch =
    splitActive && getActiveSegment(lineMrp) != null && !splitNeedsNext && !splitNeedsFirst;

  const activeSegment = getActiveSegment(lineMrp);
  const confirmBatchLabel =
    activeSegment && activeBatchQty > 0
      ? `Confirm batch · ${activeBatchQty} pcs @ ₹${Math.round(activeSegment.mrp)}`
      : 'Confirm batch';

  return (
    <div
      className={`flex h-full flex-col overflow-hidden rounded-3xl border-[1.5px] shadow-sm transition-[background-color,border-color,opacity,box-shadow] duration-300 ${
        showingOutcome && lineOutcome === 'picked'
          ? 'border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] ring-2 ring-[var(--border-positive)]/25 animate-pick-celebrate'
          : showingOutcome && (lineOutcome === 'partial' || lineOutcome === 'flagged')
            ? 'border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] ring-2 ring-[var(--border-warning)]/20'
            : isDone
              ? 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] opacity-70'
              : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)]'
      }`}
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <CardHero
          rackNo={orderItem.rack_no}
          partNo={partNo}
          itemName={orderItem.item_name}
          pickedQty={effectivePickedQty}
          targetQty={effectiveTargetQty}
          phase={cardPhase}
          flagReason={flagReason}
          positionLabel={positionLabel}
          onRackTap={onRackTap}
          isFlagged={uiState === 'flagged'}
          hideProgressMetrics={showMetricRow}
        />

        {splitActive && lineMrp && !showingOutcome ? (
          <PickMrpSplitProgress
            lineMrp={lineMrp}
            targetQty={targetQty}
            idleHint={splitCommittedQty === 0 && getActiveSegment(lineMrp) == null}
            onUndoLastSegment={onUndoLastSegment}
            onResetSplitLine={onResetSplitLine}
          />
        ) : null}

        {suggestSplit && !showingOutcome ? (
          <div className="mx-3 mb-2 rounded-xl border-2 border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-3 py-2.5 sm:mx-4">
            <p className="text-xs font-extrabold text-[var(--content-warning-on-light)]">
              {PICKER_MRP_SPLIT_BANNER_TITLE(splitMrpBands)}
            </p>
            <p className="mt-1 text-[10px] leading-snug text-[var(--content-warning-on-light)]/85">
              {PICKER_MRP_SPLIT_BANNER_HINT}
            </p>
          </div>
        ) : null}

        {showMetricRow && !showingOutcome && (
          <PickMetricRow
            displayQty={remainingQty}
            targetQty={effectiveTargetQty}
            pickedQty={effectivePickedQty}
            mrpHistory={mrpHistory}
            mrpLoading={mrpHistoryLoading}
            confirmedMrp={lineMrp?.confirmedMrp ?? null}
            customMrp={lineMrp?.customMrp ?? null}
            lineMrp={lineMrp}
            suggestSplit={suggestSplit}
            splitMrpBands={splitMrpBands}
            disabled={!isCurrent}
            onEditQty={() => onManualQty?.()}
            onEditMrp={() => onEditMrp?.()}
            onUndoPick={canUndoLine ? onUndoLinePick : undefined}
            onUndoQty={canUndoLine && effectivePickedQty > 0 ? onUndoLineQty : undefined}
          />
        )}

        {isVerified && shelfLayers && shelfLayers.length > 0 && (
          <div className="px-4 pb-2">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
              Shelf FIFO
            </p>
            <ul className="flex gap-1.5 overflow-x-auto pb-1">
              {shelfLayers.map((layer) => (
                <li key={layer.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => onSelectLayer?.(layer.id)}
                    className={`whitespace-nowrap rounded-lg px-2 py-1 font-mono text-xs ${
                      preferredLayerId === layer.id
                        ? 'bg-[var(--bg-accent-subtle)] ring-1 ring-[var(--role-primary)]'
                        : 'bg-[var(--bg-tertiary)]'
                    }`}
                  >
                    ₹{Number(layer.mrp_per_ea).toFixed(0)} ×{layer.qty_ea}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {isVerified && shelfLoading && (
          <p className="px-4 pb-2 text-xs text-[var(--content-tertiary)]">Loading shelf…</p>
        )}
      </div>

      {showingOutcome && lineOutcome && outcomeHeadline && onAdvanceNext ? (
        <PickLineResolvedDock
          kind={lineOutcome}
          headline={outcomeHeadline}
          detail={outcomeDetail}
          nextPreview={nextLinePreview}
          onNext={onAdvanceNext}
          onUndoPick={onUndoLinePick}
        />
      ) : isDone && isCurrent && onAdvanceNext ? (
        <PickLineDoneHint
          kind={uiState === 'flagged' ? 'flagged' : 'picked'}
          pickedQty={effectivePickedQty}
          targetQty={effectiveTargetQty}
          nextPreview={nextLinePreview}
          onNext={onAdvanceNext}
          onUndoPick={onUndoLinePick}
        />
      ) : (
        <PickCardCTAs
          phase={isAwaitingRack ? 'rack' : 'pick'}
          scanLabel={scanLabel}
          cameraEngaged={scannerLive}
          disabled={!isCurrent || scannerPaused}
          scanDisabled={needsMrpConfirm || splitNeedsFirst || splitNeedsNext}
          onManualQty={() => onManualQty?.()}
          onFlag={() => onFlag?.()}
          onScan={() => onEngageScanner?.()}
          onConfirmRack={isAwaitingRack ? () => onRackTap?.() : undefined}
          onConfirmMrp={needsMrpConfirm ? () => (onConfirmMrp ?? onEditMrp)?.() : undefined}
          confirmMrpLabel={
            singlePendingMrp != null
              ? `Confirm ₹${Math.round(singlePendingMrp)} on label`
              : splitHasActiveBatch
                ? `Confirm MRP · ₹${Math.round(activeSegment!.mrp)}`
                : undefined
          }
          onMarkPicked={isVerified && !isDone && !splitActive ? onMarkPicked : undefined}
          canMarkPicked={markPickedReady}
          markPickedLabel={markPickedLabel}
          splitMode={splitActive || suggestSplit}
          splitRemaining={splitRemaining}
          splitNeedsFirstBatch={splitNeedsFirst}
          splitNeedsNextBatch={splitNeedsNext}
          splitActiveBatchReady={splitHasActiveBatch}
          onPickFirstBatch={onPickFirstBatch}
          onPickNextMrp={onPickNextMrp}
          onAllSameMrp={onAllSameMrp}
          onConfirmBatch={splitHasActiveBatch ? onConfirmBatch : undefined}
          confirmBatchLabel={confirmBatchLabel}
          onFinishShort={splitNeedsNext ? onFinishShort : undefined}
        />
      )}
    </div>
  );
});
