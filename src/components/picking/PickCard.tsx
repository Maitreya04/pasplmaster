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
import { isPickLineMrpConfirmed } from '../../lib/picking/pickLineMrp';
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
  /** Tap MRP cell / Edit — always opens history sheet. */
  onEditMrp?: () => void;
  /** Primary CTA when single MRP band needs confirm (no sheet). */
  onConfirmMrp?: () => void;
  onFlag?: () => void;
  onEngageScanner?: () => void;
  onSelectLayer?: (layerId: number) => void;
  /** Active closure beat — green for pick, amber for flag. */
  lineOutcome?: PickLineOutcomeKind | null;
  outcomeHeadline?: string;
  outcomeDetail?: string;
  onAdvanceNext?: () => void;
  /** Target line after confirm — shown on the advance button */
  nextLinePreview?: NextPickLinePreview | null;
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
  onFlag,
  onEngageScanner,
  onSelectLayer,
  lineOutcome = null,
  outcomeHeadline,
  outcomeDetail,
  onAdvanceNext,
  nextLinePreview = null,
}: PickCardProps): React.JSX.Element {
  const isDone = uiState === 'picked' || uiState === 'flagged' || uiState === 'overridden';
  const showingOutcome = isCurrent && lineOutcome != null;
  const isAwaitingRack = !rackVerified && !isDone;
  const isVerified = rackVerified && !isDone;
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
        : uiState === 'picked' || uiState === 'overridden'
          ? 'picked'
          : isAwaitingRack
            ? 'awaiting_rack'
            : 'verified';

  const scanLabel = isAwaitingRack ? 'Scan bin' : 'Scan item';
  const scannerLive = isCurrent && !scannerPaused && cameraEngaged;
  const remainingQty = Math.max(0, targetQty - pickedQty);

  const mrpConfirmed = isPickLineMrpConfirmed(lineMrp);
  const hasMrpBands = mrpHistory.length > 0;
  const needsMrpConfirm = isVerified && hasMrpBands && !mrpConfirmed;
  const singlePendingMrp =
    needsMrpConfirm && mrpHistory.length === 1 ? mrpHistory[0]!.mrp : null;
  /** Qty + MRP row appears as soon as rack is verified — qty must not depend on MRP data. */
  const showMetricRow = isVerified;

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
      <div className="min-h-0 flex-1 overflow-y-auto">
        <CardHero
          rackNo={orderItem.rack_no}
          partNo={partNo}
          itemName={orderItem.item_name}
          pickedQty={pickedQty}
          targetQty={targetQty}
          phase={cardPhase}
          flagReason={flagReason}
          positionLabel={positionLabel}
          onRackTap={onRackTap}
          isFlagged={uiState === 'flagged'}
          hideProgressMetrics={showMetricRow}
        />

        {showMetricRow && !showingOutcome && (
          <PickMetricRow
            displayQty={remainingQty}
            targetQty={targetQty}
            pickedQty={pickedQty}
            mrpHistory={mrpHistory}
            mrpLoading={mrpHistoryLoading}
            confirmedMrp={lineMrp?.confirmedMrp ?? null}
            customMrp={lineMrp?.customMrp ?? null}
            disabled={!isCurrent}
            onEditQty={() => onManualQty?.()}
            onEditMrp={() => onEditMrp?.()}
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
        />
      ) : isDone && isCurrent && onAdvanceNext ? (
        <PickLineDoneHint
          kind={uiState === 'flagged' ? 'flagged' : 'picked'}
          pickedQty={pickedQty}
          targetQty={targetQty}
          nextPreview={nextLinePreview}
          onNext={onAdvanceNext}
        />
      ) : (
        <>
          <PickCardCTAs
            phase={isAwaitingRack ? 'rack' : 'pick'}
            scanLabel={scanLabel}
            cameraEngaged={scannerLive}
            disabled={!isCurrent || scannerPaused}
            scanDisabled={needsMrpConfirm}
            onManualQty={() => onManualQty?.()}
            onFlag={() => onFlag?.()}
            onScan={() => onEngageScanner?.()}
            onConfirmRack={isAwaitingRack ? () => onRackTap?.() : undefined}
            onConfirmMrp={needsMrpConfirm ? () => (onConfirmMrp ?? onEditMrp)?.() : undefined}
            confirmMrpLabel={
              singlePendingMrp != null
                ? `Confirm ₹${Math.round(singlePendingMrp)} on label`
                : undefined
            }
          />
        </>
      )}
    </div>
  );
});
