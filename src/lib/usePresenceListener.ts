import { useEffect, useState } from 'react'
import { onSnapshot, collection } from 'firebase/firestore'
import { firestore } from '@/lib/firebase'

export type PresenceData = {
  status: 'home' | 'away' | null
  statusSource?: 'geo' | 'manual' | null
  updatedAt?: any // Firestore Timestamp
}

export function usePresenceListener() {
  const [presenceMap, setPresenceMap] = useState<Record<string, PresenceData>>({})

  useEffect(() => {
    const unsub = onSnapshot(collection(firestore, 'presence'), (snapshot) => {
      const updates: Record<string, PresenceData> = {}
      snapshot.forEach((doc) => {
        updates[doc.id] = doc.data() as PresenceData
      })
      setPresenceMap(updates)
    })

    return () => unsub()
  }, [])

  return presenceMap
}
