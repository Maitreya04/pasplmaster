/**
 * Whether to use Supabase Realtime (`postgres_changes` over WebSocket).
 *
 * Supabase **Free** includes Realtime; your dashboard "Realtime requests"
 * counter proves the product path exists. What sometimes fails is the
 * **network** (corporate proxy, strict firewall, broken middleboxes) that
 * blocks `wss://` even though REST works.
 *
 * Set `VITE_DISABLE_SUPABASE_REALTIME=true` in `.env` / hosting env to skip
 * subscriptions and fall back to REST polling instead. Items still use
 * watermark deltas + IndexedDB, so egress stays manageable.
 */
export function isSupabasePostgresChangesEnabled(): boolean {
  const v = import.meta.env.VITE_DISABLE_SUPABASE_REALTIME;
  return v !== 'true' && v !== '1';
}

/**
 * Use the low-volume queue event stream + compact billing snapshot RPC.
 *
 * Queue-event migrations are now part of the production baseline, so this is
 * on by default. Set the flag to `false` only when diagnosing a deployment.
 * Queue UIs subscribe to `queue_events` instead of high-churn tables like
 * `orders`, `order_items`, `work_claims`, and stock sync tables.
 */
export function isBillingQueueEventsEnabled(): boolean {
  const v = import.meta.env.VITE_BILLING_QUEUE_EVENTS;
  return v !== 'false' && v !== '0';
}

/**
 * Direct table-level Postgres Changes are intentionally off by default.
 *
 * Supabase Realtime must inspect WAL for every table in the publication, and
 * row-change authorization scales with connected subscribers. Keep hot tables
 * on REST polling/event streams unless explicitly debugging a local setup.
 */
export function isDirectTableRealtimeEnabled(): boolean {
  if (!isSupabasePostgresChangesEnabled()) return false;
  const v = import.meta.env.VITE_ENABLE_DIRECT_TABLE_REALTIME;
  return v === 'true' || v === '1';
}
