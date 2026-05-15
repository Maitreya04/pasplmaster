const DEVICE_ID_KEY = 'paspl_push_device_id';

export interface BrowserPushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') return false;

  const mediaStandalone =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  const navigatorStandalone =
    'standalone' in navigator &&
    typeof navigator.standalone === 'boolean' &&
    navigator.standalone;

  return Boolean(mediaStandalone || navigatorStandalone);
}

export async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

export function getPushDeviceId(): string {
  if (typeof window === 'undefined') return 'server';
  const existing = window.localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const nextId = window.crypto?.randomUUID?.() ?? `device-${Date.now()}`;
  window.localStorage.setItem(DEVICE_ID_KEY, nextId);
  return nextId;
}

export function getNotificationPermission(): NotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'default';
  }
  return Notification.permission;
}

export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  const registration = await registerPushServiceWorker();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

export function parseSubscriptionKeys(
  subscription: PushSubscription,
): BrowserPushSubscriptionKeys {
  const rawP256dh = subscription.getKey('p256dh');
  const rawAuth = subscription.getKey('auth');
  if (!rawP256dh || !rawAuth) {
    throw new Error('Push subscription keys are missing');
  }

  return {
    endpoint: subscription.endpoint,
    p256dh: encodeBase64(rawP256dh),
    auth: encodeBase64(rawAuth),
  };
}

export function vapidPublicKeyToUint8Array(key: string): Uint8Array {
  const padding = '='.repeat((4 - (key.length % 4)) % 4);
  const base64 = (key + padding).replace(/-/g, '+').replace(/_/g, '/');
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function encodeBase64(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return window.btoa(binary);
}
