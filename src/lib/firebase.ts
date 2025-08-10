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
  apiKey: 'AIzaSyCBDitj3mvJf_wy6g2fw4s3XsYrwnhZA8Y',
  authDomain: 'abot-ko-na.firebaseapp.com',
  projectId: 'abot-ko-na',
  storageBucket: 'abot-ko-na.appspot.com',
  messagingSenderId: '882171741289',
  appId: '1:882171741289:web:f7b8dc68a88bdae6a5cef8',
  measurementId: 'G-EYEF7WK99V',
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
