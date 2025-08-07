import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { firestore } from './firebase'
import { User } from 'firebase/auth'

export async function ensureUserPresence(user: User) {
  const userRef = doc(firestore, 'users', user.uid)
  const userSnap = await getDoc(userRef)

  if (!userSnap.exists()) {
    await setDoc(userRef, {
      name: user.displayName || '',
      email: user.email || '',
      photoURL: user.photoURL || '',
      status: 'away',
      statusSource: 'manual',
      updatedAt: serverTimestamp(),
    })
  } else {
    const data = userSnap.data()
    if (!data.status || !data.updatedAt || !data.statusSource) {
      await updateDoc(userRef, {
        status: 'away',
        statusSource: 'manual',
        updatedAt: serverTimestamp(),
      })
    }
  }
}

export async function saveHomeLocation(userId: string, lat: number, lng: number) {
  const userRef = doc(firestore, 'users', userId)
  await setDoc(
    userRef,
    {
      homeLocation: { lat, lng },
    },
    { merge: true }
  )
}

export async function updateUserPresenceStatus(
  userId: string,
  status: 'home' | 'away',
  source: 'manual' | 'geo',
  displayName?: string,
  photoURL?: string
) {
  const ref = doc(firestore, 'presences', userId)
  await setDoc(
    ref,
    {
      name: displayName || '',
      photoURL: photoURL || '',
      status,
      statusSource: source,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  )
}
