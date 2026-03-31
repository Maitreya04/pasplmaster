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
import type {
  PushCapabilityState,
  PushDiagnostics,
  PushSubscriptionRecord,
} from '../types';

interface UsePickerPushNotificationsOptions {
  role: 'sales' | 'billing' | 'picking' | 'admin' | null;
  userId: number | null;
  userName: string | null;
}

interface PushActionResult {
  ok: boolean;
  error: string | null;
}

const VAPID_PUBLIC_KEY = import.meta.env.VITE_PUSH_VAPID_PUBLIC_KEY as string | undefined;

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const candidate = error as Record<string, unknown>;
    const messageParts = [
      typeof candidate.message === 'string' ? candidate.message : null,
      typeof candidate.details === 'string' ? candidate.details : null,
      typeof candidate.hint === 'string' ? candidate.hint : null,
      typeof candidate.code === 'string' ? `code=${candidate.code}` : null,
    ].filter(Boolean);

    if (messageParts.length > 0) {
      return messageParts.join(' | ');
    }

    try {
      return JSON.stringify(candidate);
    } catch {
      return 'Unknown error object';
    }
  }
  return 'Unknown error';
}

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
  const [diagnostics, setDiagnostics] = useState<PushDiagnostics>({
    supported: isPushSupported(),
    standalone: isStandaloneDisplayMode(),
    permission: getNotificationPermission(),
    serviceWorkerController:
      typeof navigator !== 'undefined' && 'serviceWorker' in navigator
        ? Boolean(navigator.serviceWorker.controller)
        : false,
    registrationState: 'none',
    hasExistingSubscription: false,
    lastError: null,
    lastStep: 'idle',
    userAgent:
      typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
  });
  const touchTimeoutRef = useRef<number | null>(null);
  const currentStepRef = useRef('idle');

  const getRegistrationState = useCallback((registration?: ServiceWorkerRegistration | null) => {
    if (!registration) return 'none' as const;
    if (registration.installing) return 'installing' as const;
    if (registration.waiting) return 'waiting' as const;
    if (registration.active) return 'active' as const;
    return 'none' as const;
  }, []);

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
      setDiagnostics((prev) => ({
        ...prev,
        supported: false,
        standalone: isStandaloneDisplayMode(),
        permission: getNotificationPermission(),
        registrationState: 'none',
        lastError: null,
        lastStep: 'unsupported',
      }));
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
      const registration = await registerPushServiceWorker();
      const subscription = await getExistingPushSubscription();
      const permission = getNotificationPermission();
      const enabled = await syncSubscription(subscription);
      currentStepRef.current = 'refresh';
      setDiagnostics({
        supported: true,
        standalone: isStandaloneDisplayMode(),
        permission,
        serviceWorkerController:
          typeof navigator !== 'undefined' && 'serviceWorker' in navigator
            ? Boolean(navigator.serviceWorker.controller)
            : false,
        registrationState: getRegistrationState(registration),
        hasExistingSubscription: Boolean(subscription),
        lastError: null,
        lastStep: 'refresh',
        userAgent:
          typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      });
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
      setDiagnostics((prev) => ({
        ...prev,
        supported: true,
        standalone: isStandaloneDisplayMode(),
        permission: getNotificationPermission(),
        serviceWorkerController:
          typeof navigator !== 'undefined' && 'serviceWorker' in navigator
            ? Boolean(navigator.serviceWorker.controller)
            : false,
        lastError: describeUnknownError(error),
        lastStep: 'refresh-error',
      }));
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
    if (role !== 'picking' || !userId || !userName) {
      const error = 'Select a picker name before enabling alerts.';
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
      currentStepRef.current = 'permission-granted';
      setDiagnostics((prev) => ({
        ...prev,
        supported: true,
        standalone: isStandaloneDisplayMode(),
        permission,
        serviceWorkerController:
          typeof navigator !== 'undefined' && 'serviceWorker' in navigator
            ? Boolean(navigator.serviceWorker.controller)
            : false,
        lastError: null,
        lastStep: 'permission-granted',
      }));
      if (permission !== 'granted') {
        const error =
          permission === 'denied'
            ? 'Browser notifications are blocked for this device.'
            : 'Notification permission was not granted.';
        setState((prev) => ({
          ...prev,
          permission,
          enabled: false,
          loading: false,
          error,
        }));
        return { ok: false, error } satisfies PushActionResult;
      }

      const registration = await registerPushServiceWorker();
      currentStepRef.current = 'service-worker-registered';
      setDiagnostics((prev) => ({
        ...prev,
        registrationState: getRegistrationState(registration),
        serviceWorkerController:
          typeof navigator !== 'undefined' && 'serviceWorker' in navigator
            ? Boolean(navigator.serviceWorker.controller)
            : false,
        lastError: null,
        lastStep: 'service-worker-registered',
      }));
      if (!registration) {
        throw new Error('Service worker registration failed');
      }

      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        currentStepRef.current = 'subscribing';
        setDiagnostics((prev) => ({
          ...prev,
          registrationState: getRegistrationState(registration),
          lastError: null,
          lastStep: 'subscribing',
        }));
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidPublicKeyToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
        });
      }

      currentStepRef.current = 'saving-subscription';
      setDiagnostics((prev) => ({
        ...prev,
        registrationState: getRegistrationState(registration),
        hasExistingSubscription: Boolean(subscription),
        lastError: null,
        lastStep: 'saving-subscription',
      }));
      await syncSubscription(subscription);
      currentStepRef.current = 'enabled';
      setDiagnostics({
        supported: true,
        standalone: true,
        permission,
        serviceWorkerController:
          typeof navigator !== 'undefined' && 'serviceWorker' in navigator
            ? Boolean(navigator.serviceWorker.controller)
            : false,
        registrationState: getRegistrationState(registration),
        hasExistingSubscription: Boolean(subscription),
        lastError: null,
        lastStep: 'enabled',
        userAgent:
          typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      });
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
      const message = describeUnknownError(error);
      setDiagnostics((prev) => ({
        ...prev,
        supported: isPushSupported(),
        standalone: isStandaloneDisplayMode(),
        permission: getNotificationPermission(),
        serviceWorkerController:
          typeof navigator !== 'undefined' && 'serviceWorker' in navigator
            ? Boolean(navigator.serviceWorker.controller)
            : false,
        hasExistingSubscription: prev.hasExistingSubscription,
        lastError: message,
        lastStep: `${currentStepRef.current}-error`,
      }));
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
  }, [getRegistrationState, role, syncSubscription, userId, userName]);

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
    diagnostics,
    enable,
    disable,
    refresh: refreshState,
  };
}
