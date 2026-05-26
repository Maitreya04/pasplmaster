/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null | undefined }>;
};

precacheAndRoute(self.__WB_MANIFEST);

// Cache JS chunks not in precache (admin, billing, sales pages) on first use.
registerRoute(
  ({ url }) => url.pathname.startsWith('/assets/') && url.pathname.endsWith('.js'),
  new StaleWhileRevalidate({
    cacheName: 'paspl-js-runtime',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
      }),
    ],
  }),
);

// Cache CSS chunks on first use.
registerRoute(
  ({ url }) => url.pathname.startsWith('/assets/') && url.pathname.endsWith('.css'),
  new StaleWhileRevalidate({
    cacheName: 'paspl-css-runtime',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 60 * 60 * 24 * 30,
      }),
    ],
  }),
);

registerRoute(
  ({ url }) => url.pathname.endsWith('.wasm'),
  new CacheFirst({
    cacheName: 'scanner-wasm',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 32,
        maxAgeSeconds: 60 * 60 * 24 * 365,
      }),
    ],
  }),
);

registerRoute(
  ({ request }) => request.destination === 'font',
  new CacheFirst({
    cacheName: 'paspl-fonts',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 16,
        maxAgeSeconds: 60 * 60 * 24 * 365,
      }),
    ],
  }),
);

self.addEventListener('push', (event: PushEvent) => {
  if (!event.data) return;

  let payload: Record<string, unknown> = {};
  try {
    payload = event.data.json() as Record<string, unknown>;
  } catch {
    payload = {
      title: 'PASPL Master',
      body: event.data.text(),
      url: '/picking',
    };
  }

  const title = typeof payload.title === 'string' ? payload.title : 'PASPL Master';
  const body =
    typeof payload.body === 'string' ? payload.body : 'A new picking order is ready.';
  const tag = typeof payload.tag === 'string' ? payload.tag : 'picker-alert';
  const url = typeof payload.url === 'string' ? payload.url : '/picking';
  const orderId = payload.orderId ?? null;
  const type = payload.type ?? null;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      silent: false,
      vibrate: [400, 80, 400, 80, 400, 80, 400],
      data: { url, orderId, type },
    } as NotificationOptions),
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const targetUrl =
    event.notification.data && typeof event.notification.data.url === 'string'
      ? event.notification.data.url
      : '/picking';

  event.waitUntil((async () => {
    const url = new URL(targetUrl, self.location.origin).toString();
    const windowClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    for (const client of windowClients) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client && typeof client.navigate === 'function') {
          await client.navigate(url);
        }
        return;
      }
    }

    if (self.clients.openWindow) {
      await self.clients.openWindow(url);
    }
  })());
});

export {};
