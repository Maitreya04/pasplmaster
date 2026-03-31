self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = {
      title: 'PASPL Master',
      body: event.data.text(),
      url: '/picking',
    };
  }

  const title = payload.title || 'PASPL Master';
  const options = {
    body: payload.body || 'A new picking order is ready.',
    tag: payload.tag || 'picker-alert',
    data: {
      url: payload.url || '/picking',
      orderId: payload.orderId || null,
      type: payload.type || null,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl =
    (event.notification.data && event.notification.data.url) || '/picking';

  event.waitUntil((async () => {
    const url = new URL(targetUrl, self.location.origin).toString();
    const windowClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    for (const client of windowClients) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) {
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
