import {
  Firestore,
  collection,
  onSnapshot,
  query,
  where,
  getDocs,
  doc,
  getDoc,
} from 'firebase/firestore'

export type FamilyLite = {
  id: string
  name?: string
  createdBy?: string
  owner?: string
  createdAt?: Date | null
  memberCount?: number
}

function toDate(v: any): Date | null {
  if (!v) return null
  if (v instanceof Date) return v
  if (typeof v?.toDate === 'function') return v.toDate()
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

/**
 * Subscribe to families the user belongs to.
 * We only use `families` with `members` array-contains for stability.
 * (No collectionGroup reads here — avoids permission edge-cases.)
 */
export function subscribeUserFamilies(
  db: Firestore,
  uid: string,
  onRows: (rows: FamilyLite[]) => void,
  onError?: (err: any) => void
) {
  // primary query: membership via array
  const qFamilies = query(collection(db, 'families'), where('members', 'array-contains', uid))

  const unsubPrimary = onSnapshot(
    qFamilies,
    async (snap) => {
      try {
        const rows = await Promise.all(
          snap.docs.map(async (d) => {
            const data = d.data() as any
            // best-effort member count
            let memberCount: number | undefined = undefined
            try {
              const memSnap = await getDocs(collection(db, 'families', d.id, 'members'))
              memberCount = memSnap.size
            } catch {}

            return {
              id: d.id,
              name: typeof data?.name === 'string' ? data.name : undefined,
              createdBy: typeof data?.createdBy === 'string' ? data.createdBy : undefined,
              owner: typeof data?.owner === 'string' ? data.owner : undefined,
              createdAt: toDate(data?.createdAt ?? data?.created_on ?? data?.created_at),
              memberCount,
            } as FamilyLite
          })
        )

        // Fallback: include any families I own that somehow don’t (yet) have the members array
        // (rare, but can happen during first writes). We fetch them once, merge, and de-dupe.
        const owned = await getDocs(query(collection(db, 'families'), where('createdBy', '==', uid)))
        const ownedRows: FamilyLite[] = owned.docs.map((d) => {
          const data = d.data() as any
          return {
            id: d.id,
            name: typeof data?.name === 'string' ? data.name : undefined,
            createdBy: typeof data?.createdBy === 'string' ? data.createdBy : undefined,
            owner: typeof data?.owner === 'string' ? data.owner : undefined,
            createdAt: toDate(data?.createdAt ?? data?.created_on ?? data?.created_at),
          }
        })

        const map = new Map<string, FamilyLite>()
        for (const r of [...rows, ...ownedRows]) map.set(r.id, r)

        onRows(Array.from(map.values()))
      } catch (e) {
        onError?.(e)
      }
    },
    (err) => onError?.(err)
  )

  return () => {
    try { unsubPrimary() } catch {}
  }
}
