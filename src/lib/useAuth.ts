import { useEffect, useState } from 'react'
import { auth, firestore } from './firebase'
import { User as FirebaseUser, onAuthStateChanged } from 'firebase/auth'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { ensureUserPresence } from './firestoreUtils'

type ExtendedUser = {
  uid: string
  email?: string | null
  name?: string
  photoURL?: string
  familyId?: string | null
}

export function useAuth() {
  const [user, setUser] = useState<ExtendedUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let unsubUserDoc: (() => void) | null = null

    const unsubAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const userRef = doc(firestore, 'users', firebaseUser.uid)

        // Ensure Firestore user profile is created/updated
        await setDoc(
          userRef,
          {
            email: firebaseUser.email,
            name: firebaseUser.displayName ?? '',
            photoURL: firebaseUser.photoURL ?? '',
            familyId: null,
          },
          { merge: true }
        )

        // Ensure presence document exists
        await ensureUserPresence(firebaseUser)

        // Listen to user's Firestore document
        unsubUserDoc = onSnapshot(userRef, (docSnap) => {
          const data = docSnap.data()
          if (data) {
            setUser({
              uid: firebaseUser.uid,
              email: data.email ?? firebaseUser.email,
              name: data.name ?? firebaseUser.displayName ?? '',
              photoURL: data.photoURL ?? firebaseUser.photoURL ?? '',
              familyId: data.familyId ?? null,
            })
          } else {
            setUser({
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              name: firebaseUser.displayName ?? '',
              photoURL: firebaseUser.photoURL ?? '',
              familyId: null,
            })
          }
          setLoading(false)
        })
      } else {
        setUser(null)
        setLoading(false)
      }
    })

    return () => {
      unsubAuth()
      if (unsubUserDoc) unsubUserDoc()
    }
  }, [])

  return { user, loading }
}
