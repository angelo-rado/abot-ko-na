/* eslint-disable no-undef */

// --- Firebase (compat) must load before any other SW libs ---
importScripts('https://www.gstatic.com/firebasejs/12.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.0.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCBDitj3mvJf_wy6g2fw4s3XsYrwnhZA8Y',
  authDomain: 'abot-ko-na.firebaseapp.com',
  projectId: 'abot-ko-na',
  storageBucket: 'abot-ko-na.appspot.com',
  messagingSenderId: '882171741289',
  appId: '1:882171741289:web:f7b8dc68a88bdae6a5cef8',
});

const messaging = firebase.messaging();

// Small helper: normalize URL/Link from various payload shapes
function resolveLink(payload) {
  // prefer explicit FCM WebPush link if present
  const fcmLink = payload?.fcmOptions?.link;
  const d = payload?.data || {};
  return fcmLink || d.url || d.link || d.click_action || '/';
}

/**
 * Background handler
 * - If a `notification` block exists, Chrome will show it automatically.
 * - For DATA-ONLY payloads, we render a notification here.
 */
messaging.onBackgroundMessage((payload) => {
  // If it's a notification payload, let the browser handle it to avoid dupes.
  if (payload?.notification) return;

  const d = payload?.data || {};
  const title = d.title || 'Abot Ko Na';
  const body = d.body || '📦 You have a new update!';
  const url = resolveLink(payload);
  const tag =
    d.tag ||
    [d.type || 'general', d.familyId, d.deliveryId].filter(Boolean).join(':') ||
    'general';

  // Show a notification for data-only messages
  self.registration.showNotification(title, {
    body,
    icon: '/android-chrome-192x192.png',
    badge: '/favicon-32x32.png',
    tag,
    renotify: false,
    data: { url },
  });
});

// -------------------------------------------------------------
// Optional: fallback push handler (for non-FCM web push sources)
// -------------------------------------------------------------
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    // ignore malformed payloads
  }

  // FCM may nest custom keys under `data` or mix levels
  const d = payload.data || payload;

  const title = d.title || 'Abot Ko Na';
  const body = d.body || '';
  const tag = d.tag || 'abot';
  const url = d.url || '/';

  const icon = d.icon || '/android-chrome-192x192.png';
  const badge = d.badge || '/favicon-32x32.png';

  const options = {
    body,
    tag,
    renotify: false,
    icon,
    badge,
    data: { url },
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Click → focus existing tab or open new
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification && event.notification.data && event.notification.data.url) || '/';

  event.waitUntil((async () => {
    const targetUrl = new URL(url, self.location.origin).toString();
    const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });

    // Focus an open tab with our app if it exists
    for (const client of clientList) {
      try {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin === self.location.origin) {
          await client.focus();
          // Optionally, navigate if it's a different path
          if ('navigate' in client && clientUrl.toString() !== targetUrl) {
            await client.navigate(targetUrl);
          }
          return;
        }
      } catch (_) { /* ignore */ }
    }

    // Otherwise open a new tab
    if (clients.openWindow) {
      await clients.openWindow(targetUrl);
    }
  })());
});

// -------------------- Workbox (guarded) ----------------------
try {
  importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.5.4/workbox-sw.js');
  // Only run if Workbox loaded correctly
  if (self.workbox) {
    // Avoid throwing if __WB_MANIFEST is not injected
    // self.__WB_MANIFEST;
    self.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
    });
    self.workbox.core.clientsClaim();

    // Firestore requests: NetworkOnly to avoid Cache.put errors on opaque streams
    self.workbox.routing.registerRoute(
      ({ url }) => url.origin === 'https://firestore.googleapis.com',
      new self.workbox.strategies.NetworkOnly()
    );
  }
} catch (e) {
  // No-op: SW still functions for FCM
}
