/**
 * Whether to use Supabase Realtime (`postgres_changes` over WebSocket).
 *
 * Supabase **Free** includes Realtime; your dashboard "Realtime requests"
 * counter proves the product path exists. What sometimes fails is the
 * **network** (corporate proxy, strict firewall, broken middleboxes) that
 * blocks `wss://` even though REST works.
 *
 * Set `VITE_DISABLE_SUPABASE_REALTIME=true` in `.env` / hosting env to skip
 * subscriptions and fall back to short REST polling instead. Items still use
 * watermark deltas + IndexedDB, so egress stays manageable.
 */
export function isSupabasePostgresChangesEnabled(): boolean {
  const v = import.meta.env.VITE_DISABLE_SUPABASE_REALTIME;
  return v !== 'true' && v !== '1';
}

/**
 * Use the low-volume billing queue event stream + compact snapshot RPC.
 *
 * Keep this behind a flag so production can roll the DB migration first and
 * fall back to the existing table-subscription path instantly if needed.
 */
export function isBillingQueueEventsEnabled(): boolean {
  const v = import.meta.env.VITE_BILLING_QUEUE_EVENTS;
  return v === 'true' || v === '1';
}
