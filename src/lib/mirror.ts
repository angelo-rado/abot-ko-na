// lib/mirror.ts
'use client'

import { db, Delivery } from '@/lib/db'

export async function mirrorDeliveriesToDexie(familyId: string, docs: Array<any>) {
  if (!familyId) return
  const rows: Delivery[] = docs.map((d) => ({
    id: d.id,
    familyId,
    title: d.title ?? d.name ?? d?.data?.title ?? undefined,
    for: d.for ?? d.receiver ?? undefined,
    type: d.type,
    amount: d.amount ?? null,
    note: d.note ?? '',
    receiverNote: d.receiverNote ?? '',
    eta: d.expectedDate ? (d.expectedDate.seconds ? d.expectedDate.seconds * 1000 : d.expectedDate) : null,
    createdAt: d.createdAt ? (d.createdAt.seconds ? d.createdAt.seconds * 1000 : d.createdAt) : undefined,
    updatedAt: d.updatedAt ? (d.updatedAt.seconds ? d.updatedAt.seconds * 1000 : d.updatedAt) : undefined,
    itemCount: d.itemCount ?? undefined,
  }))

  try {
    await db.transaction('rw', db.deliveries, async () => {
      await db.deliveries.where('familyId').equals(familyId).delete()
      if (rows.length) await db.deliveries.bulkPut(rows)
    })
  } catch (err) {
    console.warn('[mirrorDeliveriesToDexie] failed', err)
  }
}

export async function readDeliveriesFromDexie(familyId: string) {
  try {
    return await db.deliveries.where('familyId').equals(familyId).sortBy('updatedAt')
  } catch { return [] }
}
