'use client'

import React, { useEffect, useState } from 'react'
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  Timestamp,
} from 'firebase/firestore'
import { firestore } from '@/lib/firebase'

export type MemberPresence = {
  uid: string
  name: string
  photoURL?: string
  status: 'home' | 'away' | null
  statusSource?: 'geo' | 'manual' | null
  updatedAt?: number | null // milliseconds since epoch
}

type FamilyPresenceWidgetProps = {
  familyId: string
  render?: (members: MemberPresence[], loading: boolean) => React.ReactNode
}

export default function FamilyPresenceWidget({
  familyId,
  render,
}: FamilyPresenceWidgetProps) {
  const [members, setMembers] = useState<MemberPresence[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!familyId) return

    setLoading(true)

    const membersRef = collection(firestore, 'families', familyId, 'members')
    const unsub = onSnapshot(
      membersRef,
      async (snapshot) => {
        try {
          const results: MemberPresence[] = await Promise.all(
            snapshot.docs.map(async (docSnap) => {
              const memberData = docSnap.data() as Record<string, any>

              // fetch corresponding user profile
              let userData: Record<string, any> | null = null
              try {
                const userRef = doc(firestore, 'users', docSnap.id)
                const userSnap = await getDoc(userRef)
                userData = userSnap.exists() ? (userSnap.data() as Record<string, any>) : null
              } catch (err) {
                console.warn('Failed to load user profile for', docSnap.id, err)
              }

              // Normalize updatedAt to milliseconds if possible
              const rawUpdated = memberData.updatedAt
              let updatedAt: number | null = null
              if (rawUpdated instanceof Timestamp) {
                updatedAt = rawUpdated.toMillis()
              } else if (typeof rawUpdated === 'number') {
                updatedAt = rawUpdated
              } else {
                updatedAt = null
              }

              const mp: MemberPresence = {
                uid: docSnap.id,
                name: userData?.name ?? (memberData.name ?? 'Unknown'),
                photoURL: userData?.photoURL ?? memberData.photoURL,
                status: (memberData.status as 'home' | 'away') ?? null,
                statusSource: (memberData.statusSource as 'geo' | 'manual') ?? null,
                updatedAt,
              }

              return mp
            })
          )

          // Optional: stable sort by name
          results.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))

          setMembers(results)
        } catch (err) {
          console.error('Error processing members snapshot:', err)
          setMembers([])
        } finally {
          setLoading(false)
        }
      },
      (err) => {
        console.error('Family members snapshot error:', err)
        setMembers([])
        setLoading(false)
      }
    )

    return () => unsub()
  }, [familyId])

  if (render) return render(members, loading)

  return null
}

