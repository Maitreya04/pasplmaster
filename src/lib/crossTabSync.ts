/**
 * Cross-tab cache invalidation via BroadcastChannel.
 *
 * When realtime over wss:// is healthy this is redundant — every tab gets
 * the same Postgres event. When wss:// is blocked (corporate WiFi, etc.) it
 * still gives instant updates to other tabs on the same device after the
 * user takes a stock-affecting action, with zero Supabase egress.
 *
 * Falls back to a no-op when BroadcastChannel is unavailable (older Safari).
 */
import { queryClient } from './queryClient';
import { ITEMS_QUERY_KEY } from '../hooks/useItems';

type SyncMessage =
  | { kind: 'invalidate'; queryKey: readonly unknown[] }
  | { kind: 'items-changed' };

const CHANNEL_NAME = 'paspl-cross-tab-sync';

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (channel) return channel;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener('message', (event) => {
      const msg = event.data as SyncMessage | undefined;
      if (!msg) return;
      try {
        if (msg.kind === 'invalidate') {
          void queryClient.invalidateQueries({ queryKey: msg.queryKey });
        } else if (msg.kind === 'items-changed') {
          void queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY });
        }
      } catch {
        // ignore — never break the app from a sync handler
      }
    });
    return channel;
  } catch {
    channel = null;
    return null;
  }
}

function post(msg: SyncMessage): void {
  const ch = getChannel();
  if (!ch) return;
  try {
    ch.postMessage(msg);
  } catch {
    // closed / disconnected — ignore
  }
}

/** Tell every other tab on this device to refresh items immediately. */
export function broadcastItemsChanged(): void {
  post({ kind: 'items-changed' });
}

/** Generic invalidate broadcast for other query keys (orders lists, claims, etc.). */
export function broadcastInvalidate(queryKey: readonly unknown[]): void {
  post({ kind: 'invalidate', queryKey });
}
