import type { JSX } from 'react';
import type { FulfillmentPath, StockLocationCode } from '../../types';
import {
  canChooseWarehousePick,
  fulfillmentPathDescription,
  fulfillmentPathLabel,
} from '../../lib/billing/fulfillmentPath';
import { stockLocationLabel } from '../../hooks/useLocationwiseStock';

interface FulfillmentPathSelectorProps {
  value: FulfillmentPath;
  onChange: (path: FulfillmentPath) => void;
  stockLocationCode: StockLocationCode | null | undefined;
  pickLineCount?: number | null;
  disabled?: boolean;
  compact?: boolean;
}

export function FulfillmentPathSelector({
  value,
  onChange,
  stockLocationCode,
  pickLineCount,
  disabled = false,
  compact = false,
}: FulfillmentPathSelectorProps): JSX.Element {
  const warehousePickAllowed = canChooseWarehousePick(stockLocationCode, pickLineCount);
  const locationLabel = stockLocationLabel(stockLocationCode ?? 'main_store');

  return (
    <div
      className={
        compact
          ? 'space-y-2 text-left w-full'
          : 'rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-3 space-y-2'
      }
      role="group"
      aria-label="After billing"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-[var(--content-secondary)] uppercase tracking-wide">
          After billing
        </p>
        <span className="ds-chip ds-chip--sm bg-[var(--bg-secondary)] text-[var(--content-secondary)] border-[var(--border-subtle)]">
          {locationLabel}
        </span>
      </div>

      <div
        className={
          compact
            ? 'grid grid-cols-1 gap-1.5'
            : 'grid grid-cols-1 sm:grid-cols-2 gap-2'
        }
      >
        <button
          type="button"
          disabled={disabled || !warehousePickAllowed}
          onClick={() => onChange('warehouse_pick')}
          className={[
            'rounded-xl border px-3 py-2.5 text-left transition-all',
            value === 'warehouse_pick'
              ? 'border-[var(--role-primary)] bg-[var(--bg-accent-subtle)] ring-1 ring-[var(--role-primary)]'
              : 'border-[var(--border-opaque)] bg-[var(--bg-primary)] hover:bg-[var(--bg-secondary)]',
            !warehousePickAllowed ? 'opacity-50 cursor-not-allowed' : '',
          ].join(' ')}
        >
          <p className="text-sm font-semibold text-[var(--content-primary)]">
            {fulfillmentPathLabel('warehouse_pick')}
          </p>
          <p className="text-xs text-[var(--content-secondary)] mt-0.5">
            {fulfillmentPathDescription('warehouse_pick', stockLocationCode)}
          </p>
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange('direct_bill')}
          className={[
            'rounded-xl border px-3 py-2.5 text-left transition-all',
            value === 'direct_bill'
              ? 'border-[var(--role-primary)] bg-[var(--bg-accent-subtle)] ring-1 ring-[var(--role-primary)]'
              : 'border-[var(--border-opaque)] bg-[var(--bg-primary)] hover:bg-[var(--bg-secondary)]',
          ].join(' ')}
        >
          <p className="text-sm font-semibold text-[var(--content-primary)]">
            {fulfillmentPathLabel('direct_bill')}
          </p>
          <p className="text-xs text-[var(--content-secondary)] mt-0.5">
            {fulfillmentPathDescription('direct_bill', stockLocationCode)}
          </p>
        </button>
      </div>

      {!warehousePickAllowed && stockLocationCode === 'jabalpur' && (
        <p className="text-xs text-[var(--content-tertiary)]">
          Jabalpur orders do not go to the Indore pick queue.
        </p>
      )}
      {!warehousePickAllowed && stockLocationCode !== 'jabalpur' && (pickLineCount ?? 0) <= 0 && (
        <p className="text-xs text-[var(--content-tertiary)]">
          No pickable lines — direct bill only.
        </p>
      )}
    </div>
  );
}
