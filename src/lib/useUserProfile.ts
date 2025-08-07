import { useEffect, useState } from 'react'
import { doc, getDoc, onSnapshot } from 'firebase/firestore'
import { firestore } from './firebase'
import { useAuth } from './useAuth'

type UserProfile = {
  familyId?: string
  role?: 'owner' | 'inviter' | 'member'
}

export function useUserProfile() {
  const { user } = useAuth()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) {
      setProfile(null)
      setLoading(false)
      return
    }

    const ref = doc(firestore, 'users', user.uid)

    const unsubscribe = onSnapshot(ref, (docSnap) => {
      if (docSnap.exists()) {
        setProfile(docSnap.data() as UserProfile)
      } else {
        setProfile({})
      }
      setLoading(false)
    })

    return () => unsubscribe()
  }, [user])

  return { profile, loading }
}
