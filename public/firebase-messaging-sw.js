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
  let data = {};
  try { data = event?.data?.json?.() ?? event?.data?.json() ?? {}; } catch {}

  const looksLikeFCM =
    data?.fcmOptions ||
    data?.fcmMessageId ||
    data?.from ||
    (data?.notification &&
      (data?.data?.firebaseMessaging || data?.data?.google || data?.data?.gcm_message_id));
  if (looksLikeFCM) return;

  const title = data?.notification?.title || data?.title || 'Abot Ko Na';
  const body = data?.notification?.body || data?.body || '📦 You have a new update!';
  const url = data?.data?.url || data?.data?.link || data?.notification?.click_action || '/';
  const tag = data?.data?.tag || 'general';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/android-chrome-192x192.png',
      badge: '/favicon-32x32.png',
      tag,
      renotify: false,
      data: { url },
    })
  );
});

// Click → focus existing tab or open new
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || '/';
  event.waitUntil((async () => {
    const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const desired = new URL(targetUrl, self.location.origin);
    for (const client of windowClients) {
      try {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin === desired.origin) {
          client.navigate(targetUrl);
          return client.focus();
        }
      } catch {}
    }
    if (clients.openWindow) return clients.openWindow(targetUrl);
    return null;
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
