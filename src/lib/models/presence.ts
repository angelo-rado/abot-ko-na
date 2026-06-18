// src/lib/models/presence.ts
//
// Centralized, typed model for member presence.
//
// Historically presence data was written in several shapes:
//   - top-level `status` / `statusSource` (written by the home page)
//   - nested `presence: { status, statusSource, lastUpdated }` (written by createFamily)
//   - assorted boolean/legacy fields (isHome, atHome, state, statusText, ...)
//
// These normalizers collapse all of those read paths into one place so call
// sites can work with a single typed `MemberPresence`. They intentionally
// preserve the exact behavior that was previously inlined in the home page —
// no Firestore write shapes change.

import { toDate } from '@/lib/dates'

export type PresenceStatus = 'home' | 'away'
export type PresenceSource = 'geo' | 'manual'

/** Loosely-typed Firestore member document as read off the wire. */
export type RawMember = Record<string, unknown> & { uid?: string }

/** Fully normalized presence view used by the UI. */
export interface MemberPresence {
  uid: string
  name: string
  photoURL: string | null
  status: PresenceStatus | null
  source: PresenceSource | null
  updatedAt: Date | null
  /** "On my way home" broadcast. */
  enRoute: boolean
  enRouteSince: Date | null
  /** Optional self-reported minutes-to-arrival when the broadcast was set. */
  etaMinutes: number | null
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
}

/**
 * Resolve a member's presence status across every legacy shape.
 * Returns null when no recognizable status is present.
 */
export function normalizeMemberStatus(m: RawMember): PresenceStatus | null {
  const presence = asRecord(m?.presence)
  const s =
    m?.status ??
    m?.statusText ??
    m?.state ??
    (typeof m?.presence === 'string' ? m.presence : presence?.status) ??
    null

  if (s === 'home' || s === 'away') return s

  // boolean fallbacks
  const b = m?.isHome ?? m?.atHome ?? m?.home
  if (b === true) return 'home'
  if (b === false) return 'away'
  return null
}

/**
 * Resolve how a member's status was set ('geo' = automatic, 'manual').
 *
 * `autoPresenceOverride` mirrors the previous home-page behavior where the
 * signed-in user's global `users/{uid}.autoPresence` flag forces 'geo'.
 */
export function normalizeMemberSource(
  m: RawMember,
  opts: { autoPresenceOverride?: boolean } = {}
): PresenceSource | null {
  const raw = (m?.statusSource ?? m?.source ?? m?.status_source) || null

  if (m?.autoPresence === true || opts.autoPresenceOverride === true) return 'geo'

  if (raw === 'geo' || raw === 'manual') return raw
  return raw ? (String(raw) as PresenceSource) : null
}

/** Best-effort display name across legacy field names. */
export function normalizeMemberName(m: RawMember): string {
  return (m?.name as string) ?? (m?.displayName as string) ?? 'Unknown'
}

/** Best-effort avatar URL across legacy field names. */
export function normalizeMemberPhoto(m: RawMember): string | null {
  return (m?.photoURL as string) ?? (m?.photo as string) ?? null
}

/** Last-updated timestamp across legacy field names, as a Date (or null). */
export function normalizeMemberUpdatedAt(m: RawMember): Date | null {
  const presence = asRecord(m?.presence)
  const raw =
    m?.updatedAt ??
    m?.updated_at ??
    m?.lastUpdated ??
    presence?.lastUpdated ??
    null
  return toDate(raw as Parameters<typeof toDate>[0])
}

/**
 * Whether a member is broadcasting "on my way home".
 * A member who is already home is never considered en route, even if a stale
 * flag lingers on the document.
 */
export function isMemberEnRoute(m: RawMember): boolean {
  if (m?.enRoute !== true) return false
  return normalizeMemberStatus(m) !== 'home'
}

/** Collapse a raw Firestore member doc into a fully-typed presence view. */
export function normalizeMember(
  m: RawMember,
  opts: { autoPresenceOverride?: boolean } = {}
): MemberPresence {
  const etaRaw = m?.etaMinutes
  return {
    uid: (m?.uid as string) ?? '',
    name: normalizeMemberName(m),
    photoURL: normalizeMemberPhoto(m),
    status: normalizeMemberStatus(m),
    source: normalizeMemberSource(m, opts),
    updatedAt: normalizeMemberUpdatedAt(m),
    enRoute: isMemberEnRoute(m),
    enRouteSince: toDate(m?.enRouteSince as Parameters<typeof toDate>[0]),
    etaMinutes: typeof etaRaw === 'number' && Number.isFinite(etaRaw) ? etaRaw : null,
  }
}
