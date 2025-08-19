import { getApp } from 'firebase/app'
import { getMessaging, getToken, isSupported } from 'firebase/messaging'
import { doc, setDoc, updateDoc, arrayUnion } from 'firebase/firestore'
import { firestore } from '@/lib/firebase'

const VAPID_KEY = 'BGh3Isyh15lAQ_GJ19Xwluh4atLY5QbbBt3tl0bnpUt6OkTNonKcm7IwlrmbI_E--IkvB__NYXV6xjbvGIE87iI'

export async function enableNotifications(userId: string): Promise<string | null> {
  if (!(await isSupported())) return null
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js')
  const messaging = getMessaging(getApp())

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return null

  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration,
  })
  if (!token) return null

  const userRef = doc(firestore, 'users', userId)
  try {
    await updateDoc(userRef, { fcmTokens: arrayUnion(token) })
  } catch {
    await setDoc(userRef, { fcmTokens: [token] }, { merge: true })
  }
  return token
}
