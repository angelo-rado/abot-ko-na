'use client'

import {
  collection,
  collectionGroup,
  onSnapshot,
  orderBy,
  query,
  where,
  DocumentData,
  Query,
} from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import { firestore } from '@/lib/firebase'
import type { NotificationDoc } from './types'
import { useAuth } from '@/lib/useAuth'
import { db, type MirrorNotification } from '@/lib/db'
import Dexie from 'dexie'

type Scope = 'all' | { familyId: string }

/**
 * Online-first subscription with Dexie mirror for offline reads.
 * - Prefers collectionGroup('events') targeted to the current user.
 * - Falls back to /users/{uid}/notifications if needed.
 * - Mirrors snapshots into Dexie.notifications for offline display.
 */
export function useNotifications(scope: Scope) {
  const { user } = useAuth()
  const [items, setItems] = useState<NotificationDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ---- Bootstrap from Dexie immediately (offline-first feel)
  useEffect(() => {
    let closed = false
    ;(async () => {
      // family-scoped pull if scope is a family; otherwise latest across all
      const base = db.notifications.orderBy('createdAt').reverse()
      const cached = scope === 'all'
        ? await base.toArray()
        : await db.notifications
            .where('[familyId+createdAt]')
            .between(
              [(scope as any).familyId, Dexie.minKey],
              [(scope as any).familyId, Dexie.maxKey]
            )
            .reverse()
            .toArray()

      if (closed) return
      if (cached.length) {
        setItems(
          cached.map(mapMirrorToDoc)
        )
        setLoading(false) // we already have something to show
      }
    })()
    return () => { closed = true }
  }, [scope])

  // ---- Build Firestore query (online)
  const q = useMemo(() => {
    if (!user?.uid) return null

    try {
      let built: Query
      if (scope === 'all') {
        built = query(
          collectionGroup(firestore, 'events'),
          where('targets', 'array-contains', user.uid),
          orderBy('createdAt', 'desc')
        )
      } else {
        built = query(
          collectionGroup(firestore, 'events'),
          where('targets', 'array-contains', user.uid),
          where('familyId', '==', (scope as any).familyId),
          orderBy('createdAt', 'desc')
        )
      }
      return built
    } catch {
      // Fallback: user-owned notifications
      const base = collection(firestore, 'users', user.uid, 'notifications')
      return scope === 'all'
        ? query(base, orderBy('createdAt', 'desc'))
        : query(base, where('familyId', '==', (scope as any).familyId), orderBy('createdAt', 'desc'))
    }
  }, [scope, user?.uid])

  // ---- Live subscription → mirror to Dexie
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
      async (snap) => {
        const now = Date.now()
        const list: MirrorNotification[] = snap.docs.map((d) => {
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
          return mapDocToMirror(n, now)
        })

        // Mirror to Dexie (best-effort)
        try {
          await db.notifications.bulkPut(list)
        } catch {
          // ignore mirror errors
        }

        // Update UI
        setItems(list.map(mapMirrorToDoc))
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

// ---- helpers

function mapDocToMirror(n: NotificationDoc, now: number): MirrorNotification {
  return {
    id: n.id,
    title: n.title ?? null,
    type: n.type ?? 'system',
    body: n.body ?? null,
    createdAt: n.createdAt ?? null,
    reads: (n as any).reads ?? null,
    familyId: (n as any).familyId ?? (n as any).family?.id ?? null,
    familyName: (n as any).familyName ?? (n as any).family?.name ?? null,
    meta: (n as any).meta ?? null,
    _path: (n as any)._path ?? null,
    updatedAt: now,
  }
}

function mapMirrorToDoc(m: MirrorNotification): NotificationDoc {
  return {
    id: m.id,
    familyId: m.familyId ?? null,
    type: m.type ?? 'system',
    title: m.title ?? null,
    body: m.body ?? null,
    createdAt: m.createdAt ?? null,
    link: (m.meta as any)?.link ?? null,
    reads: m.reads ?? null,
    targets: null,
    meta: m.meta ?? null,
    _path: m._path ?? undefined,
  } as NotificationDoc
}
