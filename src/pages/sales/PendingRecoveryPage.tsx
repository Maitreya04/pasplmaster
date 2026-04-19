import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CaretDown,
  CaretUp,
  CheckCircle,
  ChatCenteredDots,
  Clock,
  Package,
  SpinnerGap,
} from '@phosphor-icons/react';
import { supabase } from '../../lib/supabase/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import {
  type PendingRecoveryCoverageStatus,
  type SalesPendingRecoveryParty,
  type SalesPendingRecoveryLine,
  useSalesPendingRecovery,
} from '../../hooks/useSalesPendingRecovery';
import { BottomSheet, EmptyState, Skeleton, BigButton } from '../../components/shared';
import { formatCurrency, formatTimeAgo } from '../../utils/formatters';
import { formatStockQty, type StockTier } from '../../lib/stockDisplay';
import {
  buildPendingRecoveryCustomerMessage,
  pendingRecoveryWhatsappUrl,
} from '../../lib/buildPendingRecoveryCustomerMessage';
import type { PendingRecoveryResponse } from '../../types';

type ResponseSelection = PendingRecoveryResponse | null;
type QueueBucket = 'bill_now' | 'call_now' | 'waiting';
type SheetMode = 'overview' | 'response';

function stageMeta(stage: SalesPendingRecoveryParty['stage']): {
  label: string;
  badgeClass: string;
  description: string;
} {
  switch (stage) {
    case 'ready_to_bill':
      return {
        label: 'Bill now',
        badgeClass: 'bg-[var(--bg-accent-subtle)] text-[var(--bg-accent)]',
        description: 'Customer-confirmed items are ready to become one recovery billing order.',
      };
    case 'waiting_for_customer':
      return {
        label: 'Waiting for customer',
        badgeClass: 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning)]',
        description: 'The update has been sent. Record the customer response when they reply.',
      };
    case 'ready_to_contact':
      return {
        label: 'Ready to contact',
        badgeClass: 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]',
        description: 'At least one pending line is available enough to discuss with the party.',
      };
    default:
      return {
        label: 'Waiting for stock',
        badgeClass: 'bg-[var(--bg-secondary)] text-[var(--content-secondary)]',
        description: 'Nothing is ready to discuss yet. The card will move up once stock becomes available.',
      };
  }
}

function coverageLabel(coverage: PendingRecoveryCoverageStatus): string {
  switch (coverage) {
    case 'full':
      return 'Available now';
    case 'partial':
      return 'Partial stock';
    case 'none':
      return 'Waiting stock';
    default:
      return 'Stock unavailable';
  }
}

function coverageClasses(coverage: PendingRecoveryCoverageStatus): string {
  switch (coverage) {
    case 'full':
      return 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]';
    case 'partial':
      return 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning)]';
    case 'none':
      return 'bg-[var(--bg-secondary)] text-[var(--content-secondary)]';
    default:
      return 'bg-[var(--bg-tertiary)] text-[var(--content-tertiary)]';
  }
}

function responseLabel(response: PendingRecoveryResponse | null): string | null {
  switch (response) {
    case 'confirmed':
      return 'Confirmed';
    case 'not_now':
      return 'Not now';
    case 'declined':
      return 'Declined';
    default:
      return null;
  }
}

function responseClasses(response: PendingRecoveryResponse | null): string {
  switch (response) {
    case 'confirmed':
      return 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]';
    case 'not_now':
      return 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning)]';
    case 'declined':
      return 'bg-[var(--bg-negative-subtle)] text-[var(--content-negative)]';
    default:
      return 'bg-[var(--bg-secondary)] text-[var(--content-secondary)]';
  }
}

function noteText(note: string | null): string | null {
  if (!note) return null;
  const normalized = note.trim().toLowerCase();
  if (normalized === 'purchase order qty from sales checkout') return null;
  if (normalized === 'marked pending by billing (no stock in busy)') return null;
  if (normalized.includes('busy')) return null;
  if (normalized.includes('fully pending')) return null;
  return note.replace(/^Partial stock\b/i, 'Partially billed earlier');
}

function StockStatusDot({ tier }: { tier: StockTier }) {
  const className =
    tier === 'ok'
      ? 'bg-[var(--bg-positive)]'
      : tier === 'low'
        ? 'bg-[var(--content-warning)]'
        : tier === 'out'
          ? 'bg-[var(--bg-negative)]'
          : 'bg-[var(--content-quaternary)]';
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${className}`} aria-hidden />;
}

function dotTier(line: SalesPendingRecoveryLine): StockTier {
  if (line.coverage_status === 'full') return 'ok';
  if (line.coverage_status === 'partial') return 'low';
  if (line.coverage_status === 'none') return 'out';
  return 'unknown';
}

function coverageText(line: SalesPendingRecoveryLine): string {
  if (line.coverage_status === 'unknown') {
    return `Pending ${formatStockQty(line.qty_pending)} · Stock unavailable`;
  }
  if (line.coverage_status === 'none') {
    return `Pending ${formatStockQty(line.qty_pending)} · Out of stock`;
  }
  if (line.coverage_status === 'full') {
    return `${formatStockQty(Number(line.stock_qty ?? 0))} in stock · Covers all ${formatStockQty(line.qty_pending)} pending`;
  }
  return `${formatStockQty(Number(line.stock_qty ?? 0))} in stock · Covers ${formatStockQty(line.qty_available)} of ${formatStockQty(line.qty_pending)} pending`;
}

function stockTone(line: SalesPendingRecoveryLine): string {
  if (line.coverage_status === 'full') {
    return 'text-[var(--content-positive)]';
  }
  if (line.coverage_status === 'partial') return 'text-[var(--content-warning)]';
  if (line.coverage_status === 'none') return 'text-[var(--content-negative)]';
  return 'text-[var(--content-tertiary)]';
}

function summaryCounts(parties: SalesPendingRecoveryParty[]) {
  return parties.reduce(
    (acc, party) => {
      acc.pending += party.lines.length;
      acc.available += party.fullLines.length;
      acc.partial += party.partialLines.length;
      acc.waiting += party.waitingLines.length;
      return acc;
    },
    { pending: 0, available: 0, partial: 0, waiting: 0 },
  );
}

function groupTitle(title: string, count: number): string {
  return `${title} (${count})`;
}

function partyBucket(party: SalesPendingRecoveryParty): QueueBucket {
  if (party.stage === 'ready_to_bill') return 'bill_now';
  if (party.stage === 'waiting_stock') return 'waiting';
  return 'call_now';
}

function bucketMeta(bucket: QueueBucket): {
  title: string;
  countLabel: string;
  accentClass: string;
  numberClass: string;
  pillClass: string;
} {
  switch (bucket) {
    case 'bill_now':
      return {
        title: 'Bill now',
        countLabel: 'bill now',
        accentClass: 'border-l-[3px] border-[var(--bg-positive)]',
        numberClass: 'text-[var(--content-positive)]',
        pillClass: 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]',
      };
    case 'call_now':
      return {
        title: 'Available now',
        countLabel: 'available now',
        accentClass: 'border-l-[3px] border-[var(--bg-warning)]',
        numberClass: 'text-[var(--content-warning)]',
        pillClass: 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning)]',
      };
    default:
      return {
        title: 'Waiting',
        countLabel: 'waiting stock',
        accentClass: 'border-l-[3px] border-[var(--border-opaque)]',
        numberClass: 'text-[var(--content-primary)]',
        pillClass: 'bg-[var(--bg-secondary)] text-[var(--content-secondary)]',
      };
  }
}

function availableValueLabel(party: SalesPendingRecoveryParty): string | null {
  if (party.stage === 'ready_to_bill') {
    return party.confirmedValue > 0 ? formatCurrency(party.confirmedValue) : null;
  }
  return party.billableNowValue > 0 ? formatCurrency(party.billableNowValue) : null;
}

function compactPills(party: SalesPendingRecoveryParty): Array<{
  key: string;
  label: string;
  className: string;
}> {
  const pills: Array<{ key: string; label: string; className: string }> = [];
  const readyCount =
    party.stage === 'ready_to_bill'
      ? party.confirmedLines.length
      : party.fullLines.filter((line) => line.response_state !== 'confirmed').length;
  const partialCount = party.partialLines.filter((line) => line.response_state !== 'confirmed').length;
  const waitingCount = party.waitingLines.length;

  if (readyCount > 0) {
    pills.push({
      key: 'ready',
      label: `${readyCount} ${party.stage === 'ready_to_bill' ? 'bill now' : 'ready'}`,
      className: 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]',
    });
  }
  if (partialCount > 0) {
    pills.push({
      key: 'partial',
      label: `${partialCount} partial`,
      className: 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning)]',
    });
  }
  if (waitingCount > 0) {
    pills.push({
      key: 'waiting',
      label: `${waitingCount} waiting`,
      className: 'bg-[var(--bg-secondary)] text-[var(--content-secondary)]',
    });
  }

  return pills;
}

function LineCard({
  line,
  compact = false,
}: {
  line: SalesPendingRecoveryLine;
  compact?: boolean;
}) {
  const response = responseLabel(line.response_state);
  const tone = stockTone(line);
  const tier = dotTier(line);

  return (
    <div
      className={`rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] ${
        compact ? 'p-2.5' : 'p-4'
      }`}
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className={`min-w-0 flex flex-col ${compact ? 'gap-1' : 'gap-1.5'}`}>
          <div className="flex flex-wrap items-center gap-2">
            {line.item_alias1 && (
              <span className="font-mono text-xs font-semibold tracking-[0.04em] text-[var(--content-primary)] uppercase">
                {line.item_alias1}
              </span>
            )}
            <span className="text-xs text-[var(--content-secondary)]">
              Order <span className="font-mono">{line.order_number}</span>
            </span>
          </div>
          <p className={`${compact ? 'text-[13px] leading-5' : 'text-sm'} font-semibold text-[var(--content-primary)]`}>
            {line.item_name}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${coverageClasses(line.coverage_status)}`}
          >
            {coverageLabel(line.coverage_status)}
          </span>
          {response && (
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${responseClasses(line.response_state)}`}
            >
              {response}
            </span>
          )}
        </div>
      </div>

      <div className={`${compact ? 'mt-2 space-y-1' : 'mt-3 space-y-1.5'}`}>
        <p className={`flex flex-wrap items-center gap-1.5 ${compact ? 'text-[13px]' : 'text-sm'} font-semibold ${tone}`}>
          <StockStatusDot tier={tier} />
          <span>{coverageText(line)}</span>
        </p>
        {line.total_pending_value > 0 && (
          <p className="text-[12px] font-medium text-[var(--content-secondary)]">
            {formatCurrency(line.total_pending_value)}
          </p>
        )}
        {(line.back_in_stock_at && line.is_contactable) || noteText(line.note) ? (
          <p className="text-[11px] leading-4 text-[var(--content-tertiary)]">
            {line.back_in_stock_at && line.is_contactable ? `Ready ${formatTimeAgo(line.back_in_stock_at)}` : ''}
            {line.back_in_stock_at && line.is_contactable && noteText(line.note) ? ' · ' : ''}
            {noteText(line.note) ?? ''}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function PartyLineGroup({
  title,
  tone,
  lines,
  defaultOpen,
  previewCount = 0,
}: {
  title: string;
  tone?: 'default' | 'warning' | 'muted';
  lines: SalesPendingRecoveryLine[];
  defaultOpen: boolean;
  previewCount?: number;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  if (lines.length === 0) return null;

  const visibleLines = isOpen ? lines : lines.slice(0, previewCount);
  const hasHidden = lines.length > visibleLines.length;
  const titleTone =
    tone === 'warning'
      ? 'text-[var(--content-warning)]'
      : tone === 'muted'
        ? 'text-[var(--content-secondary)]'
        : 'text-[var(--content-tertiary)]';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className={`text-[11px] font-semibold uppercase tracking-[0.08em] ${titleTone}`}>
          {groupTitle(title, lines.length)}
        </p>
        {(lines.length > previewCount || previewCount === 0) && (
          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-secondary)] px-2.5 py-1 text-[11px] font-semibold text-[var(--content-secondary)]"
          >
            {isOpen ? (
              <>
                <CaretUp size={12} weight="bold" />
                Collapse
              </>
            ) : (
              <>
                <CaretDown size={12} weight="bold" />
                {previewCount > 0 && hasHidden ? `Show all ${lines.length}` : 'Show'}
              </>
            )}
          </button>
        )}
      </div>

      {visibleLines.length > 0 ? (
        <div className="space-y-2">
          {visibleLines.map((line) => (
            <LineCard key={line.id} line={line} compact />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--content-tertiary)]">
          Hidden until you expand this group.
        </div>
      )}

      {!isOpen && hasHidden && (
        <p className="pl-1 text-[11px] text-[var(--content-tertiary)]">
          Showing {visibleLines.length} of {lines.length}
        </p>
      )}
    </div>
  );
}

function PartyRow({
  party,
  onOpen,
}: {
  party: SalesPendingRecoveryParty;
  onOpen: (party: SalesPendingRecoveryParty) => void;
}) {
  const bucket = partyBucket(party);
  const meta = bucketMeta(bucket);
  const pills = compactPills(party);
  const sublabel =
    party.stage === 'waiting_for_customer'
      ? 'Update sent'
      : party.customer_city ?? `${formatStockQty(party.totalPendingQty)} pending pcs`;

  return (
    <button
      type="button"
      onClick={() => onOpen(party)}
      className={`w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4 text-left shadow-[var(--shadow-card)] transition-transform duration-150 active:scale-[0.99] ${meta.accentClass}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[22px] font-semibold leading-[1.08] tracking-[-0.03em] text-[var(--content-primary)]">
            {party.customer_name}
          </h3>
          <p className="mt-1 text-[13px] leading-5 text-[var(--content-secondary)]">
            {sublabel}
            {party.customer_city && ` · ${formatStockQty(party.totalPendingQty)} pcs`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          {availableValueLabel(party) && (
            <p className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--content-primary)]">
              {availableValueLabel(party)}
            </p>
          )}
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
            {meta.title}
          </p>
        </div>
      </div>

      {pills.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {pills.map((pill) => (
            <span
              key={pill.key}
              className={`inline-flex items-center rounded-full px-3 py-1.5 text-[12px] font-semibold ${pill.className}`}
            >
              {pill.label}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

function ResponseToggle({
  label,
  selected,
  onClick,
  variant,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  variant: 'confirmed' | 'not_now' | 'declined';
}) {
  const className =
    variant === 'confirmed'
      ? selected
        ? 'border-transparent bg-[var(--bg-accent)] text-[var(--content-on-color)]'
        : 'border-[var(--border-opaque)] bg-[var(--bg-primary)] text-[var(--content-secondary)]'
      : variant === 'declined'
        ? selected
          ? 'border-transparent bg-[var(--bg-negative)] text-white'
          : 'border-[var(--border-negative)] bg-transparent text-[var(--content-negative)]'
        : selected
          ? 'border-transparent bg-[var(--bg-warning)] text-white'
          : 'border-[var(--border-warning)] bg-transparent text-[var(--content-warning)]';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-10 rounded-xl border px-3 text-sm font-semibold transition-colors ${className}`}
    >
      {label}
    </button>
  );
}

export default function PendingRecoveryPage(): React.JSX.Element | null {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { userId, userName } = useAuth();
  const { parties, isLoading, error } = useSalesPendingRecovery(userName);

  const [activePartyKey, setActivePartyKey] = useState<string | null>(null);
  const [sheetMode, setSheetMode] = useState<SheetMode>('overview');
  const [showWaiting, setShowWaiting] = useState(false);
  const [responseSelectionsByParty, setResponseSelectionsByParty] = useState<
    Record<string, Record<number, ResponseSelection>>
  >({});

  const activeParty = useMemo(
    () => parties.find((party) => party.key === activePartyKey) ?? null,
    [activePartyKey, parties],
  );

  const defaultResponseSelections = useMemo(() => {
    if (!activeParty) return {};
    const next: Record<number, ResponseSelection> = {};
    for (const line of [...activeParty.fullLines, ...activeParty.partialLines]) {
      next[line.id] = line.response_state ?? null;
    }
    return next;
  }, [activeParty]);

  const responseSelections = activeParty
    ? (responseSelectionsByParty[activeParty.key] ?? defaultResponseSelections)
    : {};

  const setResponseSelections = useCallback(
    (
      update:
        | Record<number, ResponseSelection>
        | ((prev: Record<number, ResponseSelection>) => Record<number, ResponseSelection>),
    ) => {
      if (!activeParty) return;
      setResponseSelectionsByParty((prev) => {
        const current = prev[activeParty.key] ?? defaultResponseSelections;
        const next = typeof update === 'function' ? update(current) : update;
        return {
          ...prev,
          [activeParty.key]: next,
        };
      });
    },
    [activeParty, defaultResponseSelections],
  );

  const markContactedMutation = useMutation({
    mutationFn: async ({
      lineIds,
      resend,
    }: {
      lineIds: number[];
      resend: boolean;
      partyKey: string;
    }) => {
      const now = new Date().toISOString();
      const payload: Record<string, unknown> = {
        contacted_at: now,
        contacted_by: userName,
        contacted_by_user_id: userId,
      };
      if (!resend) {
        payload.customer_response = null;
      }
      const { error: updateError } = await supabase
        .from('pending_items')
        .update(payload)
        .in('id', lineIds);

      if (updateError) throw updateError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-pending-recovery'] });
      toast.success('Opened customer update in WhatsApp');
    },
    onError: () => {
      toast.error('Failed to mark the update as sent');
    },
  });

  const saveResponsesMutation = useMutation({
    mutationFn: async ({
      party,
      selections,
    }: {
      party: SalesPendingRecoveryParty;
      selections: Record<number, ResponseSelection>;
    }) => {
      const contactableLines = [...party.fullLines, ...party.partialLines];
      const now = new Date().toISOString();
      const confirmed = contactableLines.filter((line) => selections[line.id] === 'confirmed').map((line) => line.id);
      const notNow = contactableLines.filter((line) => selections[line.id] === 'not_now').map((line) => line.id);
      const declined = contactableLines.filter((line) => selections[line.id] === 'declined').map((line) => line.id);
      const clear = contactableLines
        .filter((line) => selections[line.id] == null)
        .map((line) => line.id);

      if (confirmed.length > 0) {
        const { error } = await supabase
          .from('pending_items')
          .update({
            contacted_at: now,
            contacted_by: userName,
            contacted_by_user_id: userId,
            customer_response: 'confirmed',
          })
          .in('id', confirmed);
        if (error) throw error;
      }

      if (notNow.length > 0) {
        const { error } = await supabase
          .from('pending_items')
          .update({
            contacted_at: now,
            contacted_by: userName,
            contacted_by_user_id: userId,
            customer_response: 'not_now',
          })
          .in('id', notNow);
        if (error) throw error;
      }

      if (clear.length > 0) {
        const { error } = await supabase
          .from('pending_items')
          .update({
            customer_response: null,
          })
          .in('id', clear);
        if (error) throw error;
      }

      if (declined.length > 0) {
        const { error } = await supabase
          .from('pending_items')
          .update({
            contacted_at: now,
            contacted_by: userName,
            contacted_by_user_id: userId,
            customer_response: 'declined',
            status: 'cancelled',
            resolved_at: now,
            resolved_by: userName,
            recovery_status: 'reviewed',
            recovery_reviewed_at: now,
            recovery_reviewed_by: userName,
          })
          .in('id', declined);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-pending-recovery'] });
      queryClient.invalidateQueries({ queryKey: ['pending-items'] });
      toast.success('Customer response saved');
    },
    onError: () => {
      toast.error('Failed to save customer response');
    },
  });

  const createRecoveryOrderMutation = useMutation({
    mutationFn: async ({
      pendingItemIds,
    }: {
      pendingItemIds: number[];
      partyKey: string;
    }) => {
      const { data, error } = await supabase.rpc('create_pending_recovery_order', {
        p_pending_item_ids: pendingItemIds,
        p_actor_user_id: userId,
        p_actor_name: userName,
      });
      if (error) throw error;
      return data as { success?: boolean; order_number?: string; order_id?: number };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['sales-pending-recovery'] });
      queryClient.invalidateQueries({ queryKey: ['pending-items'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
      setActivePartyKey(null);
      toast.success(
        result?.order_number
          ? `Recovery order ${result.order_number} created`
          : 'Recovery order created',
      );
    },
    onError: (mutationError) => {
      const message =
        mutationError instanceof Error
          ? mutationError.message
          : 'Failed to create the recovery order';
      toast.error(message);
    },
  });

  const allCounts = useMemo(() => summaryCounts(parties), [parties]);

  const readyToContact = useMemo(
    () => parties.filter((party) => party.stage === 'ready_to_contact'),
    [parties],
  );
  const waitingForCustomer = useMemo(
    () => parties.filter((party) => party.stage === 'waiting_for_customer'),
    [parties],
  );
  const readyToBill = useMemo(
    () => parties.filter((party) => party.stage === 'ready_to_bill'),
    [parties],
  );
  const waitingStock = useMemo(
    () => parties.filter((party) => party.stage === 'waiting_stock'),
    [parties],
  );
  const billNowParties = useMemo(
    () => [...readyToBill].sort((a, b) => b.confirmedValue - a.confirmedValue || a.customer_name.localeCompare(b.customer_name)),
    [readyToBill],
  );
  const callNowParties = useMemo(
    () =>
      [...readyToContact, ...waitingForCustomer].sort(
        (a, b) => b.priorityValue - a.priorityValue || a.customer_name.localeCompare(b.customer_name),
      ),
    [readyToContact, waitingForCustomer],
  );
  const waitingParties = useMemo(
    () => [...waitingStock].sort((a, b) => b.totalPendingValue - a.totalPendingValue || a.customer_name.localeCompare(b.customer_name)),
    [waitingStock],
  );

  function handleSendUpdate(party: SalesPendingRecoveryParty) {
    const lines = [...party.fullLines, ...party.partialLines]
      .filter((line) => line.response_state !== 'confirmed')
      .map((line) => ({
        name: line.item_name,
        qtyAvailable: line.qty_available,
        qtyPending: line.qty_pending,
        coverage: (line.coverage_status === 'full' ? 'full' : 'partial') as 'full' | 'partial',
      }));

    if (lines.length === 0) {
      toast.info('No contactable lines are ready to send');
      return;
    }

    const url = pendingRecoveryWhatsappUrl(
      party.customer_mobile,
      buildPendingRecoveryCustomerMessage({
        customerName: party.customer_name,
        date: new Date(),
        lines,
        businessName: import.meta.env.VITE_BUSINESS_DISPLAY_NAME,
      }),
    );

    window.open(url, '_blank', 'noopener,noreferrer');

    markContactedMutation.mutate({
      lineIds: [...party.fullLines, ...party.partialLines].map((line) => line.id),
      resend: party.stage !== 'ready_to_contact',
      partyKey: party.key,
    });
  }

  function openPartySheet(party: SalesPendingRecoveryParty) {
    setActivePartyKey(party.key);
    setSheetMode('overview');
  }

  async function handleSaveResponses() {
    if (!activeParty) return;
    await saveResponsesMutation.mutateAsync({
      party: activeParty,
      selections: responseSelections,
    });
  }

  async function handleCreateRecoveryOrder(party: SalesPendingRecoveryParty, selections?: Record<number, ResponseSelection>) {
    const selected =
      selections ??
      Object.fromEntries(
        party.lines.map((line) => [line.id, line.response_state ?? null]),
      );

    const confirmedIds = [...party.fullLines, ...party.partialLines]
      .filter((line) => selected[line.id] === 'confirmed')
      .map((line) => line.id);

    if (confirmedIds.length === 0) {
      toast.info('Select at least one confirmed item before creating the billing order');
      return;
    }

    await saveResponsesMutation.mutateAsync({
      party,
      selections: selected,
    });

    await createRecoveryOrderMutation.mutateAsync({
      pendingItemIds: confirmedIds,
      partyKey: party.key,
    });
  }

  const responseCounts = useMemo(() => {
    if (!activeParty) return { confirmed: 0, notNow: 0, declined: 0 };
    return [...activeParty.fullLines, ...activeParty.partialLines].reduce(
      (acc, line) => {
        const state = responseSelections[line.id];
        if (state === 'confirmed') acc.confirmed += 1;
        if (state === 'not_now') acc.notNow += 1;
        if (state === 'declined') acc.declined += 1;
        return acc;
      },
      { confirmed: 0, notNow: 0, declined: 0 },
    );
  }, [activeParty, responseSelections]);

  const busyPartyKey =
    markContactedMutation.isPending
      ? markContactedMutation.variables?.partyKey ?? null
      : createRecoveryOrderMutation.isPending
        ? createRecoveryOrderMutation.variables?.partyKey ?? null
        : null;
  const activeStage = activeParty ? stageMeta(activeParty.stage) : null;
  const activeConfirmed = activeParty?.confirmedLines ?? [];
  const activeAvailable =
    activeParty?.fullLines.filter((line) => line.response_state !== 'confirmed') ?? [];
  const activePartial =
    activeParty?.partialLines.filter((line) => line.response_state !== 'confirmed') ?? [];
  const activeWaiting = activeParty?.waitingLines ?? [];

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      <div className="mx-auto max-w-6xl p-4 pb-28 sm:pb-10">
        <h1 className="text-[32px] font-semibold leading-[1.02] tracking-[-0.04em] text-[var(--content-primary)] sm:text-4xl">
          Pending
        </h1>
        <p className="mt-2 max-w-[34ch] text-[15px] leading-6 text-[var(--content-secondary)]">
          Triage parties by what can be billed now, what needs a customer call, and what is still waiting on stock.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
            <p className="text-[30px] font-semibold leading-none tracking-[-0.04em] text-[var(--content-positive)]">
              {billNowParties.length}
            </p>
            <p className="mt-2 text-[13px] text-[var(--content-secondary)]">Bill now</p>
          </div>
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
            <p className="text-[30px] font-semibold leading-none tracking-[-0.04em] text-[var(--content-warning)]">
              {callNowParties.length}
            </p>
            <p className="mt-2 text-[13px] text-[var(--content-secondary)]">Available now</p>
          </div>
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
            <p className="text-[30px] font-semibold leading-none tracking-[-0.04em] text-[var(--content-primary)]">
              {waitingParties.length}
            </p>
            <p className="mt-2 text-[13px] text-[var(--content-secondary)]">Waiting</p>
          </div>
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
            <p className="text-[30px] font-semibold leading-none tracking-[-0.04em] text-[var(--content-primary)]">
              {parties.length}
            </p>
            <p className="mt-2 text-[13px] text-[var(--content-secondary)]">Parties</p>
          </div>
        </div>

        <div className="mt-6">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton variant="card" count={4} />
            </div>
          ) : error ? (
            <div className="space-y-1">
              <p className="text-[var(--content-negative)]">Failed to load pending follow-up queue</p>
              <p className="text-sm text-[var(--content-secondary)]">
                {error instanceof Error ? error.message : 'Please retry after the latest Supabase migrations are applied.'}
              </p>
            </div>
          ) : parties.length === 0 ? (
            <EmptyState
              icon={Package}
              title="Nothing waiting on sales"
              description="As pending lines become available, they’ll appear here grouped by party for follow-up."
            />
          ) : (
            <div className="space-y-8">
              {billNowParties.length > 0 && (
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--content-tertiary)]">
                      Bill now
                    </h2>
                    <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-[11px] font-semibold text-[var(--content-secondary)]">
                      {billNowParties.length}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {billNowParties.map((party) => (
                      <PartyRow key={party.key} party={party} onOpen={openPartySheet} />
                    ))}
                  </div>
                </section>
              )}

              {callNowParties.length > 0 && (
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--content-tertiary)]">
                      Available now
                    </h2>
                    <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-[11px] font-semibold text-[var(--content-secondary)]">
                      {callNowParties.length}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {callNowParties.map((party) => (
                      <PartyRow key={party.key} party={party} onOpen={openPartySheet} />
                    ))}
                  </div>
                </section>
              )}

              {waitingParties.length > 0 && (
                <section className="space-y-3">
                  <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--content-tertiary)]">
                          Waiting for stock
                        </p>
                        <p className="mt-1 text-[15px] leading-6 text-[var(--content-secondary)]">
                          Nothing actionable yet. These parties will rise automatically when stock arrives.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowWaiting((prev) => !prev)}
                        className="rounded-xl border border-[var(--border-opaque)] px-3 py-2 text-[13px] font-semibold text-[var(--content-primary)]"
                      >
                        {showWaiting ? 'Hide list' : 'View all'}
                      </button>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <div className="rounded-xl bg-[var(--bg-secondary)] p-3">
                        <p className="text-[24px] font-semibold leading-none tracking-[-0.03em] text-[var(--content-primary)]">
                          {allCounts.waiting}
                        </p>
                        <p className="mt-1 text-[12px] text-[var(--content-secondary)]">Pending pcs</p>
                      </div>
                      <div className="rounded-xl bg-[var(--bg-secondary)] p-3">
                        <p className="text-[24px] font-semibold leading-none tracking-[-0.03em] text-[var(--content-primary)]">
                          {waitingParties.length}
                        </p>
                        <p className="mt-1 text-[12px] text-[var(--content-secondary)]">Parties</p>
                      </div>
                      <div className="rounded-xl bg-[var(--bg-secondary)] p-3">
                        <p className="text-[24px] font-semibold leading-none tracking-[-0.03em] text-[var(--content-primary)]">
                          {formatCurrency(waitingParties.reduce((sum, party) => sum + party.totalPendingValue, 0))}
                        </p>
                        <p className="mt-1 text-[12px] text-[var(--content-secondary)]">Value</p>
                      </div>
                    </div>
                  </div>

                  {showWaiting && (
                    <div className="space-y-3">
                      {waitingParties.map((party) => (
                        <PartyRow key={party.key} party={party} onOpen={openPartySheet} />
                      ))}
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
        </div>
      </div>

      <BottomSheet
        isOpen={activeParty != null}
        onClose={() => {
          setActivePartyKey(null);
          setSheetMode('overview');
        }}
        closeOnly
      >
        {activeParty && (
          <div className="space-y-4">
            <div className="space-y-4 pb-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[30px] font-semibold leading-[1.05] tracking-[-0.04em] text-[var(--content-primary)]">
                    {activeParty.customer_name}
                  </h2>
                  {activeStage && (
                    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${activeStage.badgeClass}`}>
                      {partyBucket(activeParty) === 'bill_now'
                        ? 'Bill now'
                        : partyBucket(activeParty) === 'call_now'
                          ? 'Available now'
                          : 'Waiting'}
                    </span>
                  )}
                </div>
                {activeParty.customer_city && (
                  <p className="mt-1 text-[15px] leading-6 text-[var(--content-secondary)]">
                    {activeParty.customer_city}
                  </p>
                )}
              </div>

              {sheetMode === 'overview' ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    {activeParty.stage === 'ready_to_bill' ? (
                      <>
                        <BigButton
                          variant="primary"
                          onClick={() => void handleCreateRecoveryOrder(activeParty)}
                          loading={busyPartyKey === activeParty.key}
                        >
                          <Package size={18} weight="bold" />
                          {`Bill now · ${formatCurrency(activeParty.confirmedValue)}`}
                        </BigButton>
                        <BigButton variant="secondary" onClick={() => handleSendUpdate(activeParty)} loading={busyPartyKey === activeParty.key}>
                          <ChatCenteredDots size={18} weight="bold" />
                          WhatsApp
                        </BigButton>
                      </>
                    ) : activeParty.stage === 'waiting_for_customer' ? (
                      <>
                        <BigButton variant="primary" onClick={() => setSheetMode('response')}>
                          <CheckCircle size={18} weight="bold" />
                          Record response
                        </BigButton>
                        <BigButton variant="secondary" onClick={() => handleSendUpdate(activeParty)} loading={busyPartyKey === activeParty.key}>
                          <ChatCenteredDots size={18} weight="bold" />
                          Resend WhatsApp
                        </BigButton>
                      </>
                    ) : activeParty.stage === 'ready_to_contact' ? (
                      <BigButton variant="primary" onClick={() => handleSendUpdate(activeParty)} loading={busyPartyKey === activeParty.key} className="col-span-2">
                        <ChatCenteredDots size={18} weight="bold" />
                        Send availability update
                      </BigButton>
                    ) : (
                      <div className="col-span-2 rounded-2xl border border-dashed border-[var(--border-subtle)] px-4 py-3 text-[14px] text-[var(--content-secondary)]">
                        Nothing to do yet. This party will move up automatically when stock appears.
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
                      <p className="text-[28px] font-semibold leading-none tracking-[-0.04em] text-[var(--content-positive)]">
                        {activeConfirmed.length + activeAvailable.length + activePartial.length}
                      </p>
                      <p className="mt-2 text-[12px] text-[var(--content-secondary)]">Available items</p>
                    </div>
                    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
                      <p className="text-[28px] font-semibold leading-none tracking-[-0.04em] text-[var(--content-primary)]">
                        {activeParty.lines.length}
                      </p>
                      <p className="mt-2 text-[12px] text-[var(--content-secondary)]">Pending items</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <PartyLineGroup
                      title="Bill now"
                      lines={activeConfirmed}
                      defaultOpen
                      previewCount={0}
                    />
                    <PartyLineGroup
                      title="Available now"
                      tone="warning"
                      lines={[...activeAvailable, ...activePartial]}
                      defaultOpen
                      previewCount={2}
                    />
                    <PartyLineGroup
                      title="Waiting for stock"
                      tone="muted"
                      lines={activeWaiting}
                      defaultOpen={false}
                      previewCount={0}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setSheetMode('overview')}
                      className="text-[13px] font-semibold text-[var(--bg-accent)]"
                    >
                      Back to details
                    </button>
                    <p className="text-[12px] text-[var(--content-secondary)]">
                      Confirmed lines will become one billing order.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setResponseSelections(() =>
                            Object.fromEntries(
                              [...activeAvailable, ...activePartial].map((line) => [line.id, 'confirmed']),
                            ),
                          )
                        }
                        className="rounded-full bg-[var(--bg-accent-subtle)] px-3 py-2 text-sm font-semibold text-[var(--bg-accent)]"
                      >
                        Confirm all available
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setResponseSelections(() =>
                            Object.fromEntries(
                              [...activeAvailable, ...activePartial].map((line) => [line.id, 'not_now']),
                            ),
                          )
                        }
                        className="rounded-full bg-[var(--bg-warning-subtle)] px-3 py-2 text-sm font-semibold text-[var(--content-warning)]"
                      >
                        Mark all not now
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setResponseSelections(() =>
                            Object.fromEntries(
                              [...activeAvailable, ...activePartial].map((line) => [line.id, null]),
                            ),
                          )
                        }
                        className="rounded-full bg-[var(--bg-secondary)] px-3 py-2 text-sm font-semibold text-[var(--content-secondary)]"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    {[...activeAvailable, ...activePartial].map((line) => (
                      <div key={line.id} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
                        <LineCard line={line} compact />
                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <ResponseToggle
                            label="Confirmed"
                            variant="confirmed"
                            selected={responseSelections[line.id] === 'confirmed'}
                            onClick={() =>
                              setResponseSelections((prev) => ({
                                ...prev,
                                [line.id]: prev[line.id] === 'confirmed' ? null : 'confirmed',
                              }))
                            }
                          />
                          <ResponseToggle
                            label="Not now"
                            variant="not_now"
                            selected={responseSelections[line.id] === 'not_now'}
                            onClick={() =>
                              setResponseSelections((prev) => ({
                                ...prev,
                                [line.id]: prev[line.id] === 'not_now' ? null : 'not_now',
                              }))
                            }
                          />
                          <ResponseToggle
                            label="Declined"
                            variant="declined"
                            selected={responseSelections[line.id] === 'declined'}
                            onClick={() =>
                              setResponseSelections((prev) => ({
                                ...prev,
                                [line.id]: prev[line.id] === 'declined' ? null : 'declined',
                              }))
                            }
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {activeWaiting.length > 0 && (
                    <PartyLineGroup
                      title="Waiting for stock"
                      tone="muted"
                      lines={activeWaiting}
                      defaultOpen={false}
                      previewCount={0}
                    />
                  )}

                  <div className="sticky bottom-0 -mx-5 mt-2 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-5 pt-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[var(--content-primary)]">
                          {responseCounts.confirmed} item{responseCounts.confirmed === 1 ? '' : 's'} confirmed
                        </p>
                        <p className="text-xs text-[var(--content-secondary)]">
                          {responseCounts.notNow} not now · {responseCounts.declined} declined
                        </p>
                      </div>
                      {(saveResponsesMutation.isPending || createRecoveryOrderMutation.isPending) && (
                        <p className="inline-flex items-center gap-2 text-sm text-[var(--content-secondary)]">
                          <SpinnerGap size={16} className="animate-spin" />
                          Saving…
                        </p>
                      )}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 pb-5">
                      <BigButton
                        variant="secondary"
                        onClick={() => void handleSaveResponses()}
                        disabled={saveResponsesMutation.isPending || createRecoveryOrderMutation.isPending}
                      >
                        <Clock size={18} weight="bold" />
                        Save and continue later
                      </BigButton>
                      <BigButton
                        variant="primary"
                        onClick={() => void handleCreateRecoveryOrder(activeParty, responseSelections)}
                        disabled={
                          saveResponsesMutation.isPending ||
                          createRecoveryOrderMutation.isPending ||
                          responseCounts.confirmed === 0
                        }
                      >
                        <Package size={18} weight="bold" />
                        Create billing order
                      </BigButton>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
