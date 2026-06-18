// src/lib/models/delivery.ts
//
// Centralized, typed model for deliveries (and legacy "orders").
//
// As with presence/family, delivery docs have accumulated alias fields over
// time (title vs name vs platform, note vs notes). These helpers give the UI a
// single typed view and one correct search predicate.

import { toDate } from '@/lib/dates'

export type DeliveryStatus = 'pending' | 'in_transit' | 'delivered' | 'cancelled'

/** Loosely-typed Firestore delivery/order document as read off the wire. */
export type RawDelivery = Record<string, unknown> & { id?: string }

export interface Delivery {
  id: string
  title: string
  status: DeliveryStatus
  type: string // 'single' | 'bulk' | 'order'
  expectedDate: Date | null
  courier: string | null
  trackingNumber: string | null
  note: string | null
  codAmount: number | null
  totalAmount: number | null
  itemCount: number
  createdBy: string | null
  archived: boolean
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Collapse a raw delivery/order doc into a fully-typed view. */
export function normalizeDelivery(d: RawDelivery): Delivery {
  const status = String(d?.status ?? 'pending').toLowerCase() as DeliveryStatus
  return {
    id: (d?.id as string) ?? '',
    title: str(d?.title) ?? str(d?.platform) ?? str(d?.name) ?? 'Delivery',
    status,
    type: (str(d?.type) as string) ?? 'single',
    expectedDate: toDate(d?.expectedDate as Parameters<typeof toDate>[0]),
    courier: str(d?.courier),
    trackingNumber: str(d?.trackingNumber) ?? str(d?.tracking),
    note: str(d?.note) ?? str(d?.notes),
    codAmount: num(d?.codAmount),
    totalAmount: num(d?.totalAmount),
    itemCount: num(d?.itemCount) ?? 0,
    createdBy: str(d?.createdBy),
    archived: d?.archived === true,
  }
}

/**
 * One correct search predicate across every searchable field (current + legacy).
 * Empty query matches everything.
 */
export function deliveryMatchesQuery(d: RawDelivery, queryText: string): boolean {
  const q = queryText.trim().toLowerCase()
  if (!q) return true
  const haystack = [
    d?.title,
    d?.name,
    d?.platform,
    d?.note,
    d?.notes,
    d?.courier,
    d?.trackingNumber,
    d?.tracking,
    d?.receiverNote,
  ]
  return haystack.some((f) => typeof f === 'string' && f.toLowerCase().includes(q))
}
