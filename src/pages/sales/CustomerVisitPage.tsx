import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarBlank,
  ClipboardText,
  CurrencyInr,
  FileText,
  Play,
  ShareNetwork,
  ShoppingCart,
  WarningCircle,
} from '@phosphor-icons/react';
import { PageHeader, Card, BigButton, Skeleton, BottomSheet } from '../../components/shared';
import { VisitBar } from '../../components/sales/VisitBar';
import { EndVisitSheet } from '../../components/sales/EndVisitSheet';
import { WorkdayBanner } from '../../components/sales/WorkdayBanner';
import { useCustomers } from '../../hooks/useCustomers';
import {
  useCustomerCollectionSnapshot,
  useCustomerLedgerStatement,
  useCustomerOsBucket,
  useRecordCustomerCollectionEvent,
} from '../../hooks/useCustomerReceivables';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import { getCustomerCity } from '../../lib/customerDisplay';
import { useVisitTracking } from '../../hooks/useVisitTracking';
import { fetchCustomerLastVisit } from '../../lib/visit/visitService';
import {
  AGING_BUCKETS,
  agingPresentationForDays,
  agingPresentationForKey,
  buildCollectionReminderMessage,
  buildLedgerStatementMessage,
  compactAgingMoney,
  formatAgingSnapshotCaption,
  whatsappUrlForCustomer,
  type AgingBucketFilter,
  type AgingBucketKey,
  type AgingTone,
  type CollectionEventType,
  type CollectionSnapshot,
  type LedgerStatement,
  type OsBucketResult,
  type OutstandingBill,
} from '../../lib/receivables';
import { formatCurrencyRaw, formatShortDate, formatTimeAgo } from '../../utils/formatters';
import { useToast } from '../../context/ToastContext';
import { useCart } from '../../context/CartContext';
import type { Customer } from '../../types';
import type { VisitOutcome } from '../../types/visit';

interface LedgerRange {
  fromDate: string;
  toDate: string;
}

type LedgerPreset = 'fy' | '30d' | '90d';

const LEDGER_LIMIT = 100;

interface CollectionEventInput {
  customerId: number;
  eventType: CollectionEventType;
  channel?: string;
  payload?: Record<string, unknown>;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getLedgerRange(preset: LedgerPreset): LedgerRange {
  const today = new Date();
  if (preset === '30d') return { fromDate: isoDate(addDays(today, -30)), toDate: isoDate(today) };
  if (preset === '90d') return { fromDate: isoDate(addDays(today, -90)), toDate: isoDate(today) };

  const year = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return { fromDate: isoDate(new Date(year, 3, 1)), toDate: isoDate(today) };
}

function money(amount: number | null | undefined): string {
  return formatCurrencyRaw(Math.round(Number(amount ?? 0)));
}

function bucketLabel(bucket: AgingBucketFilter): string {
  if (bucket === 'all') return 'All';
  if (bucket === 'credits') return 'Credits';
  return AGING_BUCKETS.find((b) => b.key === bucket)?.label ?? bucket;
}

function isReportStale(reportDate: string | null): boolean {
  if (!reportDate) return false;
  const date = new Date(reportDate);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() > 36 * 60 * 60 * 1000;
}

function openWhatsAppDraft(url: string): boolean {
  return Boolean(window.open(url, '_blank', 'noopener,noreferrer'));
}

function toneTextClass(tone: AgingTone, active = true): string {
  if (!active) return 'text-[var(--content-primary)]';
  if (tone === 'critical') return 'text-[var(--content-negative)]';
  if (tone === 'late') return 'text-[var(--content-warning-on-light)]';
  if (tone === 'watch') return 'text-[var(--content-accent)]';
  return 'text-[var(--content-primary)]';
}

function toneDotClass(tone: AgingTone): string {
  if (tone === 'critical') return 'bg-[var(--bg-negative)]';
  if (tone === 'late') return 'bg-[var(--bg-warning)]';
  if (tone === 'watch') return 'bg-[var(--content-accent)]';
  return 'bg-[var(--bg-positive)]';
}

function tonePillClass(tone: AgingTone): string {
  if (tone === 'critical') {
    return 'bg-[var(--bg-negative-subtle)] text-[var(--content-negative)] border border-[var(--border-negative)]';
  }
  if (tone === 'late') {
    return 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)] border border-[var(--border-warning)]';
  }
  if (tone === 'watch') {
    return 'bg-[var(--bg-accent-subtle)] text-[var(--content-accent)] border border-[var(--border-accent)]';
  }
  return 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)] border border-[var(--border-positive)]';
}

function accountIdentityMeta(parts: {
  city: string | null | undefined;
  creditDays: number | null | undefined;
  outstanding: number;
  oldestDays: number | null | undefined;
}): string {
  const bits: string[] = [];
  if (parts.city) bits.push(parts.city);
  if (parts.creditDays != null && parts.creditDays > 0) {
    bits.push(`${parts.creditDays}-day terms`);
  }
  if (parts.outstanding <= 0) bits.push('Clear');
  else if ((parts.oldestDays ?? 0) > 0) {
    bits.push(agingPresentationForDays(parts.oldestDays ?? 0).meaning);
  }
  return bits.join(' · ');
}

export default function CustomerVisitPage(): React.JSX.Element {
  const { customerId } = useParams<{ customerId: string }>();
  const id = Number(customerId);
  const navigate = useNavigate();
  const location = useLocation();
  const openLedgerFromRoute = Boolean((location.state as { openLedger?: boolean } | null | undefined)?.openLedger);
  const toast = useToast();
  const { copy } = useCopyToClipboard();
  const { setSelectedCustomer } = useCart();
  const { data: customers = [], isLoading } = useCustomers();
  const customer = useMemo(() => customers.find((c: Customer) => c.id === id), [customers, id]);

  const {
    activeVisit,
    requestStartVisit,
    endVisit,
    isStarting,
    isEnding,
  } = useVisitTracking();

  const [endSheetOpen, setEndSheetOpen] = useState(false);
  const [selectedBucket, setSelectedBucket] = useState<AgingBucketFilter | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState(openLedgerFromRoute);
  const [ledgerRange, setLedgerRange] = useState<LedgerRange>(() => getLedgerRange(openLedgerFromRoute ? '90d' : 'fy'));

  useEffect(() => {
    if (!openLedgerFromRoute) return;
    navigate('.', { replace: true, state: {} });
  }, [navigate, openLedgerFromRoute]);

  const snapshotQuery = useCustomerCollectionSnapshot(id);
  const bucketQuery = useCustomerOsBucket(id, selectedBucket ?? 'all', selectedBucket != null);
  const ledgerQuery = useCustomerLedgerStatement({
    customerId: id,
    fromDate: ledgerRange.fromDate,
    toDate: ledgerRange.toDate,
    enabled: ledgerOpen,
    limit: LEDGER_LIMIT,
  });
  const recordEvent = useRecordCustomerCollectionEvent();

  const { data: lastVisit } = useQuery({
    queryKey: ['sales', 'customerLastVisit', id],
    queryFn: () => fetchCustomerLastVisit(id),
    enabled: Number.isFinite(id),
  });

  const visitForCustomer =
    activeVisit && activeVisit.customer_id === id ? activeVisit : null;

  const shareMessage = (message: string, eventPayload: CollectionEventInput) => {
    const url = whatsappUrlForCustomer(customer?.mobile ?? snapshotQuery.data?.customer.mobile, message);
    const opened = openWhatsAppDraft(url);

    if (!opened) {
      void copy(message, 'receivables-share').then((ok) => {
        if (ok) toast.success('Message copied');
        else toast.error('Could not open WhatsApp');
      });
    } else {
      toast.success('WhatsApp draft opened');
    }

    void recordEvent.mutateAsync(eventPayload).catch(() => {
      // Sharing should not be blocked by activity-log failure.
    });
  };

  const handleShareReminder = (bills?: OutstandingBill[]) => {
    const snapshot = snapshotQuery.data;
    if (!snapshot) {
      toast.info('Collection snapshot is still loading');
      return;
    }

    shareMessage(buildCollectionReminderMessage(snapshot, bills), {
      customerId: id,
      eventType: 'reminder_drafted',
      channel: 'whatsapp',
      payload: {
        total_pending: snapshot.summary.total_pending,
        busy_report_date: snapshot.meta.busy_report_date,
        bill_count: snapshot.summary.bill_count,
      },
    });
  };

  const handleOpenLedger = () => {
    setLedgerOpen(true);
    void recordEvent.mutateAsync({
      customerId: id,
      eventType: 'statement_previewed',
      channel: 'app',
      payload: { ...ledgerRange },
    }).catch(() => {
      // Non-critical activity log.
    });
  };

  const handleShareLedger = (statement: LedgerStatement) => {
    const snapshot = snapshotQuery.data;
    if (!snapshot) {
      toast.info('Collection snapshot is still loading');
      return;
    }

    shareMessage(buildLedgerStatementMessage(snapshot, statement), {
      customerId: id,
      eventType: 'statement_shared',
      channel: 'whatsapp',
      payload: {
        from_date: statement.from_date,
        to_date: statement.to_date,
        row_count: statement.row_count,
      },
    });
  };

  const handleStartVisit = async () => {
    const result = await requestStartVisit(id, 'field');
    if (result.status === 'started') {
      toast.success('Visit started');
      return;
    }
    if (result.status === 'already_active') {
      toast.info('You already have a visit in progress');
      return;
    }
    toast.error('Could not start visit');
  };

  const handleEndVisit = async (payload: { outcome: VisitOutcome; notes: string }) => {
    if (!visitForCustomer) return;
    await endVisit({
      visitId: visitForCustomer.id,
      outcome: payload.outcome,
      notes: payload.notes,
    });
    setEndSheetOpen(false);
    toast.success('Visit completed');
  };

  if (isLoading) {
    return (
      <div className="p-4">
        <Skeleton variant="text" lines={8} />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="p-4">
        <Card>
          <p className="text-sm text-[var(--content-secondary)]">Customer not found.</p>
          <Link to="/sales/beat" className="mt-3 inline-block text-sm font-semibold text-[var(--role-primary)]">
            Back to My beat
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] pb-8">
      <PageHeader title={customer.name} onBack={() => navigate('/sales/beat')} />
      <WorkdayBanner />

      <div className="px-4 space-y-4">
        <Card>
          <div className="space-y-1">
            <p className="ds-type-title">{customer.name}</p>
            <p className="ds-type-meta">
              {[
                getCustomerCity(customer),
                customer.salesman,
                lastVisit?.last_visit_at ? `Last visit ${formatTimeAgo(lastVisit.last_visit_at)}` : null,
              ]
                .filter(Boolean)
                .join(' · ') || '—'}
            </p>
          </div>
        </Card>

        {visitForCustomer && (
          <VisitBar visit={visitForCustomer} onEndVisit={() => setEndSheetOpen(true)} />
        )}

        <CollectionPanel
          snapshot={snapshotQuery.data}
          isLoading={snapshotQuery.isLoading}
          isError={snapshotQuery.isError}
          onBucketClick={setSelectedBucket}
          onShareReminder={() => handleShareReminder()}
          onOpenLedger={handleOpenLedger}
        />

        <div className="grid grid-cols-2 gap-3">
          {!visitForCustomer ? (
            <button
              type="button"
              disabled={isStarting}
              onClick={() => void handleStartVisit()}
              className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-[var(--role-primary)] px-4 py-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Play size={18} weight="fill" />
              Start visit
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => {
              setSelectedCustomer(customer);
              navigate('/sales/new');
            }}
            className="flex flex-col items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-4"
          >
            <ShoppingCart size={22} className="text-[var(--role-primary)]" />
            <span className="text-sm font-semibold text-[var(--content-primary)]">New order</span>
          </button>

          <button
            type="button"
            onClick={() => toast.info('Payment recording coming soon')}
            className="flex flex-col items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-4"
          >
            <CurrencyInr size={22} className="text-[var(--role-primary)]" />
            <span className="text-sm font-semibold text-[var(--content-primary)]">Record payment</span>
          </button>

          <button
            type="button"
            onClick={handleOpenLedger}
            className="flex flex-col items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-4"
          >
            <FileText size={22} className="text-[var(--role-primary)]" />
            <span className="text-sm font-semibold text-[var(--content-primary)]">Ledger</span>
          </button>

          <button
            type="button"
            onClick={() => handleShareReminder()}
            disabled={!snapshotQuery.data}
            className="flex flex-col items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-4 disabled:opacity-50"
          >
            <ShareNetwork size={22} className="text-[var(--role-primary)]" />
            <span className="text-sm font-semibold text-[var(--content-primary)]">Reminder</span>
          </button>
        </div>

        <Card>
          <p className="text-sm text-[var(--content-secondary)]">
            Visit logs record the customer, start and end time, outcome, and optional notes. Location is not collected.
          </p>
        </Card>

        <BigButton variant="secondary" onClick={() => navigate('/sales/beat')}>
          Back to My beat
        </BigButton>
      </div>

      <BucketBillsSheet
        bucket={selectedBucket}
        result={bucketQuery.data}
        isLoading={bucketQuery.isLoading}
        isError={bucketQuery.isError}
        onClose={() => setSelectedBucket(null)}
        onShare={(rows) => handleShareReminder(rows)}
      />

      <LedgerStatementSheet
        isOpen={ledgerOpen}
        range={ledgerRange}
        statement={ledgerQuery.data}
        isLoading={ledgerQuery.isLoading}
        isError={ledgerQuery.isError}
        onRangeChange={setLedgerRange}
        onPreset={(preset) => setLedgerRange(getLedgerRange(preset))}
        onClose={() => setLedgerOpen(false)}
        onShare={handleShareLedger}
      />

      {visitForCustomer && (
        <EndVisitSheet
          isOpen={endSheetOpen}
          onClose={() => setEndSheetOpen(false)}
          startedAt={visitForCustomer.started_at}
          onComplete={handleEndVisit}
          isSubmitting={isEnding}
        />
      )}

    </div>
  );
}

function CollectionPanel({
  snapshot,
  isLoading,
  isError,
  onBucketClick,
  onShareReminder,
  onOpenLedger,
}: {
  snapshot: CollectionSnapshot | undefined;
  isLoading: boolean;
  isError: boolean;
  onBucketClick: (bucket: AgingBucketKey) => void;
  onShareReminder: () => void;
  onOpenLedger: () => void;
}) {
  if (isLoading) {
    return (
      <Card>
        <Skeleton variant="text" lines={6} />
      </Card>
    );
  }

  if (isError || !snapshot) {
    return (
      <Card className="space-y-3">
        <div className="flex items-start gap-3">
          <WarningCircle size={22} className="mt-0.5 text-amber-500" />
          <div>
            <p className="font-semibold text-[var(--content-primary)]">Collection unavailable</p>
            <p className="text-sm text-[var(--content-secondary)]">Receivables could not be loaded.</p>
          </div>
        </div>
      </Card>
    );
  }

  const outstanding = snapshot.summary.total_pending;
  const isClear = outstanding <= 0;
  const stale = isReportStale(snapshot.meta.busy_report_date);
  const noSource = !snapshot.meta.source_available;
  const agingCaption = formatAgingSnapshotCaption(snapshot.summary, snapshot.buckets);
  const identityMeta = accountIdentityMeta({
    city: snapshot.customer.city,
    creditDays: snapshot.customer.credit_days,
    outstanding,
    oldestDays: snapshot.summary.oldest_days,
  });

  return (
    <Card className="space-y-4">
      <div className="min-w-0">
        <p className="ds-type-meta">
          {identityMeta}
          {identityMeta ? ' · ' : ''}
          {noSource
            ? 'No Busy OS'
            : stale
              ? `Stale ${formatShortDate(snapshot.meta.busy_report_date)}`
              : `Busy ${formatShortDate(snapshot.meta.busy_report_date)}`}
        </p>
      </div>

      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="ds-type-eyebrow">Outstanding</p>
            <p className={`ds-type-display mt-1 ${isClear ? 'ds-type-display--clear' : ''}`}>
              {isClear ? 'Clear' : money(outstanding)}
            </p>
          </div>
          <button
            type="button"
            onClick={onShareReminder}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-[length:var(--ds-font-body)] font-semibold text-[var(--content-primary)] transition-transform duration-[160ms] ease-out active:scale-[0.97]"
          >
            <ShareNetwork size={16} />
            Collect
          </button>
        </div>

        <div className="mt-3 flex items-start justify-between gap-3">
          <p className="ds-type-caption min-w-0">{agingCaption}</p>
          <p className="ds-type-caption shrink-0 text-right">
            {snapshot.last_payment?.date
              ? `Last: ${compactAgingMoney(snapshot.last_payment.amount ?? 0)}`
              : 'No recent payment'}
          </p>
        </div>

        <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
          <div className="grid grid-cols-4 gap-0">
            {AGING_BUCKETS.map((bucket, index) => {
              const summary = snapshot.buckets[bucket.key];
              const presentation = agingPresentationForKey(bucket.key);
              const hasAmount = summary.amount > 0;
              const emphasize = hasAmount && presentation.tone !== 'ok';
              return (
                <button
                  key={bucket.key}
                  type="button"
                  onClick={() => onBucketClick(bucket.key)}
                  aria-label={`${presentation.title}: ${compactAgingMoney(summary.amount)}, ${summary.count} bills`}
                  className={`min-w-0 px-1.5 text-left transition-opacity active:opacity-70 ${
                    index > 0 ? 'border-l border-[var(--border-subtle)]' : ''
                  }`}
                >
                  <span className="ds-type-bucket-label flex items-center gap-1">
                    {emphasize ? <span className={`h-1.5 w-1.5 rounded-full ${toneDotClass(presentation.tone)}`} /> : null}
                    {presentation.rangeLabel}d
                  </span>
                  <span className={`ds-type-bucket-amount mt-1 block truncate ${toneTextClass(presentation.tone, hasAmount)}`}>
                    {compactAgingMoney(summary.amount)}
                  </span>
                  <span className="ds-type-bucket-meta mt-0.5 block truncate">
                    {hasAmount ? `${summary.count} bills` : presentation.meaning}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {snapshot.top_bills.length > 0 && (
        <div className="space-y-0">
          <p className="ds-type-eyebrow mb-2">Ledger · top bills</p>
          {snapshot.top_bills.slice(0, 3).map((bill) => (
            <BillCompactRow key={`${bill.refcode ?? bill.bill_no}-${bill.days}-${bill.pending_amount}`} bill={bill} />
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onOpenLedger}
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--border-subtle)] px-3 text-[length:var(--ds-font-body)] font-semibold text-[var(--content-primary)]"
        >
          <FileText size={17} />
          Ledger
        </button>
        <button
          type="button"
          onClick={onShareReminder}
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--role-primary)] px-3 text-[length:var(--ds-font-body)] font-semibold text-[var(--content-on-color)]"
        >
          <ShareNetwork size={17} />
          Reminder
        </button>
      </div>
    </Card>
  );
}

function BillCompactRow({ bill }: { bill: OutstandingBill }) {
  const presentation = agingPresentationForDays(bill.days);
  return (
    <div className="border-b border-[var(--border-subtle)] py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="ds-type-row-title truncate">
            {bill.type ? `${bill.type} ` : 'Sale '}
            #{bill.bill_no || bill.refcode || '—'}
          </p>
          <p className="ds-type-caption mt-1">
            {formatShortDate(bill.bill_date)}
            {bill.due_date ? ` · due ${formatShortDate(bill.due_date)}` : ''}
          </p>
        </div>
        <p className={`ds-type-row-amount shrink-0 ${toneTextClass(presentation.tone)}`}>
          {money(bill.pending_amount)}
        </p>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className={`rounded-full px-2 py-0.5 text-[length:var(--ds-font-label)] font-semibold ${tonePillClass(presentation.tone)}`}>
          {presentation.meaning}
        </span>
        <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-2 py-0.5 text-[length:var(--ds-font-label)] font-semibold text-[var(--content-secondary)]">
          {bill.days}d old
        </span>
      </div>
    </div>
  );
}

function BucketBillsSheet({
  bucket,
  result,
  isLoading,
  isError,
  onClose,
  onShare,
}: {
  bucket: AgingBucketFilter | null;
  result: OsBucketResult | undefined;
  isLoading: boolean;
  isError: boolean;
  onClose: () => void;
  onShare: (rows: OutstandingBill[]) => void;
}) {
  const isOpen = bucket != null;
  const title = bucket ? `${bucketLabel(bucket)} bills` : 'Bills';
  const rows = result?.rows ?? [];

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={title}>
      <div className="space-y-4">
        {isLoading && <Skeleton variant="text" lines={8} />}
        {isError && (
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
            Could not load bills.
          </p>
        )}
        {!isLoading && !isError && result && (
          <>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="ds-type-stat">{money(result.total_amount)}</p>
                <p className="ds-type-caption mt-1">
                  {result.count} bills{result.is_truncated ? ' · showing first 250' : ''}
                </p>
              </div>
              {rows.length > 0 && (
                <button
                  type="button"
                  onClick={() => onShare(rows)}
                  className="flex items-center gap-2 rounded-xl bg-[var(--role-primary)] px-3 py-2 text-[length:var(--ds-font-body)] font-semibold text-[var(--content-on-color)]"
                >
                  <ShareNetwork size={16} />
                  Share
                </button>
              )}
            </div>

            {rows.length === 0 ? (
              <p className="rounded-xl bg-[var(--bg-tertiary)] px-3 py-3 text-[length:var(--ds-font-body)] text-[var(--content-secondary)]">
                No bills in this bucket.
              </p>
            ) : (
              <div className="space-y-0">
                <p className="ds-type-eyebrow mb-2">Ledger · {rows.length} entries</p>
                {rows.map((bill) => (
                  <BillCompactRow
                    key={`${bill.refcode ?? bill.bill_no}-${bill.days}-${bill.pending_amount}`}
                    bill={bill}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </BottomSheet>
  );
}

function LedgerStatementSheet({
  isOpen,
  range,
  statement,
  isLoading,
  isError,
  onRangeChange,
  onPreset,
  onClose,
  onShare,
}: {
  isOpen: boolean;
  range: LedgerRange;
  statement: LedgerStatement | undefined;
  isLoading: boolean;
  isError: boolean;
  onRangeChange: (range: LedgerRange) => void;
  onPreset: (preset: LedgerPreset) => void;
  onClose: () => void;
  onShare: (statement: LedgerStatement) => void;
}) {
  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Ledger statement">
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {([
            ['fy', 'FY'],
            ['30d', '30 days'],
            ['90d', '90 days'],
          ] as Array<[LedgerPreset, string]>).map(([preset, label]) => (
            <button
              key={preset}
              type="button"
              onClick={() => onPreset(preset)}
              className="rounded-lg border border-[var(--border-subtle)] px-2 py-2 text-xs font-semibold text-[var(--content-primary)]"
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="flex items-center gap-1 text-xs font-semibold text-[var(--content-secondary)]">
              <CalendarBlank size={14} />
              From
            </span>
            <input
              type="date"
              value={range.fromDate}
              onChange={(event) => onRangeChange({ ...range, fromDate: event.target.value })}
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--content-primary)]"
            />
          </label>
          <label className="space-y-1">
            <span className="flex items-center gap-1 text-xs font-semibold text-[var(--content-secondary)]">
              <CalendarBlank size={14} />
              To
            </span>
            <input
              type="date"
              value={range.toDate}
              onChange={(event) => onRangeChange({ ...range, toDate: event.target.value })}
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--content-primary)]"
            />
          </label>
        </div>

        {isLoading && <Skeleton variant="text" lines={8} />}
        {isError && (
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
            Could not load ledger.
          </p>
        )}
        {!isLoading && !isError && statement && (
          <>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-[var(--content-primary)]">
                  {statement.row_count} entries
                </p>
                <p className="text-xs text-[var(--content-tertiary)]">
                  {formatShortDate(statement.from_date)} to {formatShortDate(statement.to_date)}
                  {statement.is_truncated ? ` · showing ${statement.rows.length}` : ''}
                </p>
              </div>
              <button
                type="button"
                disabled={statement.rows.length === 0}
                onClick={() => onShare(statement)}
                className="flex items-center gap-2 rounded-lg bg-[var(--role-primary)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                <ClipboardText size={16} />
                Share
              </button>
            </div>

            {statement.voucher_totals.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {statement.voucher_totals.map((total) => (
                  <div
                    key={total.voucher_type}
                    className="min-w-[128px] rounded-lg border border-[var(--border-subtle)] px-3 py-2"
                  >
                    <p className="truncate text-xs font-semibold text-[var(--content-secondary)]">{total.voucher_type}</p>
                    <p className="mt-1 text-sm font-semibold text-[var(--content-primary)]">{money(total.amount)}</p>
                    <p className="text-[11px] text-[var(--content-tertiary)]">{total.count} rows</p>
                  </div>
                ))}
              </div>
            )}

            {statement.rows.length === 0 ? (
              <p className="rounded-lg bg-[var(--bg-tertiary)] px-3 py-3 text-sm text-[var(--content-secondary)]">
                No ledger entries in this range.
              </p>
            ) : (
              <div className="space-y-3">
                {statement.rows.map((row) => (
                  <div key={`${row.id}-${row.date}-${row.doc_no}`} className="rounded-lg border border-[var(--border-subtle)] px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[var(--content-primary)]">
                          {row.voucher_type || 'Ledger'} {row.doc_no ? `· ${row.doc_no}` : ''}
                        </p>
                        <p className="mt-1 text-xs text-[var(--content-tertiary)]">
                          {formatShortDate(row.date)} {row.is_future_dated ? '· future dated' : ''}
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-semibold text-[var(--content-primary)]">{money(row.amount)}</p>
                    </div>
                    {row.narration && (
                      <p className="mt-2 line-clamp-2 text-xs text-[var(--content-secondary)]">{row.narration}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </BottomSheet>
  );
}
