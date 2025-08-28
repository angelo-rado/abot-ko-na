// src/lib/join-bus.ts
'use client'

export const JOIN_EVENT = 'abn:family-joined'
const LAST_FAMILY_KEY = 'abn:lastSelectedFamily'

export function persistSelectedFamily(familyId: string) {
  try {
    localStorage.setItem(LAST_FAMILY_KEY, familyId)
  } catch { /* ignore */ }
}

export function emitJoined(familyId: string) {
  persistSelectedFamily(familyId)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(JOIN_EVENT, { detail: { familyId } }))
  }
}

export function onJoined(cb: (familyId: string) => void) {
  const handler = (e: Event) => {
    const ce = e as CustomEvent<{ familyId?: string }>
    if (ce?.detail?.familyId) cb(ce.detail.familyId)
  }
  window.addEventListener(JOIN_EVENT, handler as EventListener)
  return () => window.removeEventListener(JOIN_EVENT, handler as EventListener)
}

export function getLastSelectedFamily(): string | null {
  try {
    return localStorage.getItem(LAST_FAMILY_KEY)
  } catch {
    return null
  }
}
