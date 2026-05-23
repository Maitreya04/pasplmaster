import {
  Camera,
  DotsThree,
  Hash,
  HandTap,
  Warning,
} from '@phosphor-icons/react';
import type { OrderItem, ScanResult } from '../../types';
import type { ItemPackDefinition } from '../../lib/packLpn';
import type { BinPickerShelfLayer } from '../../types';
import { CardHero, type CardPhase } from './CardHero';
import { EmbeddedScanner } from './EmbeddedScanner';
import type { LiveQrScannerResolved } from '../shared/LiveQrScanner';

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
  packDef?: ItemPackDefinition | null;
  shelfLayers?: BinPickerShelfLayer[] | null;
  shelfLoading?: boolean;
  preferredLayerId?: number | null;
  onRackTap?: () => void;
  onReportIssue?: () => void;
  onScanResolved: (scan: LiveQrScannerResolved) => void;
  onManualVerify?: () => void;
  onPickOne?: () => void;
  onEnterQty?: () => void;
  onOverride?: () => void;
  onScanRack?: () => void;
  onSelectLayer?: (layerId: number) => void;
  onMoreActions?: () => void;
}

export function PickCard({
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
  shelfLayers,
  shelfLoading,
  preferredLayerId,
  onRackTap,
  onReportIssue,
  onScanResolved,
  onManualVerify,
  onPickOne,
  onEnterQty,
  onOverride,
  onScanRack,
  onSelectLayer,
  onMoreActions,
}: PickCardProps): React.JSX.Element {
  const isDone = uiState === 'picked' || uiState === 'flagged' || uiState === 'overridden';
  const isAwaitingRack = !rackVerified && !isDone;
  const isVerified = rackVerified && !isDone;
  const partNo =
    orderItem.catalog_alias1 ??
    orderItem.catalog_alias ??
    orderItem.item_alias ??
    String(orderItem.item_id);

  const cardPhase: CardPhase = isCelebrating
    ? 'celebrating'
    : uiState === 'flagged'
      ? 'flagged'
      : uiState === 'picked' || uiState === 'overridden'
        ? 'picked'
        : isAwaitingRack
          ? 'awaiting_rack'
          : 'verified';

  return (
    <div
      className={`flex h-full flex-col overflow-hidden rounded-3xl border-[1.5px] bg-[var(--bg-secondary)] shadow-sm transition-opacity ${
        isDone ? 'opacity-70 border-[var(--border-subtle)]' : 'border-[var(--border-subtle)]'
      } ${isCelebrating ? 'animate-pick-celebrate ring-2 ring-[var(--border-positive)]' : ''}`}
    >
      <div className="flex-[11] min-h-0 overflow-y-auto">
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
          onReportIssue={onReportIssue}
          isFlagged={uiState === 'flagged'}
        />

        {isVerified && shelfLayers && shelfLayers.length > 0 && (
          <div className="px-4 pb-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)] mb-1">
              Shelf batches
            </p>
            <ul className="flex gap-1.5 overflow-x-auto pb-1">
              {shelfLayers.map((layer) => (
                <li key={layer.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => onSelectLayer?.(layer.id)}
                    className={`rounded-lg px-2 py-1 text-xs font-mono whitespace-nowrap ${
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

        {isVerified && !isDone && (
          <div className="px-4 pb-2 flex gap-1.5">
            <button
              type="button"
              onClick={onPickOne}
              className="flex-1 h-10 rounded-xl bg-[var(--bg-tertiary)] text-xs font-medium text-[var(--content-secondary)] pick-pressable inline-flex items-center justify-center gap-1"
            >
              <HandTap size={14} weight="bold" />
              +1
            </button>
            <button
              type="button"
              onClick={onEnterQty}
              className="flex-1 h-10 rounded-xl bg-[var(--bg-accent-subtle)] text-xs font-medium text-[var(--content-accent)] pick-pressable inline-flex items-center justify-center gap-1"
            >
              <Hash size={14} weight="bold" />
              Qty
            </button>
            <button
              type="button"
              onClick={onOverride}
              className="flex-1 h-10 rounded-xl bg-[var(--bg-warning-subtle)] text-xs font-medium text-[var(--content-warning)] pick-pressable inline-flex items-center justify-center gap-1"
            >
              <Warning size={14} weight="bold" />
              Override
            </button>
            <button
              type="button"
              onClick={onMoreActions}
              className="h-10 w-10 rounded-xl bg-[var(--bg-tertiary)] text-[var(--content-secondary)] pick-pressable inline-flex items-center justify-center"
              aria-label="More actions"
            >
              <DotsThree size={18} weight="bold" />
            </button>
          </div>
        )}
      </div>

      <div className="flex-[9] min-h-[180px] border-t border-[var(--border-faint)]">
        {isDone ? (
          <div className="flex h-full items-center justify-center p-4 text-center">
            <p className="text-sm text-[var(--content-tertiary)]">
              {uiState === 'flagged' ? 'Sent to billing for review' : 'Line complete'}
            </p>
          </div>
        ) : isAwaitingRack ? (
          <div className="flex h-full flex-col p-3 gap-2">
            <button
              type="button"
              onClick={onScanRack}
              className="flex-1 rounded-2xl bg-[var(--bg-inverse-primary)] text-[var(--content-on-color)] font-semibold text-sm pick-pressable inline-flex items-center justify-center gap-2"
            >
              <Camera size={20} weight="bold" />
              Scan bin label
            </button>
            <EmbeddedScanner
              active={isCurrent && !scannerPaused}
              orderItem={orderItem}
              scannerMode="rack"
              pickedSoFar={0}
              targetQty={1}
              onResolved={onScanResolved}
              onManualVerify={onManualVerify}
            />
          </div>
        ) : (
          <EmbeddedScanner
            active={isCurrent && !scannerPaused}
            orderItem={orderItem}
            scannerMode="item"
            pickedSoFar={pickedQty}
            targetQty={targetQty}
            onResolved={onScanResolved}
            onManualVerify={onManualVerify}
          />
        )}
      </div>
    </div>
  );
}
