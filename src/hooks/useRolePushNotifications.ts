import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import {
  getExistingPushSubscription,
  getNotificationPermission,
  getPushDeviceId,
  isPushSupported,
  isStandaloneDisplayMode,
  parseSubscriptionKeys,
  registerPushServiceWorker,
  vapidPublicKeyToUint8Array,
} from '../lib/push';
import type { PushCapabilityState } from '../types';

export type AppRole = 'sales' | 'billing' | 'picking' | 'admin' | 'partner';

interface UseRolePushNotificationsOptions {
  role: AppRole | null;
  userId: number | null;
  userName: string | null;
}

interface PushActionResult {
  ok: boolean;
  error: string | null;
}

const VAPID_PUBLIC_KEY = import.meta.env.VITE_PUSH_VAPID_PUBLIC_KEY as string | undefined;

export function useRolePushNotifications({
  role,
  userId,
  userName,
}: UseRolePushNotificationsOptions) {
  const [state, setState] = useState<PushCapabilityState>({
    supported: isPushSupported(),
    standalone: isStandaloneDisplayMode(),
    permission: getNotificationPermission(),
    enabled: false,
    loading: false,
    error: null,
  });
  const touchTimeoutRef = useRef<number | null>(null);

  const syncSubscription = useCallback(
    async (subscription: PushSubscription | null): Promise<boolean> => {
      if (!subscription || !role || role === 'admin' || role === 'partner' || !userId || !userName) {
        return false;
      }

      const keys = parseSubscriptionKeys(subscription);
      const { error } = await supabase.rpc('sync_push_subscription', {
        p_device_id: getPushDeviceId(),
        p_endpoint: keys.endpoint,
        p_p256dh: keys.p256dh,
        p_auth: keys.auth,
      });

      if (error) {
        throw error;
      }

      return true;
    },
    [role, userId, userName],
  );

  const refreshState = useCallback(async () => {
    if (!isPushSupported()) {
      setState({
        supported: false,
        standalone: isStandaloneDisplayMode(),
        permission: getNotificationPermission(),
        enabled: false,
        loading: false,
        error: null,
      });
      return;
    }

    try {
      await registerPushServiceWorker();
      const subscription = await getExistingPushSubscription();
      const permission = getNotificationPermission();
      const enabled = await syncSubscription(subscription);
      setState((prev) => ({
        ...prev,
        supported: true,
        standalone: isStandaloneDisplayMode(),
        permission,
        enabled,
        loading: false,
        error: null,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to refresh alerts';
      setState((prev) => ({
        ...prev,
        supported: true,
        standalone: isStandaloneDisplayMode(),
        permission: getNotificationPermission(),
        enabled: false,
        loading: false,
        error: message,
      }));
    }
  }, [syncSubscription]);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  useEffect(() => {
    if (touchTimeoutRef.current !== null) {
      window.clearTimeout(touchTimeoutRef.current);
      touchTimeoutRef.current = null;
    }

    if (!role || role === 'admin' || !state.enabled) return;

    const handleVisibility = () => {
      if (document.hidden) return;
      if (touchTimeoutRef.current !== null) return;
      touchTimeoutRef.current = window.setTimeout(() => {
        touchTimeoutRef.current = null;
        void getExistingPushSubscription()
          .then((subscription) => syncSubscription(subscription))
          .catch(() => undefined);
      }, 300);
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (touchTimeoutRef.current !== null) {
        window.clearTimeout(touchTimeoutRef.current);
        touchTimeoutRef.current = null;
      }
    };
  }, [role, state.enabled, syncSubscription]);

  const enable = useCallback(async () => {
    if (!isPushSupported()) {
      const error = 'This browser does not support push notifications.';
      setState((prev) => ({
        ...prev,
        supported: false,
        standalone: isStandaloneDisplayMode(),
        error,
      }));
      return { ok: false, error } satisfies PushActionResult;
    }
    if (!isStandaloneDisplayMode()) {
      const error = 'On iPhone and iPad, open the installed Home Screen app to enable alerts.';
      setState((prev) => ({
        ...prev,
        standalone: false,
        error,
      }));
      return { ok: false, error } satisfies PushActionResult;
    }
    if (!role || role === 'admin' || !userId || !userName) {
      const error = 'Select your name before enabling alerts.';
      setState((prev) => ({
        ...prev,
        error,
      }));
      return { ok: false, error } satisfies PushActionResult;
    }
    if (!VAPID_PUBLIC_KEY) {
      const error = 'Push public key is not configured.';
      setState((prev) => ({
        ...prev,
        error,
      }));
      return { ok: false, error } satisfies PushActionResult;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        const err =
          permission === 'denied'
            ? 'Browser notifications are blocked for this device.'
            : 'Notification permission was not granted.';
        setState((prev) => ({
          ...prev,
          permission,
          enabled: false,
          loading: false,
          error: err,
        }));
        return { ok: false, error: err } satisfies PushActionResult;
      }

      const registration = await registerPushServiceWorker();
      if (!registration) {
        throw new Error('Service worker registration failed');
      }

      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidPublicKeyToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
        });
      }

      await syncSubscription(subscription);
      setState({
        supported: true,
        standalone: true,
        permission,
        enabled: true,
        loading: false,
        error: null,
      });
      return { ok: true, error: null } satisfies PushActionResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to enable alerts';
      setState((prev) => ({
        ...prev,
        standalone: isStandaloneDisplayMode(),
        permission: getNotificationPermission(),
        enabled: false,
        loading: false,
        error: message,
      }));
      return { ok: false, error: message } satisfies PushActionResult;
    }
  }, [role, syncSubscription, userId, userName]);

  const disable = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const subscription = await getExistingPushSubscription();
      if (subscription) {
        await subscription.unsubscribe();
        await supabase
          .from('push_subscriptions')
          .update({
            enabled: false,
            last_seen_at: new Date().toISOString(),
          })
          .eq('endpoint', subscription.endpoint);
      } else if (role && role !== 'admin' && userId) {
        await supabase
          .from('push_subscriptions')
          .update({
            enabled: false,
            last_seen_at: new Date().toISOString(),
          })
          .eq('device_id', getPushDeviceId())
          .eq('role', role)
          .eq('user_id', userId);
      }

      setState((prev) => ({
        ...prev,
        standalone: isStandaloneDisplayMode(),
        permission: getNotificationPermission(),
        enabled: false,
        loading: false,
        error: null,
      }));
      return { ok: true, error: null } satisfies PushActionResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to disable alerts';
      setState((prev) => ({
        ...prev,
        standalone: isStandaloneDisplayMode(),
        permission: getNotificationPermission(),
        loading: false,
        error: message,
      }));
      return { ok: false, error: message } satisfies PushActionResult;
    }
  }, [role, userId]);

  return {
    ...state,
    enable,
    disable,
    refresh: refreshState,
  };
}
