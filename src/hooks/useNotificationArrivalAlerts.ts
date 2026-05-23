import { useEffect, useRef } from 'react';
import { playNotificationAlert, vibrateNotificationAlert } from '../lib/notificationAlert';
import type { UserNotification } from '../types';

/** Play loud alert + strong haptics when unread notifications arrive in realtime. */
export function useNotificationArrivalAlerts(
  notifications: UserNotification[],
  enabled: boolean,
): void {
  const seenIdsRef = useRef<Set<number>>(new Set());
  const seededRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const unread = notifications.filter((n) => n.read_at === null);

    if (!seededRef.current) {
      unread.forEach((n) => seenIdsRef.current.add(n.id));
      seededRef.current = true;
      return;
    }

    const fresh = unread.filter((n) => !seenIdsRef.current.has(n.id));
    if (fresh.length === 0) return;

    playNotificationAlert();
    vibrateNotificationAlert();
    fresh.forEach((n) => seenIdsRef.current.add(n.id));
  }, [notifications, enabled]);
}
