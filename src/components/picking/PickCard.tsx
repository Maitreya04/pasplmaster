import { memo } from 'react';
import type { OrderItem, ScanResult } from '../../types';
import type { ItemPackDefinition } from '../../lib/packLpn';
import type { BinPickerShelfLayer } from '../../types';
import { CardHero, type CardPhase } from './CardHero';
import { PickCardCTAs } from './PickCardCTAs';

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
  onRackTap?: () => void;
  onManualQty?: () => void;
  onFlag?: () => void;
  onEngageScanner?: () => void;
  onSelectLayer?: (layerId: number) => void;
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
  onRackTap,
  onManualQty,
  onFlag,
  onEngageScanner,
  onSelectLayer,
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

  const scanLabel = isAwaitingRack ? 'Scan bin' : 'Scan item';
  const scannerLive = isCurrent && !scannerPaused && cameraEngaged;

  return (
    <div
      className={`flex h-full flex-col overflow-hidden rounded-3xl border-[1.5px] bg-[var(--bg-secondary)] shadow-sm transition-opacity ${
        isDone ? 'opacity-70 border-[var(--border-subtle)]' : 'border-[var(--border-subtle)]'
      } ${isCelebrating ? 'animate-pick-celebrate ring-2 ring-[var(--border-positive)]' : ''}`}
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
        />

        {isVerified && shelfLayers && shelfLayers.length > 0 && (
          <div className="px-4 pb-2">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
              Shelf batches
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

      {isDone && (
        <div className="shrink-0 border-t border-[var(--border-faint)] px-4 py-3 text-center">
          <p className="text-sm text-[var(--content-tertiary)]">
            {uiState === 'flagged' ? 'Sent to billing for review' : 'Line complete'}
          </p>
        </div>
      )}

      {!isDone && (
        <PickCardCTAs
          scanLabel={scanLabel}
          cameraEngaged={scannerLive}
          disabled={!isCurrent || scannerPaused}
          onManualQty={() => onManualQty?.()}
          onFlag={() => onFlag?.()}
          onScan={() => onEngageScanner?.()}
        />
      )}
    </div>
  );
});
