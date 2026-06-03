import type { RefObject } from 'react';
import { useState } from 'react';
import { Trash } from '@phosphor-icons/react';
import type { BusyEntryLineNature } from '../../../lib/billing/busyEntryLineNature';
import { BusyEntryCheckbox, BusyEntryCheckboxHeader } from './BusyEntryCheckbox';
import { BusyEntryCode } from './BusyEntryCode';
import type { BillingFreshnessRow } from '../../../hooks/useBillingStockFreshness';
import {
  billingFreshnessChipLabel,
  billingFreshnessChipTitle,
} from '../../../hooks/useBillingStockFreshness';
import { salesLineUnitLabel } from '../../../lib/salesUnit';
import { getBookPrice, getQuotedPrice } from '../../../lib/specialPricing';
import type { ItemFlag } from '../../../hooks/useBillingFlow';
import type { OrderItem } from '../../../types';
import { formatCurrencyRaw, orderItemReadableName } from '../../../utils/formatters';

export type LineNature = BusyEntryLineNature;
export type LineStatus = 'active' | 'pending' | 'removed';

const STRIPE_COLORS: Record<BusyEntryLineNature, string> = {
  normal: 'var(--border-opaque)',
  foc: '#1D9E75',
  special_rate: '#7F77DD',
  scheme: '#EF9F27',
};

const ROW_TINTS: Record<BusyEntryLineNature, string> = {
  normal: 'transparent',
  foc: 'color-mix(in srgb, #EAF3DE 4%, transparent)',
  special_rate: 'color-mix(in srgb, #EEEDFE 4%, transparent)',
  scheme: 'transparent',
};

function getStripeColor(nature: LineNature, status: LineStatus): string {
  if (status === 'pending') return 'color-mix(in srgb, #378ADD 45%, transparent)';
  if (status === 'removed') return 'color-mix(in srgb, #E24B4A 50%, transparent)';
  return STRIPE_COLORS[nature];
}

function getRowTint(nature: LineNature, status: LineStatus): string {
  if (status === 'pending') return 'var(--bg-secondary)';
  if (status === 'removed') return 'color-mix(in srgb, #FCEBEB 6%, transparent)';
  return ROW_TINTS[nature];
}

function formatRate(rate: number | null): string {
  return rate == null ? '—' : formatCurrencyRaw(rate);
}

export interface BusyEntryLineRowProps {
  item: OrderItem;
  lineNo: number;
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
        <th className="w-2 p-0" style={{ padding: 0, width: '8px', minWidth: '8px' }} aria-hidden />
        <th
          className="w-[148px] px-2.5 text-left font-ds-caption-size font-medium text-[var(--content-tertiary)]"
          style={{ borderRight: '0.5px solid var(--border-opaque)' }}
        >
          Part no.
        </th>
        <th className="min-w-0 px-2.5 text-left font-ds-caption-size font-medium text-[var(--content-tertiary)]">
          Description
        </th>
        <th className="w-24 px-2.5 text-right font-ds-caption-size font-medium text-[var(--content-tertiary)]">
          Bill rate
        </th>
        <th className="w-16 px-2.5 text-right font-ds-caption-size font-medium text-[var(--content-tertiary)]">
          Qty
        </th>
        <th className="w-16 px-2.5 text-center font-ds-caption-size font-medium text-[var(--content-tertiary)]">
          Unit
        </th>
      </tr>
    </thead>
  );
}

export function BusyEntryLineRow({
  item,
  lineNo,
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
}: BusyEntryLineRowProps): React.JSX.Element {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const effectiveStatus: LineStatus = isSkip
    ? flag?.type === 'no_stock' || flag?.type === 'partial'
      ? 'pending'
      : status
    : status;
  const stripeColor = getStripeColor(nature, effectiveStatus);
  const rowTint = getRowTint(nature, effectiveStatus);
  const isPending = isSkip && effectiveStatus === 'pending';
  const displayQty = isSkip
    ? pendingQty > 0
      ? pendingQty
      : item.qty_requested
    : billableQty ?? item.qty_requested;
  const isRemoved = effectiveStatus === 'removed';
  const billedRate = getQuotedPrice(item);
  const bookRate = getBookPrice(item);
  const showOriginal = bookRate != null && billedRate != null && bookRate !== billedRate;

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
      }}
    >
      <td className="w-10 px-0 text-center align-middle">
        {!isSkip ? (
          <BusyEntryCheckbox
            entered={entered}
            itemName={orderItemReadableName(item)}
            lineNo={lineNo}
            forceVisible={isActive}
            onToggle={onToggleEntered}
          />
        ) : null}
      </td>

      <td
        className="w-2 align-middle text-center"
        style={{ padding: 0, width: '8px', minWidth: '8px' }}
        aria-hidden
      >
        <span
          className="mx-auto block h-8 w-[2px] rounded-full"
          style={{ background: stripeColor }}
        />
      </td>

      <td
        className="w-[130px] px-2.5 align-middle"
        style={{ borderRight: '0.5px solid var(--border-opaque)' }}
      >
        <div className="flex flex-col gap-0.5">
          <BusyEntryCode item={item} muted={isSkip || isPending} />
          {brandName && (
            <span className="font-ds-caption-size truncate text-[var(--content-tertiary)]">
              {brandName}
            </span>
          )}
        </div>
      </td>

      <td className="min-w-0 py-2 px-2.5 align-middle relative">
        <div className="flex flex-col gap-0.5 min-w-0">
          <p
            className="font-ds-body-size font-medium truncate leading-snug text-[var(--content-primary)]"
            title={orderItemReadableName(item)}
          >
            {isSplitSibling ? '↳ ' : ''}
            {orderItemReadableName(item)}
          </p>
          <div className="flex flex-wrap items-center gap-1 mt-0.5">
            {nature === 'foc' && (
              <span
                className="inline-flex items-center px-1.5 py-px rounded-[5px] text-[9px] font-medium"
                style={{ background: '#EAF3DE', color: '#27500A' }}
              >
                FOC
              </span>
            )}
            {nature === 'special_rate' && (
              <span
                className="inline-flex items-center px-1.5 py-px rounded-[5px] text-[9px] font-medium"
                style={{ background: '#EEEDFE', color: '#3C3489' }}
              >
                Special rate
              </span>
            )}
            {isPending && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onUndoFlag();
                }}
                title="Undo pending flag — bill this line instead (S)"
                className="inline-flex items-center px-1.5 py-px rounded-[5px] text-[9px] font-medium hover:opacity-80"
                style={{ background: '#E6F1FB', color: '#0C447C' }}
              >
                {flag?.type === 'partial' ? 'Partial stock' : 'Out of stock'}
              </button>
            )}
            {!isSkip && pendingQty > 0 && (
              <span
                className="inline-flex items-center px-1.5 py-px rounded-[5px] text-[9px] font-semibold"
                style={{ background: '#E6F1FB', color: '#0C447C' }}
              >
                {pendingQty} pending
              </span>
            )}
            {isNew && (
              <span
                className="inline-flex items-center px-1.5 py-px rounded-[5px] text-[9px] font-medium"
                style={{ background: 'var(--bg-positive-subtle)', color: 'var(--content-positive)' }}
              >
                New
              </span>
            )}
            {isEdited && (
              <span
                className="inline-flex items-center px-1.5 py-px rounded-[5px] text-[9px] font-medium"
                style={{ background: 'var(--bg-accent-subtle)', color: 'var(--content-accent)' }}
              >
                Edited
              </span>
            )}
            {fresh?.isStale && fresh.liveCapacity != null ? (
              fresh.canApplyLive ? (
                <button
                  type="button"
                  className="ds-chip ds-chip--sm bg-[var(--bg-accent-subtle)] text-[var(--content-accent)] border-[var(--border-accent)]"
                  title={billingFreshnessChipTitle(fresh)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onApplyLiveStock?.();
                  }}
                >
                  {billingFreshnessChipLabel(fresh)}
                </button>
              ) : (
                <span
                  className="ds-chip ds-chip--sm bg-[var(--bg-tertiary)] text-[var(--content-tertiary)]"
                  title={billingFreshnessChipTitle(fresh)}
                >
                  {billingFreshnessChipLabel(fresh)}
                </span>
              )
            ) : null}
          </div>
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

      <td className="w-24 px-2.5 text-right align-middle tabular-nums">
        <span className="block text-[13px] font-semibold text-[var(--content-primary)]">
          {formatRate(billedRate)}
        </span>
        {showOriginal ? (
          <span className="block text-[9px] leading-tight text-[var(--content-quaternary)]">
            Orig {formatRate(bookRate)}
          </span>
        ) : null}
      </td>

      <td className="w-14 px-2.5 text-right align-middle tabular-nums">
        {isPartialInput ? (
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
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
          </div>
        ) : isSkip ? (
          <span className="text-[14px] text-[var(--content-quaternary)]">{displayQty}</span>
        ) : editingQty ? (
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
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
          </div>
        ) : (
          <button
            type="button"
            className="inline-flex flex-col items-end"
            onClick={(e) => {
              e.stopPropagation();
              onQtyEditStart();
            }}
          >
            {qtyEdited && (
              <span className="font-ds-caption-size line-through text-[var(--content-quaternary)] tabular-nums">
                {serverQty}
              </span>
            )}
            <span className="text-[18px] font-medium text-[var(--content-primary)]">
              {displayQty}
            </span>
          </button>
        )}
      </td>
      <td className="w-16 px-2.5 text-center align-middle">
        <span
          className={`font-ds-caption-size font-semibold ${
            isSkip || isPending ? 'text-[var(--content-quaternary)]' : 'text-[var(--content-secondary)]'
          }`}
        >
          {salesLineUnitLabel(item.sales_unit)}
        </span>
      </td>
    </tr>
  );
}
