/* eslint-disable no-undef */
importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.5.4/workbox-sw.js')

// ✅ Required placeholder for precaching
self.__WB_MANIFEST

// Take control immediately
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

workbox.core.clientsClaim()

// ✅ Runtime caching for Firestore API
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
)

// ✅ Background push notification handler
self.addEventListener('push', function (event) {
  const data = event.data?.json?.() ?? {}

  const title = data.notification?.title ?? 'Abot Ko Na'
  const options = {
    body: data.notification?.body ?? '📦 You have a new update!',
    icon: '/android-chrome-192x192.png',
    badge: '/favicon-32x32.png',
    data: {
      url: data.notification?.click_action || '/',
    },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

// ✅ Click handler for notifications
self.addEventListener('notificationclick', function (event) {
  event.notification.close()

  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === '/' && 'focus' in client) {
          return client.focus()
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/')
      }
    })
  )
})
