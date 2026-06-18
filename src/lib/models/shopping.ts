// src/lib/models/shopping.ts
//
// Typed model for the shared family shopping / errand list.
// Stored at families/{familyId}/shoppingItems/{itemId}.

import { toDate } from '@/lib/dates'

/** Loosely-typed Firestore shopping-item document as read off the wire. */
export type RawShoppingItem = Record<string, unknown> & { id?: string }

export interface ShoppingItem {
  id: string
  name: string
  quantity: string | null
  note: string | null
  done: boolean
  createdBy: string | null
  createdByName: string | null
  createdAt: Date | null
  completedBy: string | null
  completedByName: string | null
  completedAt: Date | null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

export function normalizeShoppingItem(d: RawShoppingItem): ShoppingItem {
  return {
    id: (d?.id as string) ?? '',
    name: str(d?.name) ?? '',
    quantity: str(d?.quantity),
    note: str(d?.note),
    done: d?.done === true,
    createdBy: str(d?.createdBy),
    createdByName: str(d?.createdByName),
    createdAt: toDate(d?.createdAt as Parameters<typeof toDate>[0]),
    completedBy: str(d?.completedBy),
    completedByName: str(d?.completedByName),
    completedAt: toDate(d?.completedAt as Parameters<typeof toDate>[0]),
  }
}
