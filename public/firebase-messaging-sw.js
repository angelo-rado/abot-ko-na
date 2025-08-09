/* eslint-disable no-undef */
importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.5.4/workbox-sw.js');

// Firebase SDK imports
importScripts('https://www.gstatic.com/firebasejs/9.21.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.21.0/firebase-messaging-compat.js');

// Initialize Firebase app in SW — replace with your actual config
firebase.initializeApp({
  apiKey: 'AIzaSyCBDitj3mvJf_wy6g2fw4s3XsYrwnhZA8Y',
  authDomain: 'abot-ko-na.firebaseapp.com',
  projectId: 'abot-ko-na',
  messagingSenderId: '882171741289',
  appId: '1:882171741289:web:f7b8dc68a88bdae6a5cef8',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  const notificationTitle = payload.notification?.title || 'Abot Ko Na';
  const notificationOptions = {
    body: payload.notification?.body || '📦 You have a new update!',
    icon: '/android-chrome-192x192.png',
    badge: '/favicon-32x32.png',
    data: {
      url: payload.notification?.click_action || '/',
    },
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Workbox setup
self.__WB_MANIFEST;

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

workbox.core.clientsClaim();

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

// Optional: keep your existing push and notificationclick handlers
self.addEventListener('push', function (event) {
  const data = event.data?.json?.() ?? {};

  const title = data.notification?.title ?? 'Abot Ko Na';
  const options = {
    body: data.notification?.body ?? '📦 You have a new update!',
    icon: '/android-chrome-192x192.png',
    badge: '/favicon-32x32.png',
    data: {
      url: data.notification?.click_action || '/',
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === '/' && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});
