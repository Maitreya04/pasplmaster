import assert from 'node:assert/strict';
import {
  buildCollectionReminderMessage,
  buildLedgerStatementMessage,
  parseLedgerStatementPayload,
  type CollectionSnapshot,
  type LedgerStatement,
  type OutstandingBill,
} from './receivables';

const snapshot: CollectionSnapshot = {
  success: true,
  customer: {
    id: 1,
    name: 'Acme Traders',
    busy_code: 1001,
    mobile: '9876543210',
    salesman: 'Ravi',
    city: 'Delhi',
    gstin: null,
    credit_limit: null,
    credit_days: 30,
  },
  summary: {
    total_pending: 579019,
    credit_adjustments: 0,
    net_outstanding: 579019,
    bill_count: 23,
    oldest_days: 95,
    largest_bill_amount: 267097,
    over_credit_days_amount: null,
    over_credit_days_count: 0,
  },
  buckets: {
    '0_30': { label: '0-30', amount: 0, count: 0 },
    '31_60': { label: '31-60', amount: 0, count: 0 },
    '61_90': { label: '61-90', amount: 579019, count: 23 },
    '90_plus': { label: '90+', amount: 0, count: 0 },
  },
  top_bills: [],
  last_payment: null,
  meta: {
    source_available: true,
    busy_report_date: '2026-07-19',
    os_updated_at: null,
    generated_at: null,
    ledger_match_confidence: 'exact_name',
  },
};

const lateBills: OutstandingBill[] = [
  {
    refcode: '474812',
    bill_no: '474812',
    type: 'Sales',
    bill_date: '2026-06-30',
    due_date: '2026-07-30',
    days: 75,
    ref_amount: 267097,
    pending_amount: 267097,
    bucket: '61_90',
  },
];

const statementWithOpening: LedgerStatement = {
  success: true,
  customer_id: 1,
  from_date: '2026-04-01',
  to_date: '2026-07-19',
  row_count: 12,
  is_truncated: false,
  opening_balance: {
    amount: 579019,
    count: 23,
    as_of: '2026-04-01',
    is_truncated: false,
  },
  opening_bills: lateBills,
  voucher_totals: [],
  rows: [],
  meta: { source_available: true, source: 'ledger', match_confidence: 'exact_name' },
};

const statementWithoutOpening: LedgerStatement = {
  ...statementWithOpening,
  opening_balance: { amount: 0, count: 0, as_of: '2026-04-01', is_truncated: false },
  opening_bills: [],
};

const parsed = parseLedgerStatementPayload({
  success: true,
  customer_id: 1,
  from_date: '2026-04-01',
  to_date: '2026-07-19',
  row_count: 0,
  is_truncated: false,
  opening_balance: {
    amount: 579019,
    count: 23,
    as_of: '2026-04-01',
    is_truncated: true,
  },
  opening_bills: [
    {
      refcode: '474812',
      bill_no: '474812',
      type: 'Sales',
      bill_date: '2026-03-15',
      due_date: null,
      days: 120,
      ref_amount: 579019,
      pending_amount: 579019,
      bucket: '90_plus',
    },
  ],
  voucher_totals: [],
  rows: [],
  meta: { source_available: true },
});

assert.equal(parsed.opening_balance.amount, 579019);
assert.equal(parsed.opening_balance.count, 23);
assert.equal(parsed.opening_balance.is_truncated, true);
assert.equal(parsed.opening_bills.length, 1);
assert.equal(parsed.opening_bills[0]?.bill_no, '474812');
assert.equal(parsed.opening_bills[0]?.bucket, '90_plus');

const ledgerMessageWithOb = buildLedgerStatementMessage(snapshot, statementWithOpening);
assert.match(ledgerMessageWithOb, /Opening balance \(before/);
assert.match(ledgerMessageWithOb, /Rs 5,79,019/);
assert.match(ledgerMessageWithOb, /23 bills/);

const ledgerMessageWithoutOb = buildLedgerStatementMessage(snapshot, statementWithoutOpening);
assert.doesNotMatch(ledgerMessageWithoutOb, /Opening balance/);

const reminderMessage = buildCollectionReminderMessage(snapshot, lateBills);
assert.match(reminderMessage, /474812/);
assert.match(reminderMessage, /Rs 2,67,097/);
assert.match(reminderMessage, /75 days/);

console.log('receivablesLedger.test.ts: all assertions passed');
