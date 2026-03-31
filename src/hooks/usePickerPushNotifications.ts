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
import type { PushCapabilityState, PushSubscriptionRecord } from '../types';

interface UsePickerPushNotificationsOptions {
  role: 'sales' | 'billing' | 'picking' | 'admin' | null;
  userId: number | null;
  userName: string | null;
}

const VAPID_PUBLIC_KEY = import.meta.env.VITE_PUSH_VAPID_PUBLIC_KEY as string | undefined;

export function usePickerPushNotifications({
  role,
  userId,
  userName,
}: UsePickerPushNotificationsOptions) {
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
      if (!subscription || role !== 'picking' || !userId || !userName) {
        return false;
      }

      const keys = parseSubscriptionKeys(subscription);
      const payload: Omit<PushSubscriptionRecord, 'id' | 'created_at' | 'updated_at'> = {
        user_id: userId,
        user_name: userName,
        role: 'picking',
        device_id: getPushDeviceId(),
        endpoint: keys.endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        enabled: true,
        last_seen_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('push_subscriptions')
        .upsert(payload, { onConflict: 'endpoint' });

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
      setState((prev) => ({
        ...prev,
        supported: true,
        standalone: isStandaloneDisplayMode(),
        permission: getNotificationPermission(),
        enabled: false,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to refresh alerts',
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

    if (role !== 'picking' || !state.enabled) return;

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
      setState((prev) => ({
        ...prev,
        supported: false,
        standalone: isStandaloneDisplayMode(),
        error: 'This browser does not support push notifications.',
      }));
      return false;
    }
    if (!isStandaloneDisplayMode()) {
      setState((prev) => ({
        ...prev,
        standalone: false,
        error: 'On iPhone and iPad, open the installed Home Screen app to enable alerts.',
      }));
      return false;
    }
    if (role !== 'picking' || !userId || !userName) {
      setState((prev) => ({
        ...prev,
        error: 'Select a picker name before enabling alerts.',
      }));
      return false;
    }
    if (!VAPID_PUBLIC_KEY) {
      setState((prev) => ({
        ...prev,
        error: 'Push public key is not configured.',
      }));
      return false;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState((prev) => ({
          ...prev,
          permission,
          enabled: false,
          loading: false,
          error:
            permission === 'denied'
              ? 'Browser notifications are blocked for this device.'
              : 'Notification permission was not granted.',
        }));
        return false;
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
      return true;
    } catch (error) {
      setState((prev) => ({
        ...prev,
        standalone: isStandaloneDisplayMode(),
        permission: getNotificationPermission(),
        enabled: false,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to enable alerts',
      }));
      return false;
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
      } else if (role === 'picking' && userId) {
        await supabase
          .from('push_subscriptions')
          .update({
            enabled: false,
            last_seen_at: new Date().toISOString(),
          })
          .eq('device_id', getPushDeviceId())
          .eq('role', 'picking')
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
      return true;
    } catch (error) {
      setState((prev) => ({
        ...prev,
        standalone: isStandaloneDisplayMode(),
        permission: getNotificationPermission(),
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to disable alerts',
      }));
      return false;
    }
  }, [role, userId]);

  return {
    ...state,
    enable,
    disable,
    refresh: refreshState,
  };
}
