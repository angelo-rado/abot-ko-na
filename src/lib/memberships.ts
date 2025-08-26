// src/lib/memberships.ts
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore'

export type FamilyLite = {
  id: string
  name?: string | null
  createdBy?: string | null
  createdAt?: any
  updatedAt?: any
  members?: string[]
  owner?: string | null
  homeLocation?: { lat: number; lng: number; address?: string | null } | null
  homeLat?: number | null
  homeLng?: number | null
  homeAddress?: string | null
}

/**
 * Subscribes to all families the user either owns or is a member of – without using documentId()
 * on collectionGroup (which is invalid when comparing to a bare UID).
 *
 * Strategy:
 *  1) owned families: /families where createdBy == uid
 *  2) joined families: collectionGroup('members') where uid == {uid}  -> resolve parents
 *  3) legacy array membership: /families where members array-contains uid
 */
export function subscribeUserFamilies(
  firestore: Firestore,
  uid: string,
  onChange: (families: FamilyLite[]) => void,
  onError?: (e: any) => void
): Unsubscribe {
  const ownedQ = query(collection(firestore, 'families'), where('createdBy', '==', uid))
  const legacyQ = query(collection(firestore, 'families'), where('members', 'array-contains', uid))
  const cg = query(collectionGroup(firestore, 'members'), where('uid', '==', uid))

  let owned: Record<string, FamilyLite> = {}
  let legacy: Record<string, FamilyLite> = {}
  let cgParents: Record<string, FamilyLite> = {}

  const emit = () => {
    const map = new Map<string, FamilyLite>()
    for (const m of [owned, legacy, cgParents]) {
      for (const [id, fam] of Object.entries(m)) map.set(id, fam)
    }
    onChange(Array.from(map.values()))
  }

  const unsubOwned = onSnapshot(
    ownedQ,
    (snap) => {
      owned = {}
      snap.forEach((d) => {
        const raw = (d.data() as any) ?? {}
        const { id: _ignored, ...rest } = raw
        owned[d.id] = { ...rest, id: d.id }
      })
      emit()
    },
    (e) => onError?.(e)
  )

  const unsubLegacy = onSnapshot(
    legacyQ,
    (snap) => {
      legacy = {}
      snap.forEach((d) => {
        const raw = (d.data() as any) ?? {}
        const { id: _ignored, ...rest } = raw
        legacy[d.id] = { ...rest, id: d.id }
      })
      emit()
    },
    (e) => onError?.(e)
  )

  const unsubCG = onSnapshot(
    cg,
    async (snap) => {
      const parents = await Promise.all(
        snap.docs.map(async (memberDoc) => {
          const famId = memberDoc.ref.parent?.parent?.id
          if (!famId) return null
          const famSnap = await getDoc(doc(firestore, 'families', famId))
          if (!famSnap.exists()) return null
          const raw = (famSnap.data() as any) ?? {}
          const { id: _ignored, ...rest } = raw
          return { ...rest, id: famId } as FamilyLite
        })
      )
      cgParents = {}
      parents.filter(Boolean).forEach((f) => (cgParents[(f as FamilyLite).id] = f as FamilyLite))
      emit()
    },
    (e) => onError?.(e)
  )

  return () => {
    try { unsubOwned() } catch {}
    try { unsubLegacy() } catch {}
    try { unsubCG() } catch {}
  }
}
