import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from '@supabase/supabase-js';
import { supabase } from './supabase/client';

/**
 * Resilient `postgres_changes` subscription helper.
 *
 * Hard requirements (paid for in production blood):
 *
 *   1. **Never recurse**. `supabase-js` invokes the subscribe status callback
 *      synchronously while iterating channel listeners. Calling
 *      `removeChannel` from inside that callback (re-entry) blows the stack
 *      with `RangeError: Maximum call stack size exceeded`. We defer all
 *      teardown to a fresh task tick.
 *
 *   2. **Never break the app**. Every Supabase API call is wrapped in
 *      try/catch. If realtime is unavailable for any reason, the rest of the
 *      app keeps working via REST keep-alive polling.
 *
 *   3. **Circuit-break**. If a channel fails repeatedly (e.g. wss:// is
 *      blocked on the user's network) we stop trying after a small number of
 *      attempts. REST polling takes over silently.
 */

type ChangeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

// Supabase row generic insists on an index signature; relax it for callers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = { [key: string]: any };

export type ChangePayload<Row extends AnyRow = AnyRow> =
  RealtimePostgresChangesPayload<Row>;

export interface SubscribeToTableOptions<Row extends AnyRow> {
  /** Stable channel name. Include a per-subscriber suffix when scoping. */
  channelName: string;
  table: string;
  schema?: string;
  /** PostgREST-style filter, e.g. `is_active=eq.true` or `order_id=eq.123`. */
  filter?: string;
  events?: ChangeEvent[];
  onChange: (payload: ChangePayload<Row>) => void;
  /** Fires whenever the channel transitions to SUBSCRIBED after the first time. */
  onReconnect?: () => void;
}

const INITIAL_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;
/** Stop retrying after this many consecutive connection failures. */
const MAX_FAILURES = 5;

function defer(fn: () => void): void {
  // Always run on a fresh task so we are out of any supabase-js listener loop.
  setTimeout(fn, 0);
}

function safeRemoveChannel(channel: RealtimeChannel | null): void {
  if (!channel) return;
  defer(() => {
    try {
      void supabase.removeChannel(channel);
    } catch (err) {
      // Swallow — channel may already be torn down by the client.
      if (typeof console !== 'undefined') {
        console.debug('[realtime] removeChannel failed', err);
      }
    }
  });
}

export function subscribeToTable<Row extends AnyRow>(
  opts: SubscribeToTableOptions<Row>,
): () => void {
  let channel: RealtimeChannel | null = null;
  let cancelled = false;
  let connecting = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = INITIAL_BACKOFF_MS;
  let everConnected = false;
  let consecutiveFailures = 0;
  let givenUp = false;

  const events: ChangeEvent[] = opts.events ?? ['*'];

  const scheduleRetry = () => {
    if (cancelled || givenUp) return;
    if (retryTimer) clearTimeout(retryTimer);
    const delay = backoffMs;
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, delay);
  };

  const handleFailure = (reason: string) => {
    if (cancelled || givenUp) return;
    consecutiveFailures += 1;

    // Tear down the failed channel on a fresh tick — never synchronously.
    const dead = channel;
    channel = null;
    safeRemoveChannel(dead);

    if (consecutiveFailures >= MAX_FAILURES) {
      givenUp = true;
      if (typeof console !== 'undefined') {
        console.warn(
          `[realtime] giving up on "${opts.channelName}" after ${consecutiveFailures} failed attempts (${reason}). App will use REST polling instead.`,
        );
      }
      return;
    }
    scheduleRetry();
  };

  const connect = () => {
    if (cancelled || givenUp || connecting || channel) return;
    connecting = true;

    let ch: RealtimeChannel;
    try {
      ch = supabase.channel(opts.channelName);
      for (const event of events) {
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
            try {
              opts.onChange(payload as ChangePayload<Row>);
            } catch (err) {
              if (typeof console !== 'undefined') {
                console.error('[realtime] onChange handler threw', err);
              }
            }
          },
        );
      }
    } catch (err) {
      connecting = false;
      if (typeof console !== 'undefined') {
        console.warn('[realtime] channel() / .on() threw', err);
      }
      handleFailure('setup_error');
      return;
    }

    try {
      const result = ch.subscribe((status) => {
        if (cancelled) return;

        if (status === 'SUBSCRIBED') {
          channel = ch;
          connecting = false;
          backoffMs = INITIAL_BACKOFF_MS;
          consecutiveFailures = 0;
          if (everConnected) {
            try {
              opts.onReconnect?.();
            } catch (err) {
              if (typeof console !== 'undefined') {
                console.error('[realtime] onReconnect threw', err);
              }
            }
          }
          everConnected = true;
          return;
        }

        if (
          status === 'CHANNEL_ERROR' ||
          status === 'CLOSED' ||
          status === 'TIMED_OUT'
        ) {
          // CRITICAL: do not call removeChannel synchronously here.
          // supabase-js is in the middle of iterating listeners; re-entry
          // produces "Maximum call stack size exceeded".
          connecting = false;
          // The channel reference is what we built locally; the real cleanup
          // happens in handleFailure on a deferred tick.
          if (!channel) channel = ch;
          handleFailure(status);
        }
      });
      // Some versions return the channel synchronously even before SUBSCRIBED.
      if (result && !channel) channel = result;
    } catch (err) {
      connecting = false;
      if (typeof console !== 'undefined') {
        console.warn('[realtime] subscribe() threw', err);
      }
      handleFailure('subscribe_error');
    }
  };

  // Kick off; never throw out of this module.
  try {
    connect();
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.warn('[realtime] initial connect threw', err);
    }
  }

  return () => {
    cancelled = true;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    const dead = channel;
    channel = null;
    safeRemoveChannel(dead);
  };
}
