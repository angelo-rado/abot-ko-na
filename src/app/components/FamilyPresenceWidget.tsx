'use client'

import React, { useEffect, useState } from 'react'
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  Timestamp,
  QueryDocumentSnapshot,
  DocumentData,
} from 'firebase/firestore'
import { firestore } from '@/lib/firebase'

export type MemberPresence = {
  uid: string
  name: string
  photoURL?: string | null
  status: 'home' | 'away' | null
  statusSource?: 'geo' | 'manual' | null
  updatedAt?: number | null // milliseconds since epoch
}

type FamilyPresenceWidgetProps = {
  familyId: string
  render?: (members: MemberPresence[], loading: boolean) => React.ReactNode
}

function toMillis(raw: any): number | null {
  if (!raw) return null
  try {
    if (raw instanceof Timestamp) return raw.toMillis()
    if (raw?.toDate) return raw.toDate().getTime()
    if (typeof raw?.seconds === 'number') return raw.seconds * 1000
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
    if (typeof raw === 'string') {
      const t = Date.parse(raw)
      return Number.isFinite(t) ? t : null
    }
  } catch {}
  return null
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
          const rows = await Promise.all(
            snapshot.docs.map(async (memberSnap: QueryDocumentSnapshot<DocumentData>) => {
              const m = memberSnap.data() as Record<string, any>

              // Support docId==uid (your structure) and arbitrary id + m.uid
              const uid: string = (typeof m?.uid === 'string' && m.uid) || memberSnap.id

              // Optional user profile enrich (name/photo fallbacks)
              let userData: Record<string, any> | null = null
              try {
                const userSnap = await getDoc(doc(firestore, 'users', uid))
                userData = userSnap.exists() ? (userSnap.data() as Record<string, any>) : null
              } catch (e) {
                // soft-fail
              }

              // Effective statusSource for display:
              // if member.autoPresence === true, prefer 'geo' visually
              const docStatusSource = (m?.statusSource as 'geo' | 'manual' | undefined) ?? null
              const autoPresence = m?.autoPresence === true
              const effectiveSource: 'geo' | 'manual' | null =
                autoPresence ? 'geo' : (docStatusSource ?? null)

              const updatedAt =
                toMillis(m?.updatedAt) ??
                toMillis(m?.lastUpdated) ??
                null

              const mp: MemberPresence = {
                uid,
                name:
                  (userData?.displayName as string) ??
                  (userData?.name as string) ??
                  (m?.name as string) ??
                  'Unknown',
                photoURL:
                  (userData?.photoURL as string | null) ??
                  (m?.photoURL as string | null) ??
                  null,
                status: (m?.status as 'home' | 'away') ?? null,
                statusSource: effectiveSource,
                updatedAt,
              }
              return mp
            })
          )

          // Example sort: home first, then by name
          rows.sort((a, b) => {
            const ah = a.status === 'home' ? 0 : 1
            const bh = b.status === 'home' ? 0 : 1
            if (ah !== bh) return ah - bh
            return (a.name || '').localeCompare(b.name || '')
          })

          setMembers(rows)
        } catch (err) {
          console.error('FamilyPresenceWidget members snapshot parse error:', err)
          setMembers([])
        } finally {
          setLoading(false)
        }
      },
      (err) => {
        console.error('FamilyPresenceWidget members snapshot error:', err)
        setMembers([])
        setLoading(false)
      }
    )

    return () => unsub()
  }, [familyId])

  if (render) return render(members, loading)
  return null
}
