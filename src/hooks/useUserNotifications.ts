import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import type { UserNotification } from '../types';

const PAGE_SIZE = 50;

export function useUserNotifications(userId: number | null) {
  const uid = useId();
  const [items, setItems] = useState<UserNotification[]>([]);
  const [loading, setLoading] = useState(true);
  /** Set when the table is missing, RLS blocks read, or network fails — inbox is empty. */
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    if (!userId) {
      setItems([]);
      setFetchError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('user_notifications')
      .select('id, user_id, title, body, type, order_id, payload, read_at, created_at')
      .eq('user_id', userId)
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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchNotifications();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchNotifications]);

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`user-notifications-${userId}-${uid}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_notifications',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void fetchNotifications();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, uid, fetchNotifications]);

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
