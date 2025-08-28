// src/lib/dates.ts
import { formatDistanceToNow } from 'date-fns'
import type { Timestamp } from 'firebase/firestore'

export function toDate(input: Date | string | number | Timestamp | null | undefined): Date | null {
  if (!input) return null
  if (input instanceof Date) return input
  if (typeof input === 'string' || typeof input === 'number') {
    const d = new Date(input)
    return isNaN(d.getTime()) ? null : d
  }
  // Firestore Timestamp
  // @ts-ignore – avoid importing types across layers
  if (input?.toDate) return input.toDate()
  return null
}

export function safeFormatDistanceToNow(
  input: Date | string | number | Timestamp | null | undefined,
  addSuffix = true
): string {
  const d = toDate(input)
  return d ? formatDistanceToNow(d, { addSuffix }) : '—'
}
