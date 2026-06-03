import type { RefObject } from 'react';
import { useState } from 'react';
import { Trash } from '@phosphor-icons/react';
import type { BusyEntryLineNature } from '../../../lib/billing/busyEntryLineNature';
import { BusyEntryCheckbox, BusyEntryCheckboxHeader } from './BusyEntryCheckbox';
import { BusyEntryCode } from './BusyEntryCode';
import type { BillingFreshnessRow } from '../../../hooks/useBillingStockFreshness';
import { SalesUnitBadge } from '../../shared/SalesUnitBadge';
import { effectiveSalesLineUnit, salesLineUnitLabel } from '../../../lib/salesUnit';
import type { BillingLineEdit } from '../../../lib/billing/liveQueueDraft';
import type { ItemFlag } from '../../../hooks/useBillingFlow';
import type { OrderItem } from '../../../types';
import { orderItemReadableName } from '../../../utils/formatters';
import { BusyEntryLineChips } from './BusyEntryLineChips';
import { BusyEntryRateCell } from './BusyEntryRateCell';
import { BusyEntryQtyUnit } from './BusyEntryQtyUnit';

export type LineNature = BusyEntryLineNature;
export type LineStatus = 'active' | 'pending' | 'removed';

const STRIPE_COLORS: Record<BusyEntryLineNature, string> = {
  normal: 'transparent',
  foc: 'var(--content-positive)',
  special_rate: 'var(--content-accent)',
  scheme: '#EF9F27',
};

const ROW_TINTS: Record<BusyEntryLineNature, string> = {
  normal: 'transparent',
  foc: 'color-mix(in srgb, var(--bg-positive-subtle) 18%, transparent)',
  special_rate: 'color-mix(in srgb, var(--bg-accent-subtle) 18%, transparent)',
  scheme: 'transparent',
};

function getAccentColor(nature: LineNature, status: LineStatus): string | null {
  if (status === 'pending') return 'var(--border-warning)';
  if (status === 'removed') return 'color-mix(in srgb, #E24B4A 50%, transparent)';
  const color = STRIPE_COLORS[nature];
  return color === 'transparent' ? null : color;
}

function getRowTint(nature: LineNature, status: LineStatus): string {
  if (status === 'pending') return 'var(--bg-secondary)';
  if (status === 'removed') return 'color-mix(in srgb, #FCEBEB 6%, transparent)';
  return ROW_TINTS[nature];
}

export interface BusyEntryLineRowProps {
  item: OrderItem;
  isActive: boolean;
  isSkip: boolean;
  entered: boolean;
  flag?: ItemFlag;
  nature?: LineNature;
  status?: LineStatus;
  /** @deprecated Row derives stripe from `nature` + flags. */
  stripeColor?: string;
  /** @deprecated Row derives surface from `nature` + flags. */
  rowSurface?: string;
  isSplitSibling: boolean;
  isNew: boolean;
  isEdited: boolean;
  labelMrp: number | null;
  brandName?: string | null;
  fresh?: BillingFreshnessRow;
  editingQty: boolean;
  qtyDraft: string;
  serverQty: number;
  qtyEdited: boolean;
  isPartialInput: boolean;
  partialQty: string;
  /** Qty to bill in Busy today (after partial / no-stock split). */
  billableQty?: number;
  /** Qty deferred to pending (remainder). */
  pendingQty?: number;
  partialInputRef?: RefObject<HTMLInputElement | null>;
  rowRef?: (el: HTMLTableRowElement | null) => void;
  onRowClick: () => void;
  onToggleEntered: () => void;
  onUndoFlag: () => void;
  onRemove: () => void;
  onQtyEditStart: () => void;
  onQtyDraftChange: (value: string) => void;
  onQtyCommit: () => void;
  onQtyCancel: () => void;
  onPartialConfirm: () => void;
  onPartialCancel: () => void;
  onPartialQtyChange: (value: string) => void;
  onApplyLiveStock?: () => void;
  lineEdit?: Pick<BillingLineEdit, 'salesUnit'> | null;
}

interface BusyEntryTableHeaderProps {
  enteredCount?: number;
  totalCount?: number;
  onToggleAll?: () => void;
}

export function BusyEntryTableHeader({
  enteredCount,
  totalCount,
  onToggleAll,
}: BusyEntryTableHeaderProps): React.JSX.Element {
  return (
    <thead>
      <tr>
        <BusyEntryCheckboxHeader
          enteredCount={enteredCount}
          totalCount={totalCount}
          onToggleAll={onToggleAll}
        />
        <th
          className="billing-col-alias1 w-[148px] px-3 text-left busy-entry-col-header"
          style={{ borderRight: '0.5px solid var(--border-opaque)' }}
        >
          Part no.
        </th>
        <th className="billing-col-item min-w-0 px-2.5 text-left busy-entry-col-header">
          Description
        </th>
        <th className="billing-col-rate w-24 px-2.5 text-right busy-entry-col-header">
          Bill rate
        </th>
        <th className="billing-col-unit w-[5.25rem] px-2.5 text-right busy-entry-col-header">
          Unit
        </th>
        <th className="billing-col-qty w-[4.5rem] px-2.5 text-right busy-entry-col-header">
          Qty
        </th>
      </tr>
    </thead>
  );
}

export function BusyEntryLineRow({
  item,
  isActive,
  isSkip,
  entered,
  flag,
  nature = 'normal',
  status = 'active',
  isSplitSibling,
  isNew,
  isEdited,
  brandName,
  fresh,
  editingQty,
  qtyDraft,
  serverQty,
  qtyEdited,
  isPartialInput,
  partialQty,
  billableQty,
  pendingQty = 0,
  partialInputRef,
  rowRef,
  onRowClick,
  onToggleEntered,
  onUndoFlag,
  onRemove,
  onQtyEditStart,
  onQtyDraftChange,
  onQtyCommit,
  onQtyCancel,
  onPartialConfirm,
  onPartialCancel,
  onPartialQtyChange,
  onApplyLiveStock,
  lineEdit,
}: BusyEntryLineRowProps): React.JSX.Element {
  const unit = effectiveSalesLineUnit(item, lineEdit);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const effectiveStatus: LineStatus = isSkip
    ? flag?.type === 'no_stock' || flag?.type === 'partial'
      ? 'pending'
      : status
    : status;
  const accentColor = getAccentColor(nature, effectiveStatus);
  const rowTint = getRowTint(nature, effectiveStatus);
  const isPending = isSkip && effectiveStatus === 'pending';
  const displayQty = isSkip
    ? pendingQty > 0
      ? pendingQty
      : item.qty_requested
    : billableQty ?? item.qty_requested;
  const isRemoved = effectiveStatus === 'removed';

  const rowOpacity = isRemoved ? 0.75 : isPending ? 0.65 : 1;
  return (
    <tr
      ref={rowRef}
      onClick={onRowClick}
      className={`group cursor-pointer transition-colors duration-150 ${isActive ? 'ds-row--selected' : ''}`}
      style={{
        minHeight: '44px',
        borderBottom: isPending ? '0.5px dashed var(--border-opaque)' : '0.5px solid var(--border-opaque)',
        background: entered
          ? 'color-mix(in srgb, var(--bg-positive-subtle) 16%, var(--bg-secondary))'
          : rowTint,
        opacity: rowOpacity,
        boxShadow: accentColor ? `inset 3px 0 0 ${accentColor}` : undefined,
      }}
    >
      <td className="w-10 px-0 text-center align-middle">
        {!isSkip ? (
          <BusyEntryCheckbox
            entered={entered}
            itemName={orderItemReadableName(item)}
            forceVisible={isActive}
            onToggle={onToggleEntered}
          />
        ) : null}
      </td>

      <td
        className="billing-col-alias1 w-[148px] px-3 align-middle"
        style={{ borderRight: '0.5px solid var(--border-opaque)' }}
      >
        <div className="flex flex-col gap-0.5">
          <BusyEntryCode item={item} muted={isSkip || isPending} />
          {brandName && (
            <span className="busy-entry-brand truncate">{brandName}</span>
          )}
        </div>
      </td>

      <td className="billing-col-item min-w-0 py-2 px-2.5 align-middle relative">
        <div className="flex flex-col gap-0.5 min-w-0">
          <p
            className="busy-entry-desc truncate leading-snug"
            title={orderItemReadableName(item)}
          >
            {isSplitSibling ? '↳ ' : ''}
            {orderItemReadableName(item)}
          </p>
          <BusyEntryLineChips
            nature={nature}
            flag={flag}
            pendingQty={pendingQty}
            isPending={isPending}
            isSkip={isSkip}
            isNew={isNew}
            isEdited={isEdited}
            fresh={fresh}
            onUndoFlag={onUndoFlag}
            onApplyLiveStock={onApplyLiveStock}
          />
        </div>

        {!isSkip && !showDeleteConfirm && (
          <button
            type="button"
            aria-label="Remove line"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-[var(--content-negative)] opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              setShowDeleteConfirm(true);
            }}
          >
            <Trash size={13} weight="bold" />
          </button>
        )}

        {showDeleteConfirm && (
          <div
            className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="font-ds-caption-size text-[var(--content-negative)]">Remove?</span>
            <button
              type="button"
              className="font-ds-caption-size font-medium text-[var(--content-negative)] hover:underline"
              onClick={() => {
                onRemove();
                setShowDeleteConfirm(false);
              }}
            >
              Yes
            </button>
            <button
              type="button"
              className="font-ds-caption-size text-[var(--content-tertiary)] hover:underline"
              onClick={() => setShowDeleteConfirm(false)}
            >
              Cancel
            </button>
          </div>
        )}
      </td>

      <td className="billing-col-rate w-24 px-2.5 text-right align-middle">
        <BusyEntryRateCell item={item} nature={nature} />
      </td>

      <td className="billing-col-unit w-[5.25rem] px-2.5 text-right align-middle">
        <div className="flex justify-end">
          <SalesUnitBadge unit={unit} />
        </div>
      </td>

      <td className="billing-col-qty w-[4.5rem] px-2.5 text-right align-middle">
        {isPartialInput ? (
          <div className="inline-flex items-baseline justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <input
              ref={partialInputRef}
              type="number"
              value={partialQty}
              onChange={(e) => onPartialQtyChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  onPartialConfirm();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  onPartialCancel();
                }
              }}
              placeholder={`/${item.qty_requested}`}
              min={0}
              max={item.qty_requested}
              className="ds-input w-12 text-right text-sm font-mono py-1 px-1"
            />
            <span className="busy-entry-unit">{salesLineUnitLabel(unit)}</span>
          </div>
        ) : isSkip ? (
          <BusyEntryQtyUnit item={item} lineEdit={lineEdit} qty={displayQty} muted />
        ) : editingQty ? (
          <div className="inline-flex items-baseline justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <input
              type="number"
              min={1}
              max={serverQty}
              value={qtyDraft}
              onChange={(e) => onQtyDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onQtyCommit();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  onQtyCancel();
                }
              }}
              className="ds-input w-14 text-right text-sm font-mono py-1 px-2"
            />
            <span className="busy-entry-unit">{salesLineUnitLabel(unit)}</span>
          </div>
        ) : (
          <button
            type="button"
            className="inline-flex flex-col items-end text-right"
            onClick={(e) => {
              e.stopPropagation();
              onQtyEditStart();
            }}
          >
            {qtyEdited ? (
              <span className="font-ds-caption-size line-through text-[var(--content-quaternary)] tabular-nums">
                {serverQty}
              </span>
            ) : null}
            <BusyEntryQtyUnit
              item={item}
              lineEdit={lineEdit}
              qty={displayQty}
              pendingQty={pendingQty}
            />
          </button>
        )}
      </td>
    </tr>
  );
}
