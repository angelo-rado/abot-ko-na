// lib/useAuth.ts
import { useEffect, useState } from 'react'
import { auth, firestore } from './firebase'
import { User as FirebaseUser, onAuthStateChanged } from 'firebase/auth'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { ensureUserPresence } from './firestoreUtils'

export type ExtendedUser = {
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

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        // No user logged in
        setUser(null)
        setLoading(false)
        if (unsubUserDoc) unsubUserDoc()
        return
      }

      const userRef = doc(firestore, 'users', firebaseUser.uid)

      try {
        // Upsert user data to Firestore
        await setDoc(userRef, {
          email: firebaseUser.email ?? null,
          name: firebaseUser.displayName ?? '',
          photoURL: firebaseUser.photoURL ?? '',
          familyId: null,
        }, { merge: true })

        // Ensure presence doc
        await ensureUserPresence(firebaseUser)
      } catch (err) {
        console.error('[useAuth] Failed to write user profile or ensure presence:', err)
      }

      // Subscribe to user doc
      unsubUserDoc = onSnapshot(userRef, (snap) => {
        if (snap.exists()) {
          const data = snap.data()
          setUser({
            uid: firebaseUser.uid,
            email: data.email ?? firebaseUser.email,
            name: data.name ?? firebaseUser.displayName ?? '',
            photoURL: data.photoURL ?? firebaseUser.photoURL ?? '',
            familyId: data.familyId ?? null,
          })
        } else {
          // Fallback if user doc missing
          setUser({
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            name: firebaseUser.displayName ?? '',
            photoURL: firebaseUser.photoURL ?? '',
            familyId: null,
          })
        }

        setLoading(false)
      }, (err) => {
        console.error('[useAuth] Failed to subscribe to user doc:', err)
        setLoading(false)
      })
    })

    return () => {
      unsubscribe()
      if (unsubUserDoc) unsubUserDoc()
    }
  }, [])

  return { user, loading }
}
