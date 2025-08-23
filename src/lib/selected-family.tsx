'use client'

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { firestore } from '@/lib/firebase'
import { useAuth } from '@/lib/useAuth'
import {
  collectionGroup,
  doc,
  getDoc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'

type Family = { id: string; name?: string }
type Ctx = {
  families: Family[]
  loadingFamilies: boolean
  familyId: string | null
  setFamilyId: (id: string | null) => Promise<void>
  reloadPreferred: () => Promise<void>
}

const SelectedFamilyCtx = createContext<Ctx | null>(null)

const JUST_JOINED_KEY = 'abot:just-joined-family'

export function SelectedFamilyProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()

  const [families, setFamilies] = useState<Family[]>([])
  const [loadingFamilies, setLoadingFamilies] = useState<boolean>(true)
  const [familyId, setFamilyIdState] = useState<string | null>(null)

  // unsub refs
  const membersUnsubRef = useRef<null | (() => void)>(null)
  const userUnsubRef = useRef<null | (() => void)>(null)

  // ready flags
  const prefReadyRef = useRef(false)
  const membershipReadyRef = useRef(false)

  // Reset on auth change
  useEffect(() => {
    // cleanup previous listeners
    try { membersUnsubRef.current?.() } catch { }
    try { userUnsubRef.current?.() } catch { }
    membersUnsubRef.current = null
    userUnsubRef.current = null

    setFamilies([])
    setFamilyIdState(null)
    setLoadingFamilies(true)
    prefReadyRef.current = false
    membershipReadyRef.current = false

    if (!user?.uid) {
      setLoadingFamilies(false)
      return
    }

    // Listen to users/{uid} for preferredFamily (fast path)
    userUnsubRef.current = onSnapshot(
      doc(firestore, 'users', user.uid),
      (snap) => {
        prefReadyRef.current = true
        const data = snap.exists() ? (snap.data() as any) : null
        const preferred: string | null = typeof data?.preferredFamily === 'string' ? data.preferredFamily : null
        setFamilyIdState(preferred ?? null)
      },
      () => { prefReadyRef.current = true }
    )

    // Listen to all memberships via collectionGroup
    const q = query(collectionGroup(firestore, 'members'), where('uid', '==', user.uid))
    membersUnsubRef.current = onSnapshot(
      q,
      async (qs) => {
        membershipReadyRef.current = true
        const rawIds = Array.from(new Set(qs.docs.map((d) => d.ref.parent.parent?.id).filter(Boolean) as string[]))

        // Include JUST_JOINED_KEY one-shot to improve immediate UX after join
        let ids = rawIds.slice()
        try {
          const jj = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(JUST_JOINED_KEY) : null
          if (jj && !ids.includes(jj)) ids.push(jj)
          if (jj && rawIds.includes(jj)) sessionStorage.removeItem(JUST_JOINED_KEY)
        } catch { }

        // Best-effort hydrate names
        const list: Family[] = []
        await Promise.all(
          ids.map(async (id) => {
            try {
              const fam = await getDoc(doc(firestore, 'families', id))
              if (fam.exists()) {
                const data = fam.data() as any
                list.push({ id, name: typeof data?.name === 'string' ? data.name : undefined })
              } else {
                list.push({ id })
              }
            } catch {
              list.push({ id })
            }
          })
        )
        list.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        setFamilies(list)

        // Auto-select a family if none is chosen yet
        setFamilyIdState((curr) => curr ?? (list[0]?.id ?? null))
        setLoadingFamilies(false)
      },
      () => {
        membershipReadyRef.current = true
        setLoadingFamilies(false)
      }
    )

    return () => {
      try { membersUnsubRef.current?.() } catch { }
      try { userUnsubRef.current?.() } catch { }
      membersUnsubRef.current = null
      userUnsubRef.current = null
    }
  }, [user?.uid])

  // Ensure your member profile is hydrated for the current family (fix: others seeing UID)
  useEffect(() => {
    if (!user?.uid || !familyId) return
    const ref = doc(firestore, 'families', familyId, 'members', user.uid)
    setDoc(ref, {
      uid: user.uid,
      name: (user as any).displayName ?? (user as any).name ?? (user as any).email ?? user.uid,
      photoURL: (user as any).photoURL ?? null,
      updatedAt: Date.now(),
    }, { merge: true }).catch(() => { })
  }, [user?.uid, user?.name, user?.photoURL, familyId])

  // Persist preferred family to users/{uid}
  const persistPreferred = async (id: string | null) => {
    if (!user?.uid) return
    const uref = doc(firestore, 'users', user.uid)
    try {
      await setDoc(uref, { preferredFamily: id ?? null }, { merge: true })
      setFamilyIdState(id)
    } catch {
      // fallback to update
      try { await updateDoc(uref, { preferredFamily: id ?? null }) } catch { }
      setFamilyIdState(id)
    }
  }

  // Manual reload of preferred family (one-shot read)
  const reloadPreferred = async () => {
    if (!user?.uid) return
    try {
      const snap = await getDoc(doc(firestore, 'users', user.uid))
      const data = snap.exists() ? (snap.data() as any) : null
      const preferred: string | null = typeof data?.preferredFamily === 'string' ? data.preferredFamily : null
      setFamilyIdState(preferred ?? null)
    } catch { }
  }

  const setFamilyId = React.useCallback(persistPreferred, [user?.uid])
  const reloadPreferredStable = React.useCallback(reloadPreferred, [user?.uid])

  const value: Ctx = {
    families,
    loadingFamilies,
    familyId,
    setFamilyId,
    reloadPreferred: reloadPreferredStable,
  }

  return <SelectedFamilyCtx.Provider value={value}>{children}</SelectedFamilyCtx.Provider>
}

export function useSelectedFamily() {
  const ctx = useContext(SelectedFamilyCtx)
  if (!ctx) throw new Error('useSelectedFamily must be used inside <SelectedFamilyProvider>')
  return ctx
}

// Helper to satisfy TS when toggling booleans in refs
function FalseGuard(v: boolean) { return v }
