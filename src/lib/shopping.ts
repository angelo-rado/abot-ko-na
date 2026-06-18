// src/lib/shopping.ts
//
// Data access for the shared family shopping / errand list.
// Realtime reads via onSnapshot; writes go straight to Firestore (the SDK's
// persistentLocalCache provides offline queueing for free).

import { firestore, auth } from '@/lib/firebase'
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  writeBatch,
  getDocs,
  where,
  type DocumentData,
  type QuerySnapshot,
} from 'firebase/firestore'
import {
  normalizeShoppingItem,
  type ShoppingItem,
  type RawShoppingItem,
} from '@/lib/models/shopping'

function itemsCollection(familyId: string) {
  return collection(firestore, 'families', familyId, 'shoppingItems')
}

/** Subscribe to a family's shopping list, newest first. Returns an unsubscribe fn. */
export function subscribeToShoppingList(
  familyId: string,
  callback: (items: ShoppingItem[]) => void,
  onError?: (err: Error) => void
): () => void {
  try {
    const q = query(itemsCollection(familyId), orderBy('createdAt', 'desc'))
    return onSnapshot(
      q,
      (snap: QuerySnapshot<DocumentData>) => {
        const items = snap.docs.map((d) =>
          normalizeShoppingItem({ id: d.id, ...(d.data() as RawShoppingItem) })
        )
        callback(items)
      },
      (err) => {
        if (onError) onError(err)
        else console.error('subscribeToShoppingList error', err)
      }
    )
  } catch (err) {
    console.error('subscribeToShoppingList failed', err)
    return () => {}
  }
}

export async function addShoppingItem(
  familyId: string,
  input: { name: string; quantity?: string | null; note?: string | null; createdByName?: string | null }
) {
  if (!familyId) throw new Error('familyId required')
  const name = input.name.trim()
  if (!name) throw new Error('name required')

  await addDoc(itemsCollection(familyId), {
    name,
    quantity: input.quantity?.trim() || null,
    note: input.note?.trim() || null,
    done: false,
    createdBy: auth.currentUser?.uid ?? null,
    createdByName: input.createdByName?.trim() || auth.currentUser?.displayName || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    completedBy: null,
    completedByName: null,
    completedAt: null,
  })
}

export async function setShoppingItemDone(
  familyId: string,
  itemId: string,
  done: boolean,
  completedByName?: string | null
) {
  if (!familyId || !itemId) throw new Error('familyId and itemId required')
  const ref = doc(firestore, 'families', familyId, 'shoppingItems', itemId)
  await updateDoc(ref, {
    done,
    completedBy: done ? auth.currentUser?.uid ?? null : null,
    completedByName: done ? (completedByName?.trim() || auth.currentUser?.displayName || null) : null,
    completedAt: done ? serverTimestamp() : null,
    updatedAt: serverTimestamp(),
  })
}

export async function updateShoppingItem(
  familyId: string,
  itemId: string,
  patch: { name?: string; quantity?: string | null; note?: string | null }
) {
  if (!familyId || !itemId) throw new Error('familyId and itemId required')
  const ref = doc(firestore, 'families', familyId, 'shoppingItems', itemId)
  const data: Record<string, unknown> = { updatedAt: serverTimestamp() }
  if (patch.name !== undefined) data.name = patch.name.trim()
  if (patch.quantity !== undefined) data.quantity = patch.quantity?.trim() || null
  if (patch.note !== undefined) data.note = patch.note?.trim() || null
  await updateDoc(ref, data)
}

export async function deleteShoppingItem(familyId: string, itemId: string) {
  if (!familyId || !itemId) throw new Error('familyId and itemId required')
  await deleteDoc(doc(firestore, 'families', familyId, 'shoppingItems', itemId))
}

/** Delete every completed item. Returns the number removed. */
export async function clearCompletedItems(familyId: string): Promise<number> {
  if (!familyId) throw new Error('familyId required')
  const q = query(itemsCollection(familyId), where('done', '==', true))
  const snap = await getDocs(q)
  if (snap.empty) return 0
  const batch = writeBatch(firestore)
  snap.docs.forEach((d) => batch.delete(d.ref))
  await batch.commit()
  return snap.size
}
