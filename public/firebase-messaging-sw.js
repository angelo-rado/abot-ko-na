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

// Background messages from FCM
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] background message', payload);
  const title =
    payload.notification?.title ||
    payload.data?.title ||
    'Abot Ko Na';

  const body =
    payload.notification?.body ||
    payload.data?.body ||
    '📦 You have a new update!';

  const url =
    payload.data?.url ||
    payload.notification?.click_action ||
    '/';

  self.registration.showNotification(title, {
    body,
    icon: '/android-chrome-192x192.png',
    badge: '/favicon-32x32.png',
    data: { url },
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

// Optional push and notificationclick handlers (non-FCM web push, or extra safety)
self.addEventListener('push', (event) => {
  // Some providers send data-only pushes (no FCM SDK), handle gracefully
  const data = event.data?.json() ?? {}; // ✅ fix: call .json()
  const title = data.notification?.title || data.title || 'Abot Ko Na';
  const body = data.notification?.body || data.body || '📦 You have a new update!';
  const url =
    data.data?.url ||
    data.notification?.click_action ||
    '/';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/android-chrome-192x192.png',
      badge: '/favicon-32x32.png',
      data: { url },
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

      // Focus an existing tab with same origin and (if present) same path
      for (const client of windowClients) {
        try {
          const clientUrl = new URL(client.url);
          const desired = new URL(targetUrl, self.location.origin);
          if (clientUrl.origin === desired.origin) {
            // If already on the desired path, just focus; otherwise open a new one
            if (clientUrl.pathname === desired.pathname) {
              return client.focus();
            }
          }
        } catch {
          // ignore URL parsing errors, fallback to openWindow below
        }
      }

      // Otherwise open a new window
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })()
  );
});
