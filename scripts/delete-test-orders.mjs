/**
 * Ops script: delete specific test orders and report related rows removed.
 * Uses SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL from .env.local
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const ORDER_NUMBERS = [
  'PA-260602-0038',
  'PA-260602-0035',
  'PA-260602-0016',
  'PA-260602-0011',
];

function loadEnvLocal() {
  const path = resolve(process.cwd(), '.env.local');
  const raw = readFileSync(path, 'utf8');
  const env = {};
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

async function countFor(supabase, table, orderIds, extra = {}) {
  if (orderIds.length === 0) return 0;
  let q = supabase.from(table).select('id', { count: 'exact', head: true }).in('order_id', orderIds);
  for (const [k, v] of Object.entries(extra)) {
    q = q.eq(k, v);
  }
  const { count, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

async function main() {
  const env = loadEnvLocal();
  const url = env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const dryRun = process.argv.includes('--dry-run');

  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('id, order_number, workflow_status, customer_name, total_value, item_count')
    .in('order_number', ORDER_NUMBERS);

  if (ordersErr) throw new Error(ordersErr.message);

  if (!orders?.length) {
    console.log('No matching orders found (already deleted?).');
    return;
  }

  console.log('Orders to delete:');
  for (const o of orders) {
    console.log(
      `  ${o.order_number} id=${o.id} status=${o.workflow_status} customer=${o.customer_name} total=${o.total_value}`,
    );
  }

  const orderIds = orders.map((o) => o.id);
  const missing = ORDER_NUMBERS.filter((n) => !orders.some((o) => o.order_number === n));
  if (missing.length) {
    console.warn('Not found in DB:', missing.join(', '));
  }

  const tables = [
    'order_items',
    'work_claims',
    'order_events',
    'stock_reservations',
    'pending_items',
    'queue_events',
    'billing_customer_updates',
    'user_notifications',
    'notification_events',
  ];

  console.log('\nRelated row counts (will cascade on order delete except notifications cleaned first):');
  for (const table of tables) {
    const n = await countFor(supabase, table, orderIds);
    if (n > 0) console.log(`  ${table}: ${n}`);
  }

  const { data: reservations } = await supabase
    .from('stock_reservations')
    .select('status, qty_reserved')
    .in('order_id', orderIds);

  if (reservations?.length) {
    const byStatus = {};
    for (const r of reservations) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    }
    console.log('  stock_reservations by status:', byStatus);
    const active = reservations.filter((r) =>
      ['active', 'awaiting_erp_sync'].includes(r.status),
    );
    if (active.length) {
      console.log(
        `  → ${active.length} active holds will be removed (frees sales-available qty)`,
      );
    }
  }

  if (dryRun) {
    console.log('\n--dry-run: no deletes performed.');
    return;
  }

  const { error: notifErr } = await supabase
    .from('user_notifications')
    .delete()
    .in('order_id', orderIds);
  if (notifErr) throw new Error(`user_notifications delete: ${notifErr.message}`);

  const { error: eventsErr } = await supabase
    .from('notification_events')
    .delete()
    .in('order_id', orderIds);
  if (eventsErr) throw new Error(`notification_events delete: ${eventsErr.message}`);

  const { data: deleted, error: delErr } = await supabase
    .from('orders')
    .delete()
    .in('order_number', ORDER_NUMBERS)
    .select('id, order_number');

  if (delErr) throw new Error(`orders delete: ${delErr.message}`);

  console.log('\nDeleted orders:', deleted?.map((d) => d.order_number).join(', ') ?? '(none)');

  const { data: verify } = await supabase
    .from('orders')
    .select('order_number')
    .in('order_number', ORDER_NUMBERS);
  if (verify?.length) {
    throw new Error(`Verify failed: still present: ${verify.map((v) => v.order_number).join(', ')}`);
  }
  console.log('Verified: all four order numbers gone from orders table.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
