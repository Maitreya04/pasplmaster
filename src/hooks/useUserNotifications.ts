import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { subscribeToTable, type ChangePayload } from '../lib/realtime';
import {
  isDirectTableRealtimeEnabled,
  isSupabasePostgresChangesEnabled,
} from '../lib/realtimePolicy';
import type { UserNotification } from '../types';

const PAGE_SIZE = 50;
/** Inbox only loads recent rows — matches prune_user_notifications unread window. */
const INBOX_DAYS = 180;
const REALTIME_ON = isSupabasePostgresChangesEnabled();
const DIRECT_TABLE_REALTIME_ON = isDirectTableRealtimeEnabled();
const POLL_MS = 10_000;
const REFETCH_DEBOUNCE_MS = 750;

const NOTIFICATION_COLUMNS =
  'id, user_id, title, body, type, order_id, payload, read_at, created_at';

function inboxSinceIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - INBOX_DAYS);
  return d.toISOString();
}

function notificationFromRow(row: Record<string, unknown>): UserNotification | null {
  if (typeof row.id !== 'number' || typeof row.user_id !== 'number') return null;
  return {
    id: row.id,
    user_id: row.user_id,
    title: typeof row.title === 'string' ? row.title : '',
    body: typeof row.body === 'string' ? row.body : '',
    type: typeof row.type === 'string' ? row.type : '',
    order_id: typeof row.order_id === 'number' ? row.order_id : null,
    payload:
      row.payload != null && typeof row.payload === 'object' && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {},
    read_at: typeof row.read_at === 'string' ? row.read_at : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : new Date(0).toISOString(),
  };
}

function mergeNotificationChange(
  prev: UserNotification[],
  payload: ChangePayload<UserNotification>,
): UserNotification[] | null {
  if (payload.eventType === 'INSERT') {
    const row = notificationFromRow(payload.new as unknown as Record<string, unknown>);
    if (!row) return null;
    if (prev.some((n) => n.id === row.id)) return prev;
    return [row, ...prev].slice(0, PAGE_SIZE);
  }
  if (payload.eventType === 'UPDATE') {
    const row = notificationFromRow(payload.new as unknown as Record<string, unknown>);
    if (!row) return null;
    return prev.map((n) => (n.id === row.id ? row : n));
  }
  if (payload.eventType === 'DELETE') {
    const id = (payload.old as { id?: number }).id;
    if (typeof id !== 'number') return null;
    return prev.filter((n) => n.id !== id);
  }
  return null;
}

export function useUserNotifications(userId: number | null) {
  const uid = useId();
  const [items, setItems] = useState<UserNotification[]>([]);
  const [loading, setLoading] = useState(true);
  /** Set when the table is missing, RLS blocks read, or network fails — inbox is empty. */
  const [fetchError, setFetchError] = useState<string | null>(null);
  const refetchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchNotifications = useCallback(async (opts?: { background?: boolean }) => {
    if (!userId) {
      setItems([]);
      setFetchError(null);
      setLoading(false);
      return;
    }
    if (!opts?.background) {
      setLoading(true);
    }
    const { data, error } = await supabase
      .from('user_notifications')
      .select(NOTIFICATION_COLUMNS)
      .eq('user_id', userId)
      .gte('created_at', inboxSinceIso())
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);
    if (error) {
      console.error('user_notifications fetch', error);
      setFetchError(
        [error.code, error.message].filter(Boolean).join(': ') || 'Failed to load notifications',
      );
      setItems([]);
    } else {
      setFetchError(null);
      setItems((data ?? []) as UserNotification[]);
    }
    setLoading(false);
  }, [userId]);

  const scheduleBackgroundRefetch = useCallback(() => {
    if (refetchDebounceRef.current) clearTimeout(refetchDebounceRef.current);
    refetchDebounceRef.current = setTimeout(() => {
      refetchDebounceRef.current = null;
      void fetchNotifications({ background: true });
    }, REFETCH_DEBOUNCE_MS);
  }, [fetchNotifications]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchNotifications();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchNotifications]);

  useEffect(() => {
    if (!userId) return;

    const useRealtime = REALTIME_ON && DIRECT_TABLE_REALTIME_ON;

    if (!useRealtime) {
      const id = window.setInterval(() => {
        void fetchNotifications({ background: true });
      }, POLL_MS);
      return () => window.clearInterval(id);
    }

    let pollId: ReturnType<typeof window.setInterval> | null = null;
    const unsub = subscribeToTable<UserNotification>({
      channelName: `user-notifications-${userId}-${uid}`,
      table: 'user_notifications',
      filter: `user_id=eq.${userId}`,
      onChange: (payload) => {
        let needsRefetch = false;
        setItems((prev) => {
          const merged = mergeNotificationChange(prev, payload);
          if (merged != null) return merged;
          needsRefetch = true;
          return prev;
        });
        if (needsRefetch) scheduleBackgroundRefetch();
      },
      onReconnect: () => {
        scheduleBackgroundRefetch();
      },
      onGiveUp: () => {
        if (pollId != null) return;
        pollId = window.setInterval(() => {
          void fetchNotifications({ background: true });
        }, POLL_MS);
      },
    });

    return () => {
      unsub();
      if (pollId != null) window.clearInterval(pollId);
      if (refetchDebounceRef.current) clearTimeout(refetchDebounceRef.current);
    };
  }, [userId, uid, fetchNotifications, scheduleBackgroundRefetch]);

  const unreadCount = useMemo(
    () => items.filter((n) => n.read_at === null).length,
    [items],
  );

  const markRead = useCallback(
    async (id: number) => {
      if (!userId) return;
      const { error } = await supabase
        .from('user_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', userId);
      if (!error) {
        setItems((prev) =>
          prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)),
        );
      }
    },
    [userId],
  );

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    const now = new Date().toISOString();
    const unreadIds = items.filter((n) => n.read_at === null).map((n) => n.id);
    if (unreadIds.length === 0) return;
    const { error } = await supabase
      .from('user_notifications')
      .update({ read_at: now })
      .eq('user_id', userId)
      .in('id', unreadIds);
    if (!error) {
      setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? now })));
    }
  }, [userId, items]);

  return {
    items,
    loading,
    fetchError,
    unreadCount,
    refetch: fetchNotifications,
    markRead,
    markAllRead,
  };
}
