/* eslint-disable no-undef */

// Firebase SDK imports (compat) — must load before Workbox
importScripts('https://www.gstatic.com/firebasejs/12.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.0.0/firebase-messaging-compat.js');

// Init Firebase in SW (only keys needed for messaging)
firebase.initializeApp({
  apiKey: "AIzaSyCBDitj3mvJf_wy6g2fw4s3XsYrwnhZA8Y",
  authDomain: "abot-ko-na.firebaseapp.com",
  projectId: "abot-ko-na",
  storageBucket: "abot-ko-na.appspot.com",
  messagingSenderId: "882171741289",
  appId: "1:882171741289:web:f7b8dc68a88bdae6a5cef8",
});

const messaging = firebase.messaging();

/**
 * Background messages from FCM
 * If payload contains `notification`, the browser will auto-display it.
 * We only call showNotification for DATA-ONLY payloads to avoid duplicates.
 */
messaging.onBackgroundMessage((payload) => {
  // Guard: let the browser handle notification-only messages (prevents double)
  if (payload?.notification) return;

  const title = payload?.data?.title || 'Abot Ko Na';
  const body  = payload?.data?.body  || '📦 You have a new update!';
  const url   = payload?.data?.url   || '/';

  // Optional: collapse updates of the same type so they replace instead of stacking
  const tag =
    payload?.data?.tag ||
    [payload?.data?.type || 'general', payload?.data?.familyId, payload?.data?.deliveryId]
      .filter(Boolean)
      .join(':');

  self.registration.showNotification(title, {
    body,
    icon: '/android-chrome-192x192.png',
    badge: '/favicon-32x32.png',
    data: { url },
    tag,
    renotify: false,
  });
});

// Now load Workbox after Firebase
importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.5.4/workbox-sw.js');

// Workbox setup
self.__WB_MANIFEST;
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
workbox.core.clientsClaim();

// Cache Firestore reads conservatively
workbox.routing.registerRoute(
  /^https:\/\/firestore\.googleapis\.com\/.*/i,
  new workbox.strategies.NetworkFirst({
    cacheName: 'firebase-firestore',
    plugins: [
      new workbox.expiration.ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 24 * 60 * 60,
      }),
      new workbox.cacheableResponse.CacheableResponsePlugin({
        statuses: [0, 200],
      }),
    ],
  })
);

/**
 * Optional non-FCM web push fallback
 * If you don't use any other push provider, you can delete this handler.
 * Kept here but guarded to avoid handling FCM-delivered payloads twice.
 */
self.addEventListener('push', (event) => {
  // Try to parse; if it looks like an FCM payload, bail (FCM SDK already handled it)
  let data = {};
  try { data = event.data?.json?.() ?? event.data?.json() ?? {}; } catch {}

  // Heuristic: common FCM markers in raw payloads
  const looksLikeFCM =
    data?.fcmOptions ||
    data?.fcmMessageId ||
    data?.from ||
    data?.notification && (data?.data?.firebaseMessaging || data?.data?.google || data?.data?.gcm_message_id);

  if (looksLikeFCM) return;

  const title = data?.notification?.title || data?.title || 'Abot Ko Na';
  const body  = data?.notification?.body  || data?.body  || '📦 You have a new update!';
  const url   = data?.data?.url || data?.notification?.click_action || '/';
  const tag   = data?.data?.tag || 'general';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/android-chrome-192x192.png',
      badge: '/favicon-32x32.png',
      data: { url },
      tag,
      renotify: false,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || '/';

  event.waitUntil(
    (async () => {
      const windowClients = await clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      const desired = new URL(targetUrl, self.location.origin);

      for (const client of windowClients) {
        try {
          const clientUrl = new URL(client.url);
          if (clientUrl.origin === desired.origin) {
            return client.focus();
          }
        } catch {
          // ignore; fallback to openWindow
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })()
  );
});
