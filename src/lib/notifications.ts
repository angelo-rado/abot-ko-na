// src/lib/notifications.ts

/**
 * Request notification permission from the user.
 * Returns true if permission is granted, false otherwise.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false

  if (Notification.permission === 'granted') {
    return true
  }

  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission()
    return permission === 'granted'
  }

  return false
}

/**
 * Show a notification about deliveries arriving soon.
 * Call this only after permission is granted.
 */
export function notifyDeliveriesDue(count: number) {
  if (!('Notification' in window)) return
  if (Notification.permission !== 'granted') return

  const title = 'Abot Ko Na'
  const options: NotificationOptions = {
    body: `You have ${count} delivery${count > 1 ? 'ies' : ''} arriving soon! 📦`,
    icon: '/android-chrome-192x192.png',
    badge: '/favicon-32x32.png',
    // You can add data or actions here if you want
  }

  new Notification(title, options)
}
