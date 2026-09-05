import { supabase } from './supabase/client';
import {
  digitsOnlyMobile,
  formatCustomerShareDate,
  whatsappPrefilledUrl,
  whatsappShareUrl,
} from './buildOrderCustomerMessage';

const MAX_MESSAGE_CHARS = 3600;

export type AgingBucketKey = '0_30' | '31_60' | '61_90' | '90_plus';
export type AgingBucketFilter = AgingBucketKey | 'all' | 'credits' | 'over_terms';
export type CollectionEventType =
  | 'reminder_drafted'
  | 'statement_previewed'
  | 'statement_shared'
  | 'note';

export const AGING_BUCKETS: Array<{ key: AgingBucketKey; label: string }> = [
  { key: '0_30', label: '0-30' },
  { key: '31_60', label: '31-60' },
  { key: '61_90', label: '61-90' },
  { key: '90_plus', label: '90+' },
];

/**
 * Aging is absolute bill age from Busy OS `days` (invoice age),
 * not days-past-due and not credit-terms overdue.
 *
 * Left → right is a risk ladder sales can read in one glance.
 */
export type AgingTone = 'ok' | 'watch' | 'late' | 'critical';

export interface AgingBucketPresentation {
  key: AgingBucketKey;
  /** Compact range shown in the 4-col grid: "0–30". */
  rangeLabel: string;
  /** Human meaning for the same bucket: "Fresh". */
  meaning: string;
  /** Sheet / accessibility title. */
  title: string;
  tone: AgingTone;
  minDays: number;
  maxDays: number | null;
}

export const AGING_PRESENTATION: Record<AgingBucketKey, AgingBucketPresentation> = {
  '0_30': {
    key: '0_30',
    rangeLabel: '0–30',
    meaning: 'Fresh',
    title: 'Fresh bills · 0–30 days old',
    tone: 'ok',
    minDays: 0,
    maxDays: 30,
  },
  '31_60': {
    key: '31_60',
    rangeLabel: '31–60',
    meaning: 'Watch',
    title: 'Watch bills · 31–60 days old',
    tone: 'watch',
    minDays: 31,
    maxDays: 60,
  },
  '61_90': {
    key: '61_90',
    rangeLabel: '61–90',
    meaning: 'Late',
    title: 'Late bills · 61–90 days old',
    tone: 'late',
    minDays: 61,
    maxDays: 90,
  },
  '90_plus': {
    key: '90_plus',
    rangeLabel: '90+',
    meaning: 'Critical',
    title: 'Critical bills · over 90 days old',
    tone: 'critical',
    minDays: 91,
    maxDays: null,
  },
};

export function agingPresentationForKey(key: AgingBucketKey): AgingBucketPresentation {
  return AGING_PRESENTATION[key];
}

export function agingToneForDays(days: number): AgingTone {
  if (days > 90) return 'critical';
  if (days > 60) return 'late';
  if (days > 30) return 'watch';
  return 'ok';
}

export function agingBucketForDays(days: number): AgingBucketKey {
  if (days > 90) return '90_plus';
  if (days > 60) return '61_90';
  if (days > 30) return '31_60';
  return '0_30';
}

export function agingPresentationForDays(days: number): AgingBucketPresentation {
  return AGING_PRESENTATION[agingBucketForDays(days)];
}

/** Snapshot caption built only from bill age — never credit terms. */
export function formatAgingSnapshotCaption(summary: {
  bill_count: number;
  oldest_days: number | null;
  credit_adjustments: number;
}, buckets: Record<AgingBucketKey, AgingBucketSummary>): string {
  const parts: string[] = [`${summary.bill_count} ${summary.bill_count === 1 ? 'bill' : 'bills'}`];

  if (summary.credit_adjustments > 0) {
    parts.push(`net of ${compactAgingMoney(summary.credit_adjustments)} credits`);
  }

  const past60Count = buckets['61_90'].count + buckets['90_plus'].count;
  const past60Amount = buckets['61_90'].amount + buckets['90_plus'].amount;
  if (past60Count > 0) {
    parts.push(`${compactAgingMoney(past60Amount)} past 60d`);
  } else if ((summary.oldest_days ?? 0) > 0) {
    parts.push('all under 60d');
  }

  if (summary.oldest_days != null && summary.oldest_days > 0) {
    parts.push(`oldest ${summary.oldest_days}d`);
  }

  return parts.join(' · ');
}

export function compactAgingMoney(amount: number): string {
  const value = Math.round(Math.abs(amount));
  const sign = amount < 0 ? '-' : '';
  if (value >= 10_000_000) return `${sign}₹${(value / 10_000_000).toFixed(value >= 100_000_000 ? 0 : 1)}Cr`;
  if (value >= 100_000) return `${sign}₹${(value / 100_000).toFixed(value >= 1_000_000 ? 0 : 1)}L`;
  if (value >= 1_000) return `${sign}₹${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return `${sign}₹${value.toLocaleString('en-IN')}`;
}

/**
 * Compact “Your Customers” rail glance — one risk signal a salesperson can read
 * without opening the account. Uses bill age (past 60d), never credit-terms overdue.
 */
export type CustomerRailGlanceStatus = 'clear' | 'aged' | 'open' | 'unknown';
export type CustomerRailBadgeIntent = 'positive' | 'negative' | 'warning' | 'neutral';

export interface CustomerRailBadge {
  label: string;
  intent: CustomerRailBadgeIntent;
}

export interface CustomerRailGlance {
  status: CustomerRailGlanceStatus;
  /** Peripheral status-dot tone for scan. */
  tone: AgingTone | 'clear';
  billCount: number | null;
  primaryBadge: CustomerRailBadge | null;
  secondaryBadge: CustomerRailBadge | null;
}

export function past60AgingTotals(
  buckets: Record<AgingBucketKey, AgingBucketSummary>,
): { count: number; amount: number } {
  return {
    count: buckets['61_90'].count + buckets['90_plus'].count,
    amount: buckets['61_90'].amount + buckets['90_plus'].amount,
  };
}

export function buildCustomerRailGlance(
  snapshot: Pick<CollectionSnapshot, 'summary' | 'buckets'> | null | undefined,
): CustomerRailGlance {
  if (!snapshot) {
    return {
      status: 'unknown',
      tone: 'ok',
      billCount: null,
      primaryBadge: null,
      secondaryBadge: null,
    };
  }

  const billCount = snapshot.summary.bill_count;
  const outstanding = snapshot.summary.net_outstanding;
  const oldestDays = snapshot.summary.oldest_days;
  const past60 = past60AgingTotals(snapshot.buckets);

  if (outstanding <= 0) {
    return {
      status: 'clear',
      tone: 'clear',
      billCount,
      primaryBadge: { label: 'Clear', intent: 'positive' },
      secondaryBadge: null,
    };
  }

  if (past60.amount > 0) {
    const tone = agingToneForDays(oldestDays ?? 61);
    return {
      status: 'aged',
      tone: tone === 'ok' ? 'late' : tone,
      billCount,
      primaryBadge: {
        label: `${compactAgingMoney(past60.amount)} past 60d`,
        intent: 'negative',
      },
      secondaryBadge:
        oldestDays != null && oldestDays > 0
          ? { label: `${oldestDays}d oldest`, intent: 'neutral' }
          : null,
    };
  }

  return {
    status: 'open',
    tone: agingToneForDays(oldestDays ?? 0),
    billCount,
    primaryBadge: {
      label: `${compactAgingMoney(outstanding)} open`,
      intent: 'warning',
    },
    secondaryBadge:
      oldestDays != null && oldestDays > 0
        ? { label: `${oldestDays}d oldest`, intent: 'neutral' }
        : { label: 'Under 60d', intent: 'neutral' },
  };
}

export interface AgingBucketSummary {
  label: string;
  amount: number;
  count: number;
}

export interface OutstandingBill {
  refcode: string | null;
  bill_no: string | null;
  type: string | null;
  bill_date: string | null;
  due_date: string | null;
  days: number;
  ref_amount: number;
  pending_amount: number;
  report_date?: string | null;
  bucket: AgingBucketKey;
}

export interface CollectionSnapshot {
  success: true;
  customer: {
    id: number;
    name: string;
    busy_code: number | null;
    mobile: string | null;
    salesman: string | null;
    city: string | null;
    gstin: string | null;
    credit_limit: number | null;
    credit_days: number | null;
  };
  summary: {
    total_pending: number;
    credit_adjustments: number;
    net_outstanding: number;
    bill_count: number;
    oldest_days: number | null;
    largest_bill_amount: number;
    over_credit_days_amount: number | null;
    over_credit_days_count: number;
  };
  buckets: Record<AgingBucketKey, AgingBucketSummary>;
  top_bills: OutstandingBill[];
  last_payment: {
    date: string | null;
    amount: number | null;
    voucher_type: string | null;
    doc_no: string | null;
    narration: string | null;
  } | null;
  meta: {
    source_available: boolean;
    source?: string;
    reason?: string;
    busy_report_date: string | null;
    os_updated_at: string | null;
    generated_at: string | null;
    ledger_match_confidence: 'name_match' | 'unavailable' | string;
  };
}

export interface OsBucketResult {
  success: true;
  bucket: AgingBucketFilter;
  total_amount: number;
  count: number;
  is_truncated: boolean;
  rows: OutstandingBill[];
  meta: { source_available: boolean; source?: string; reason?: string; credit_days?: number | null };
}

export interface LedgerRow {
  id: number;
  date: string | null;
  voucher_type: string | null;
  doc_no: string | null;
  account_name: string | null;
  narration: string | null;
  amount: number | null;
  is_future_dated: boolean;
}

export interface LedgerVoucherTotal {
  voucher_type: string;
  count: number;
  amount: number;
}

export interface LedgerOpeningBalance {
  amount: number;
  count: number;
  as_of: string;
  is_truncated: boolean;
}

export interface LedgerStatement {
  success: true;
  customer_id: number;
  from_date: string;
  to_date: string;
  row_count: number;
  is_truncated: boolean;
  opening_balance: LedgerOpeningBalance;
  opening_bills: OutstandingBill[];
  voucher_totals: LedgerVoucherTotal[];
  rows: LedgerRow[];
  meta: {
    source_available: boolean;
    source?: string;
    match_confidence?: string;
  };
}

export interface PaymentReceiptRow {
  id: number;
  date: string | null;
  amount: number | null;
  doc_no: string | null;
  account_name: string | null;
  narration: string | null;
}

export interface PaymentSignal {
  success: true;
  customer_id: number;
  window_days: number;
  from_date: string;
  to_date: string;
  latest_receipt: PaymentReceiptRow | null;
  days_since_last_payment: number | null;
  receipt_count: number;
  total_received: number;
  average_receipt_gap_days: number | null;
  rows: PaymentReceiptRow[];
  meta: {
    source_available: boolean;
    source?: string;
    voucher_type?: string;
    match_confidence?: string;
  };
}

export interface SalesReceivablesMeta {
  success: true;
  source_available: boolean;
  fingerprint: string | null;
  customer_count: number;
  row_count: number;
  total_pending: number;
  credit_adjustments: number;
  busy_report_date: string | null;
  os_updated_at: string | null;
  generated_at: string | null;
}

type RpcPayload = Record<string, unknown> & {
  success?: boolean;
  error?: string;
};

/** The server deliberately withholds receivables from sales users who do not own the account. */
export class ReceivablesAccessDeniedError extends Error {
  constructor() {
    super('Receivables are not available for this customer.');
    this.name = 'ReceivablesAccessDeniedError';
  }
}

export function isReceivablesAccessDenied(error: unknown): boolean {
  return error instanceof ReceivablesAccessDeniedError;
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function toNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = toNumber(value, Number.NaN);
  return Number.isFinite(n) ? n : null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function requireSuccess<T extends RpcPayload>(payload: T | null, label: string): T {
  if (!payload) throw new Error(`${label} returned no data`);
  if (payload.success === false && payload.error === 'forbidden') {
    throw new ReceivablesAccessDeniedError();
  }
  if (payload.success === false) throw new Error(payload.error || `${label} failed`);
  return payload;
}

function normalizeBucket(raw: unknown, fallbackLabel: string): AgingBucketSummary {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    label: toStringOrNull(row.label) ?? fallbackLabel,
    amount: toNumber(row.amount),
    count: toNumber(row.count),
  };
}

function normalizeBill(raw: unknown): OutstandingBill {
  const row = (raw ?? {}) as Record<string, unknown>;
  const bucket = toStringOrNull(row.bucket) as AgingBucketKey | null;
  return {
    refcode: toStringOrNull(row.refcode),
    bill_no: toStringOrNull(row.bill_no),
    type: toStringOrNull(row.type),
    bill_date: toStringOrNull(row.bill_date),
    due_date: toStringOrNull(row.due_date),
    days: toNumber(row.days),
    ref_amount: toNumber(row.ref_amount),
    pending_amount: toNumber(row.pending_amount),
    report_date: toStringOrNull(row.report_date),
    bucket: bucket && AGING_BUCKETS.some((b) => b.key === bucket) ? bucket : '0_30',
  };
}

function normalizeSnapshot(payload: RpcPayload): CollectionSnapshot {
  const customer = (payload.customer ?? {}) as Record<string, unknown>;
  const summary = (payload.summary ?? {}) as Record<string, unknown>;
  const buckets = (payload.buckets ?? {}) as Record<string, unknown>;
  const meta = (payload.meta ?? {}) as Record<string, unknown>;
  const lastPayment = payload.last_payment as Record<string, unknown> | null | undefined;

  return {
    success: true,
    customer: {
      id: toNumber(customer.id),
      name: toStringOrNull(customer.name) ?? 'Customer',
      busy_code: toNullableNumber(customer.busy_code),
      mobile: toStringOrNull(customer.mobile),
      salesman: toStringOrNull(customer.salesman),
      city: toStringOrNull(customer.city),
      gstin: toStringOrNull(customer.gstin),
      credit_limit: toNullableNumber(customer.credit_limit),
      credit_days: toNullableNumber(customer.credit_days),
    },
    summary: {
      total_pending: toNumber(summary.total_pending),
      credit_adjustments: toNumber(summary.credit_adjustments),
      net_outstanding: toNumber(summary.net_outstanding),
      bill_count: toNumber(summary.bill_count),
      oldest_days: toNullableNumber(summary.oldest_days),
      largest_bill_amount: toNumber(summary.largest_bill_amount),
      over_credit_days_amount: toNullableNumber(summary.over_credit_days_amount),
      over_credit_days_count: toNumber(summary.over_credit_days_count),
    },
    buckets: {
      '0_30': normalizeBucket(buckets['0_30'], '0-30'),
      '31_60': normalizeBucket(buckets['31_60'], '31-60'),
      '61_90': normalizeBucket(buckets['61_90'], '61-90'),
      '90_plus': normalizeBucket(buckets['90_plus'], '90+'),
    },
    top_bills: Array.isArray(payload.top_bills) ? payload.top_bills.map(normalizeBill) : [],
    last_payment: lastPayment
      ? {
          date: toStringOrNull(lastPayment.date),
          amount: toNullableNumber(lastPayment.amount),
          voucher_type: toStringOrNull(lastPayment.voucher_type),
          doc_no: toStringOrNull(lastPayment.doc_no),
          narration: toStringOrNull(lastPayment.narration),
        }
      : null,
    meta: {
      source_available: Boolean(meta.source_available),
      source: toStringOrNull(meta.source) ?? undefined,
      reason: toStringOrNull(meta.reason) ?? undefined,
      busy_report_date: toStringOrNull(meta.busy_report_date),
      os_updated_at: toStringOrNull(meta.os_updated_at),
      generated_at: toStringOrNull(meta.generated_at),
      ledger_match_confidence: toStringOrNull(meta.ledger_match_confidence) ?? 'unavailable',
    },
  };
}

function normalizeBucketResult(payload: RpcPayload): OsBucketResult {
  return {
    success: true,
    bucket: (toStringOrNull(payload.bucket) as AgingBucketFilter | null) ?? 'all',
    total_amount: toNumber(payload.total_amount),
    count: toNumber(payload.count),
    is_truncated: Boolean(payload.is_truncated),
    rows: Array.isArray(payload.rows) ? payload.rows.map(normalizeBill) : [],
    meta: ((payload.meta ?? {}) as OsBucketResult['meta']) ?? { source_available: false },
  };
}

function normalizeOpeningBalance(raw: unknown, fallbackAsOf: string): LedgerOpeningBalance {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    amount: toNumber(row.amount),
    count: toNumber(row.count),
    as_of: toStringOrNull(row.as_of) ?? fallbackAsOf,
    is_truncated: Boolean(row.is_truncated),
  };
}

export function parseLedgerStatementPayload(payload: RpcPayload): LedgerStatement {
  const fromDate = toStringOrNull(payload.from_date) ?? '';
  return {
    success: true,
    customer_id: toNumber(payload.customer_id),
    from_date: fromDate,
    to_date: toStringOrNull(payload.to_date) ?? '',
    row_count: toNumber(payload.row_count),
    is_truncated: Boolean(payload.is_truncated),
    opening_balance: normalizeOpeningBalance(payload.opening_balance, fromDate),
    opening_bills: Array.isArray(payload.opening_bills) ? payload.opening_bills.map(normalizeBill) : [],
    voucher_totals: Array.isArray(payload.voucher_totals)
      ? payload.voucher_totals.map((row) => {
          const total = (row ?? {}) as Record<string, unknown>;
          return {
            voucher_type: toStringOrNull(total.voucher_type) ?? 'Unknown',
            count: toNumber(total.count),
            amount: toNumber(total.amount),
          };
        })
      : [],
    rows: Array.isArray(payload.rows)
      ? payload.rows.map((row) => {
          const entry = (row ?? {}) as Record<string, unknown>;
          return {
            id: toNumber(entry.id),
            date: toStringOrNull(entry.date),
            voucher_type: toStringOrNull(entry.voucher_type),
            doc_no: toStringOrNull(entry.doc_no),
            account_name: toStringOrNull(entry.account_name),
            narration: toStringOrNull(entry.narration),
            amount: toNullableNumber(entry.amount),
            is_future_dated: Boolean(entry.is_future_dated),
          };
        })
      : [],
    meta: ((payload.meta ?? {}) as LedgerStatement['meta']) ?? { source_available: false },
  };
}

function normalizePaymentReceipt(raw: unknown): PaymentReceiptRow {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    id: toNumber(row.id),
    date: toStringOrNull(row.date),
    amount: toNullableNumber(row.amount),
    doc_no: toStringOrNull(row.doc_no),
    account_name: toStringOrNull(row.account_name),
    narration: toStringOrNull(row.narration),
  };
}

function normalizePaymentSignal(payload: RpcPayload): PaymentSignal {
  return {
    success: true,
    customer_id: toNumber(payload.customer_id),
    window_days: toNumber(payload.window_days, 180),
    from_date: toStringOrNull(payload.from_date) ?? '',
    to_date: toStringOrNull(payload.to_date) ?? '',
    latest_receipt: payload.latest_receipt ? normalizePaymentReceipt(payload.latest_receipt) : null,
    days_since_last_payment: toNullableNumber(payload.days_since_last_payment),
    receipt_count: toNumber(payload.receipt_count),
    total_received: toNumber(payload.total_received),
    average_receipt_gap_days: toNullableNumber(payload.average_receipt_gap_days),
    rows: Array.isArray(payload.rows) ? payload.rows.map(normalizePaymentReceipt) : [],
    meta: ((payload.meta ?? {}) as PaymentSignal['meta']) ?? { source_available: false },
  };
}

export async function fetchCustomerCollectionSnapshot(customerId: number): Promise<CollectionSnapshot> {
  const { data, error } = await supabase.rpc('get_customer_collection_snapshot', {
    p_customer_id: customerId,
  });
  if (error) throw error;
  return normalizeSnapshot(requireSuccess((data ?? null) as RpcPayload | null, 'Collection snapshot'));
}

/** Uses the same server-side ownership rule as the receivables RPCs. */
export async function fetchCustomerReceivablesAccess(customerId: number): Promise<boolean> {
  const { data, error } = await supabase.rpc('receivables_can_view_customer', {
    p_customer_id: customerId,
  });
  if (error) throw error;
  return data === true || data === 'true';
}

export async function fetchCustomerOsBucket(
  customerId: number,
  bucket: AgingBucketFilter,
): Promise<OsBucketResult> {
  const { data, error } = await supabase.rpc('get_customer_os_bucket', {
    p_customer_id: customerId,
    p_bucket: bucket,
  });
  if (error) throw error;
  return normalizeBucketResult(requireSuccess((data ?? null) as RpcPayload | null, 'OS bucket'));
}

export async function fetchCustomerLedgerStatement(params: {
  customerId: number;
  fromDate: string;
  toDate: string;
  limit?: number;
}): Promise<LedgerStatement> {
  const { data, error } = await supabase.rpc('get_customer_ledger_statement', {
    p_customer_id: params.customerId,
    p_from_date: params.fromDate,
    p_to_date: params.toDate,
    p_limit: params.limit ?? 100,
  });
  if (error) throw error;
  return parseLedgerStatementPayload(requireSuccess((data ?? null) as RpcPayload | null, 'Ledger statement'));
}

export async function fetchCustomerPaymentSignal(params: {
  customerId: number;
  windowDays?: number;
  limit?: number;
}): Promise<PaymentSignal> {
  const { data, error } = await supabase.rpc('get_customer_payment_signal', {
    p_customer_id: params.customerId,
    p_window_days: params.windowDays ?? 180,
    p_limit: params.limit ?? 5,
  });
  if (error) throw error;
  return normalizePaymentSignal(requireSuccess((data ?? null) as RpcPayload | null, 'Payment signal'));
}

export async function fetchSalesReceivablesMeta(): Promise<SalesReceivablesMeta> {
  const { data, error } = await supabase.rpc('get_sales_receivables_meta');
  if (error) throw error;
  const payload = requireSuccess((data ?? null) as RpcPayload | null, 'Receivables meta');
  return {
    success: true,
    source_available: Boolean(payload.source_available),
    fingerprint: toStringOrNull(payload.fingerprint),
    customer_count: toNumber(payload.customer_count),
    row_count: toNumber(payload.row_count),
    total_pending: toNumber(payload.total_pending),
    credit_adjustments: toNumber(payload.credit_adjustments),
    busy_report_date: toStringOrNull(payload.busy_report_date),
    os_updated_at: toStringOrNull(payload.os_updated_at),
    generated_at: toStringOrNull(payload.generated_at),
  };
}

export async function recordCustomerCollectionEvent(params: {
  customerId: number;
  eventType: CollectionEventType;
  channel?: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabase.rpc('record_customer_collection_event', {
    p_customer_id: params.customerId,
    p_event_type: params.eventType,
    p_channel: params.channel ?? null,
    p_payload: params.payload ?? {},
  });
  if (error) throw error;
}

function moneyForMessage(amount: number | null | undefined): string {
  const value = Number(amount ?? 0);
  return `Rs ${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function dateForMessage(value: string | null | undefined): string {
  if (!value) return 'latest Busy report';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatCustomerShareDate(date);
}

function finalizeMessage(chunks: string[]): string {
  const body = chunks.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (body.length <= MAX_MESSAGE_CHARS) return body;
  return `${body.slice(0, MAX_MESSAGE_CHARS - 1)}...`;
}

export function buildCollectionReminderMessage(snapshot: CollectionSnapshot, bills = snapshot.top_bills): string {
  const b = snapshot.buckets;
  const over60 = b['61_90'].amount + b['90_plus'].amount;
  const topBills = bills.filter((bill) => bill.pending_amount > 0).slice(0, 5);
  const chunks: string[] = [
    `Hi ${snapshot.customer.name},`,
    '',
    `*Payment reminder* as of ${dateForMessage(snapshot.meta.busy_report_date)}.`,
    `Total pending: *${moneyForMessage(snapshot.summary.total_pending)}*`,
    '',
    '*Aging:*',
    `0-30: ${moneyForMessage(b['0_30'].amount)}`,
    `31-60: ${moneyForMessage(b['31_60'].amount)}`,
    `61-90: ${moneyForMessage(b['61_90'].amount)}`,
    `90+: ${moneyForMessage(b['90_plus'].amount)}`,
  ];

  if (over60 > 0) chunks.push(`60+ overdue: *${moneyForMessage(over60)}*`);
  if (snapshot.summary.credit_adjustments > 0) {
    chunks.push(`Credits/adjustments: ${moneyForMessage(snapshot.summary.credit_adjustments)}`);
  }

  if (topBills.length > 0) {
    chunks.push('', '*Top overdue bills:*');
    for (const bill of topBills) {
      const billNo = bill.bill_no || bill.refcode || 'Bill';
      chunks.push(`- ${billNo}: ${moneyForMessage(bill.pending_amount)} (${bill.days} days)`);
    }
  }

  chunks.push('', 'Please share the expected payment date.', 'Thank you.', '- Pathak Auto Sales');
  return finalizeMessage(chunks);
}

export function buildLedgerStatementMessage(
  snapshot: CollectionSnapshot,
  statement: LedgerStatement,
): string {
  const chunks: string[] = [
    `Hi ${snapshot.customer.name},`,
    '',
    `*Ledger summary* from ${dateForMessage(statement.from_date)} to ${dateForMessage(statement.to_date)}.`,
    `Current pending: *${moneyForMessage(snapshot.summary.total_pending)}*`,
  ];

  if (statement.opening_balance.count > 0) {
    chunks.push(
      `Opening balance (before ${dateForMessage(statement.opening_balance.as_of)}): *${moneyForMessage(statement.opening_balance.amount)}* (${statement.opening_balance.count} bills)`,
    );
  }

  if (statement.voucher_totals.length > 0) {
    chunks.push('', '*Voucher totals:*');
    for (const total of statement.voucher_totals.slice(0, 5)) {
      chunks.push(`- ${total.voucher_type}: ${moneyForMessage(total.amount)} (${total.count})`);
    }
  }

  if (statement.rows.length > 0) {
    chunks.push('', '*Recent entries:*');
    for (const row of statement.rows.slice(0, 6)) {
      const label = row.voucher_type || 'Entry';
      const doc = row.doc_no ? ` ${row.doc_no}` : '';
      chunks.push(`- ${dateForMessage(row.date)} ${label}${doc}: ${moneyForMessage(row.amount)}`);
    }
  }

  chunks.push('', 'Please confirm if any entry needs checking.', 'Thank you.', '- Pathak Auto Sales');
  return finalizeMessage(chunks);
}

export function whatsappUrlForCustomer(mobile: string | null | undefined, message: string): string {
  const digits = digitsOnlyMobile(mobile);
  const phoneDigits = digits.length === 10 ? `91${digits}` : digits;
  return phoneDigits ? whatsappShareUrl(phoneDigits, message) : whatsappPrefilledUrl(message);
}
