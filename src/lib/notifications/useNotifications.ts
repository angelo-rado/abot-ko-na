// src/lib/notifications/useNotifications.ts
'use client'

import {
  collection,
  collectionGroup,
  onSnapshot,
  orderBy,
  query,
  where,
  DocumentData,
} from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import { firestore } from '@/lib/firebase'
import { NotificationDoc } from './types'
import { useAuth } from '@/lib/useAuth'

type Scope = 'all' | { familyId: string }

export function useNotifications(scope: Scope) {
  const { user } = useAuth()
  const [items, setItems] = useState<NotificationDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const q = useMemo(() => {
    if (!user?.uid) return null

    try {
      // Preferred: collectionGroup('events') anywhere, targeted to the user
      if (scope === 'all') {
        return query(
          collectionGroup(firestore, 'events'),
          where('targets', 'array-contains', user.uid),
          orderBy('createdAt', 'desc')
        )
      } else {
        return query(
          collectionGroup(firestore, 'events'),
          where('targets', 'array-contains', user.uid),
          where('familyId', '==', scope.familyId),
          orderBy('createdAt', 'desc')
        )
      }
    } catch {
      // Fallback: user-owned notifications
      const base = collection(firestore, 'users', user.uid, 'notifications')
      if (scope === 'all') {
        return query(base, orderBy('createdAt', 'desc'))
      } else {
        return query(base, where('familyId', '==', scope.familyId), orderBy('createdAt', 'desc'))
      }
    }
  }, [scope, user?.uid])

  useEffect(() => {
    if (!q) {
      setItems([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => {
          const data = d.data() as DocumentData
          const n: NotificationDoc = {
            id: d.id,
            familyId: data.familyId ?? null,
            type: data.type ?? 'system',
            title: data.title ?? null,
            body: data.body ?? null,
            createdAt: data.createdAt ?? null,
            link: data.link ?? null,
            reads: data.reads ?? null,
            targets: data.targets ?? null,
            meta: data.meta ?? null,
            _path: d.ref.path,
          }
        return n
        })
        setItems(list)
        setLoading(false)
      },
      (err) => {
        setError(err?.message ?? 'Failed to load notifications')
        setItems([])
        setLoading(false)
      }
    )
    return () => unsub()
  }, [q])

  return { items, loading, error }
}
