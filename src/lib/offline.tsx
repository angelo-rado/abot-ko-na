// lib/offline.ts
'use client'

import { db, OutboxTask } from '@/lib/db'
import { firestore } from '@/lib/firebase'
import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  collection,
  getDocs,
  writeBatch,
  orderBy,
  query,
  serverTimestamp
} from 'firebase/firestore'

let started = false

export const isOnline = () => {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine
}

export async function enqueue(task: Omit<OutboxTask, 'ts' | 'key'>) {
  try {
    await db.outbox.add({ ...task, ts: Date.now() })
    try { window.dispatchEvent(new CustomEvent('abot-sync-queued', { detail: task })) } catch {}
  } catch {}
}

// ---- Dedup & fold to a minimal set of tasks (last-write-wins per doc) ----
type Key = string // familyId:id
type Folded = { add?: OutboxTask; update?: OutboxTask; del?: OutboxTask }

function foldTasks(items: OutboxTask[]): OutboxTask[] {
  const buckets = new Map<Key, Folded>()
  const other: OutboxTask[] = []

  for (const it of items.sort((a,b)=> (a.ts||0)-(b.ts||0))) {
    // Keys we can fold on (deliveries only for now)
    if ((it.op === 'addDelivery' || it.op === 'updateDelivery' || it.op === 'deleteDelivery') && it.payload?.id) {
      const k = `${it.familyId ?? ''}:${it.payload.id}`
      const b = buckets.get(k) ?? {}
      if (it.op === 'addDelivery') b.add = it
      else if (it.op === 'updateDelivery') b.update = it
      else if (it.op === 'deleteDelivery') b.del = it
      buckets.set(k, b)
    } else {
      other.push(it)
    }
  }

  const out: OutboxTask[] = []
  // Recompose minimal set
  for (const [,b] of buckets) {
    if (b.del) {
      // if there's a delete, it dominates (net result: doc gone). We can drop add/update.
      out.push(b.del)
      continue
    }
    if (b.add && b.update) {
      // merge update payload into add payload (client last-write-wins)
      try {
        b.add.payload = { ...b.add.payload, payload: { ...(b.add.payload?.payload||{}), ...(b.update.payload?.payload||{}) } }
      } catch {}
      out.push(b.add)
      continue
    }
    if (b.add) { out.push(b.add); continue }
    if (b.update) { out.push(b.update); continue }
  }

  return [...other, ...out].sort((a,b)=> (a.ts||0)-(b.ts||0))
}

async function runTask(t: OutboxTask) {
  switch (t.op) {
    case 'addDelivery': {
      const { familyId, id, payload } = t.payload || {}
      if (!familyId || !id) throw new Error('bad addDelivery payload')
      await setDoc(doc(firestore, 'families', familyId, 'deliveries', id), payload, { merge: true })
      return
    }
    case 'updateDelivery': {
      const { familyId, id, payload } = t.payload || {}
      if (!familyId || !id) throw new Error('bad updateDelivery payload')
      // Conflict guard: skip if server is newer
      const ref = doc(firestore, 'families', familyId, 'deliveries', id)
      const snap = await getDoc(ref)
      const serverUpdated = snap.exists() ? ((snap.data() as any)?.updatedAt ?? 0) : 0
      const localUpdated = (payload?.updatedAt ?? 0)
      if (serverUpdated && serverUpdated > localUpdated) return // skip stale
      await updateDoc(ref, payload)
      return
    }
    case 'deleteDelivery': {
      const { familyId, id } = t.payload || {}
      if (!familyId || !id) throw new Error('bad deleteDelivery payload')
      await deleteDoc(doc(firestore, 'families', familyId, 'deliveries', id))
      return
    }
    case 'setHomeLocation': {
      const { familyId, lat, lng } = t.payload || {}
      if (!familyId) throw new Error('bad setHomeLocation payload')
      await setDoc(doc(firestore, 'families', familyId), { homeLocation: { lat, lng } }, { merge: true })
      return
    }
    case 'removeMember': {
      const { familyId, uid } = t.payload || {}
      if (!familyId || !uid) throw new Error('bad removeMember payload')
      await deleteDoc(doc(firestore, 'families', familyId, 'members', uid))
      return
    }
    // Batch mark all items in an order as delivered
    case 'markOrderDelivered': {
      const { familyId, orderId } = t.payload || {}
      if (!familyId || !orderId) throw new Error('bad markOrderDelivered payload')
      const itemsQ = query(collection(firestore, 'families', familyId, 'orders', orderId, 'items'), orderBy('createdAt', 'asc'))
      const itemsSnap = await getDocs(itemsQ)
      const batch = writeBatch(firestore)
      itemsSnap.forEach((docSnap) => {
        batch.update(docSnap.ref, {
          status: 'delivered',
          receivedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        } as any)
      })
      await batch.commit()
      return
    }
    // Mark a single child item as received
    case 'markChildItemReceived': {
      const { familyId, orderId, itemId } = t.payload || {}
      if (!familyId || !orderId || !itemId) throw new Error('bad markChildItemReceived payload')
      const ref = doc(firestore, 'families', familyId, 'orders', orderId, 'items', itemId)
      await updateDoc(ref, {
        status: 'delivered',
        receivedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      } as any)
      return
    }
    default:
      throw new Error('unknown op: ' + t.op)
  }
}

export async function processOutbox() {
  const raw = await db.outbox.toArray()
  const items = foldTasks(raw)

  if (items.length && typeof window !== 'undefined') {
    try { window.dispatchEvent(new CustomEvent('abot-sync-start', { detail: { count: items.length } })) } catch {}
  }

  for (const it of items) {
    try {
      await runTask(it)
      if (typeof it.key === 'number') await db.outbox.delete(it.key)
      try { window.dispatchEvent(new CustomEvent('abot-sync-ok', { detail: it })) } catch {}
    } catch (err) {
      try { window.dispatchEvent(new CustomEvent('abot-sync-error', { detail: { task: it, error: (err as any)?.message || String(err) } })) } catch {}
      // stop on first failure to avoid tight loop
      break
    }
  }

  if (items.length && typeof window !== 'undefined') {
    try { window.dispatchEvent(new CustomEvent('abot-sync-done')) } catch {}
  }
}

export function initOutboxProcessor() {
  if (started) return
  started = true
  if (typeof window !== 'undefined') {
    const kick = async () => {
      if (isOnline()) {
        try { await processOutbox() } catch {}
      }
    }
    window.addEventListener('online', kick)
    window.addEventListener('abot-refresh', kick as any)
    // initial attempt
    queueMicrotask(kick)
  }
}
