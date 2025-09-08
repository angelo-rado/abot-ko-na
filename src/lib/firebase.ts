import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'

// DO NOT import getMessaging here at top-level
import type { Messaging } from 'firebase/messaging'

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
}

const app = initializeApp(firebaseConfig)

const firestore = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
})

export const auth = getAuth(app)
export const provider = new GoogleAuthProvider()
export { firestore }
export { app }

// Patched: Safe Firebase Messaging init for iOS Safari/Chrome
export function getFirebaseMessaging(): Messaging | null {
  if (typeof window === 'undefined') {
    return null
  }

  const supportsPush =
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof Notification !== 'undefined'

  if (!supportsPush) {
    console.warn('Push notifications are not supported on this browser.')
    return null
  }

  try {
    const { getMessaging } = require('firebase/messaging')
    return getMessaging(app)
  } catch (err) {
    console.error('Failed to initialize Firebase Messaging', err)
    return null
  }
}
