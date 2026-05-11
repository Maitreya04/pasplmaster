import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from '@supabase/supabase-js';
import { supabase } from './supabase/client';

/**
 * Resilient `postgres_changes` subscription helper.
 *
 * Why this exists: a previous attempt at realtime in this codebase was
 * reverted to polling because dropped websockets meant rows silently
 * stopped updating (see commit 4f8b292). This wrapper:
 *
 *   - Auto-reconnects with exponential backoff on CHANNEL_ERROR / CLOSED.
 *   - Surfaces a `onReconnect` callback so callers can run a watermark
 *     reconcile (fetch rows with `updated_at > last_seen`) to catch any
 *     events missed while disconnected.
 *
 * One channel per logical subscription; the Supabase realtime client
 * multiplexes channels over a single websocket, so there is no extra
 * connection cost.
 */

type ChangeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

// Supabase types require an index signature on the row generic; we relax it
// here so callers can use plain interfaces.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = { [key: string]: any };

export type ChangePayload<Row extends AnyRow = AnyRow> =
  RealtimePostgresChangesPayload<Row>;

export interface SubscribeToTableOptions<Row extends AnyRow> {
  /** Stable channel name. Include a per-subscriber suffix (e.g. user id) when scoping. */
  channelName: string;
  table: string;
  schema?: string;
  /** PostgREST-style filter, e.g. `is_active=eq.true` or `order_id=eq.123`. */
  filter?: string;
  events?: ChangeEvent[];
  onChange: (payload: ChangePayload<Row>) => void;
  /** Fires every time the channel transitions to SUBSCRIBED after the first time. */
  onReconnect?: () => void;
}

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export function subscribeToTable<Row extends AnyRow>(
  opts: SubscribeToTableOptions<Row>,
): () => void {
  let channel: RealtimeChannel | null = null;
  let cancelled = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = INITIAL_BACKOFF_MS;
  let everConnected = false;

  const events: ChangeEvent[] = opts.events ?? ['*'];

  const connect = () => {
    if (cancelled) return;

    let ch = supabase.channel(opts.channelName);

    for (const event of events) {
      // Cast: supabase-js types don't accept the wildcard event in a union cleanly.
      ch = ch.on(
        'postgres_changes',
        {
          event,
          schema: opts.schema ?? 'public',
          table: opts.table,
          ...(opts.filter ? { filter: opts.filter } : {}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        (payload) => {
          opts.onChange(payload as ChangePayload<Row>);
        },
      );
    }

    channel = ch.subscribe((status) => {
      if (cancelled) return;

      if (status === 'SUBSCRIBED') {
        backoffMs = INITIAL_BACKOFF_MS;
        if (everConnected) opts.onReconnect?.();
        everConnected = true;
        return;
      }

      if (
        status === 'CHANNEL_ERROR' ||
        status === 'CLOSED' ||
        status === 'TIMED_OUT'
      ) {
        if (channel) {
          void supabase.removeChannel(channel);
          channel = null;
        }
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          retryTimer = null;
          connect();
        }, backoffMs);
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      }
    });
  };

  connect();

  return () => {
    cancelled = true;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (channel) {
      void supabase.removeChannel(channel);
      channel = null;
    }
  };
}
