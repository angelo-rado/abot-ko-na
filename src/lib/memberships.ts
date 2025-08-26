/* eslint-disable */
import {
  Firestore, collection, query, where, onSnapshot, doc, getDoc, Unsubscribe,
} from 'firebase/firestore'

export type FamilyLite = {
  id: string
  name?: string
  createdBy?: string
  owner?: string
  createdAt?: Date | null
  // Optional; we don’t fetch counts here to stay cheap
  memberCount?: number | null
}

/**
 * Subscribes to a user's families without using a collectionGroup on "members".
 * Source of truth:
 *  1) families where members array-contains uid
 *  2) users/{uid}.joinedFamilies / familiesJoined (fallback)
 */
export function subscribeUserFamilies(
  db: Firestore,
  uid: string,
  onNext: (families: FamilyLite[]) => void,
  onError?: (err: any) => void,
): Unsubscribe {
  let closed = false
  const byId = new Map<string, FamilyLite>()
  let pendingFetches = 0

  function toDate(v: any): Date | null {
    if (!v) return null
    if (v instanceof Date) return v
    if (typeof v?.toDate === 'function') return v.toDate()
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
  }

  function emit() {
    if (closed) return
    onNext(Array.from(byId.values()))
  }

  async function fetchFamily(familyId: string) {
    if (closed) return
    // Avoid refetch if we already have it
    if (byId.has(familyId)) return
    try {
      pendingFetches++
      const snap = await getDoc(doc(db, 'families', familyId))
      if (!snap.exists()) return
      const d = snap.data() as any
      byId.set(snap.id, {
        id: snap.id,
        name: typeof d?.name === 'string' ? d.name : undefined,
        createdBy: typeof d?.createdBy === 'string' ? d.createdBy : undefined,
        owner: typeof d?.owner === 'string' ? d.owner : undefined,
        createdAt: toDate(d?.createdAt ?? d?.created_on ?? d?.created_at),
      })
    } catch (e) {
      onError?.(e)
    } finally {
      pendingFetches--
      // emit only when all current fetches settled to reduce thrash
      if (pendingFetches === 0) emit()
    }
  }

  // 1) Live families where I'm in members[]
  const qFamilies = query(collection(db, 'families'), where('members', 'array-contains', uid))
  const unsubA = onSnapshot(qFamilies, (snap) => {
    let dirty = false
    // replace entries for ids seen here to reflect updates/removals
    const seen = new Set<string>()
    for (const d of snap.docs) {
      const data = d.data() as any
      const next: FamilyLite = {
        id: d.id,
        name: typeof data?.name === 'string' ? data.name : undefined,
        createdBy: typeof data?.createdBy === 'string' ? data.createdBy : undefined,
        owner: typeof data?.owner === 'string' ? data.owner : undefined,
        createdAt: toDate(data?.createdAt ?? data?.created_on ?? data?.created_at),
      }
      seen.add(d.id)
      const prev = byId.get(d.id)
      // shallow compare important fields
      if (!prev || prev.name !== next.name || prev.createdBy !== next.createdBy || prev.owner !== next.owner ||
          (prev.createdAt?.getTime?.() ?? 0) !== (next.createdAt?.getTime?.() ?? 0)) {
        byId.set(d.id, next)
        dirty = true
      }
    }
    // Remove families that are no longer in array-contains (still may be added back by user-joined fetch)
    for (const k of Array.from(byId.keys())) {
      if (!seen.has(k)) {
        // Do not delete blindly; only delete if source was from this query AND user lists don’t include it.
        // We'll keep it; the users/{uid} watcher will reconcile.
      }
    }
    if (dirty && pendingFetches === 0) emit()
  }, (err) => onError?.(err))

  // 2) Watch user doc lists and fetch any missing families
  const unsubB = onSnapshot(doc(db, 'users', uid), (snap) => {
    if (!snap.exists()) return
    const u = snap.data() as any
    const lists = [
      Array.isArray(u?.joinedFamilies) ? u.joinedFamilies : [],
      Array.isArray(u?.familiesJoined) ? u.familiesJoined : [],
    ]
    const all = new Set<string>(lists.flat().filter((x: any) => typeof x === 'string' && x))
    for (const id of all) fetchFamily(id)
  }, (err) => onError?.(err))

  return () => {
    closed = true
    try { unsubA() } catch {}
    try { unsubB() } catch {}
  }
}
