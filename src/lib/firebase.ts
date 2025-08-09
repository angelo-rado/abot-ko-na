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

// Initialize Firestore as before
const firestore = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
})

export const auth = getAuth(app)
export const provider = new GoogleAuthProvider()
export { firestore }

// Export app for client to initialize messaging lazily
export { app }

// Provide a function to get messaging ONLY on client
export function getFirebaseMessaging(): Messaging | null {
  if (typeof window === 'undefined') {
    // Server side - no messaging
    return null
  }
  // Import getMessaging dynamically so it only runs on client
  const { getMessaging } = require('firebase/messaging')
  return getMessaging(app)
}
