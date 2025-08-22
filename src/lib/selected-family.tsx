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

const LOCAL_KEY = 'abot:selectedFamily'
const JUST_JOINED_KEY = 'abot:justJoinedFamily'
const SelectedFamilyCtx = createContext<Ctx | null>(null)

/**
 * SelectedFamilyProvider
 * - Fast-adopts users/{uid}.preferredFamily (no need to wait for membership list)
 * - Falls back to first membership when preferredFamily is absent
 * - Ensures your member profile doc (name/photoURL) whenever familyId is set
 */
export function SelectedFamilyProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [families, setFamilies] = useState<Family[]>([])
  const [familyId, setFamilyIdState] = useState<string | null>(null)
  const [loadingFamilies, setLoadingFamilies] = useState<boolean>(true)

  // internal “ready” trackers to keep loading state accurate
  const prefReadyRef = useRef(false)
  const membershipReadyRef = useRef(false)

  const membersUnsubRef = useRef<(() => void) | null>(null)
  const userUnsubRef = useRef<(() => void) | null>(null)

  // --- helpers
  const endLoadingIfReady = () => {
    if (prefReadyRef.current && membershipReadyRef.current) {
      setLoadingFamilies(false)
    }
  }

  const adoptFamilyId = (id: string | null) => {
    setFamilyIdState((prev) => (prev === id ? prev : id))
  }

  // --- Reset on auth change
  useEffect(() => {
    // cleanup old listeners
    try { membersUnsubRef.current?.() } catch {}
    try { userUnsubRef.current?.() } catch {}
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
        const preferred = (data?.preferredFamily ?? null) as string | null

        // If preferred is present, adopt immediately (don’t wait for membership list)
        if (preferred) {
          adoptFamilyId(preferred)
          try { localStorage.setItem(LOCAL_KEY, preferred) } catch {}
        }
        endLoadingIfReady()
      },
      () => {
        prefReadyRef.current = true
        endLoadingIfReady()
      }
    )

    // Membership list via collectionGroup('members') where uid == user.uid
    const qy = query(collectionGroup(firestore, 'members'), where('uid', '==', user.uid))
    membersUnsubRef.current = onSnapshot(
      qy,
      async (snap) => {
        const rawIds = Array.from(
          new Set(
            snap.docs
              .map((d) => d.ref.parent.parent?.id)
              .filter((v): v is string => typeof v === 'string' && v.length > 0)
          )
        )

        // Smooth handoff from join flows: include JUST_JOINED_KEY if still present
        let ids = rawIds.slice()
        try {
          const jj = sessionStorage.getItem(JUST_JOINED_KEY)
          if (jj && !ids.includes(jj)) ids.push(jj)
          // clear it once membership sees the family (or immediately)
          if (jj && rawIds.includes(jj)) sessionStorage.removeItem(JUST_JOINED_KEY)
        } catch {}

        // Hydrate names (best-effort)
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

        // If no current familyId, adopt first membership
        if (!familyId && list.length > 0) {
          adoptFamilyId(list[0].id)
        }

        membershipReadyRef.current = true
        endLoadingIfReady()
      },
      () => {
        setFamilies([])
        membershipReadyRef.current = true
        endLoadingIfReady()
      }
    )

    return () => {
      try { membersUnsubRef.current?.() } catch {}
      try { userUnsubRef.current?.() } catch {}
      membersUnsubRef.current = null
      userUnsubRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid])

  // Ensure your member profile is hydrated for the current family (fix: others seeing UID)
  useEffect(() => {
    if (!user?.uid || !familyId) return
    const ref = doc(firestore, 'families', familyId, 'members', user.uid)
    setDoc(ref, {
      uid: user.uid,
      name: (user as any).displayName ?? (user as any).name ?? (user as any).email ?? user.uid,
      photoURL: (user as any).photoURL ?? null,
    }, { merge: true }).catch(() => {})
  }, [user?.uid, user?.name, user?.photoURL, user?.email, familyId])

  // Persist & broadcast preferred family
  const persistPreferred = async (id: string | null) => {
    adoptFamilyId(id)
    try { localStorage.setItem(LOCAL_KEY, id ?? '') } catch {}

    if (!user?.uid) return
    try {
      const uref = doc(firestore, 'users', user.uid)
      const snap = await getDoc(uref)
      if (!snap.exists()) {
        await setDoc(uref, { preferredFamily: id ?? null }, { merge: true })
      } else {
        await updateDoc(uref, { preferredFamily: id ?? null })
      }
    } catch {}
  }

  const reloadPreferred = async () => {
    if (!user?.uid) return
    try {
      const u = await getDoc(doc(firestore, 'users', user.uid))
      const pf = (u.exists() ? (u.data() as any).preferredFamily : null) ?? null
      if (pf) await persistPreferred(pf)
    } catch {}
  }

  const value = useMemo<Ctx>(
    () => ({ families, loadingFamilies, familyId, setFamilyId: persistPreferred, reloadPreferred }),
    [families, loadingFamilies, familyId]
  )

  return <SelectedFamilyCtx.Provider value={value}>{children}</SelectedFamilyCtx.Provider>
}

export function useSelectedFamily() {
  const ctx = useContext(SelectedFamilyCtx)
  if (!ctx) throw new Error('useSelectedFamily must be used inside <SelectedFamilyProvider>')
  return ctx
}
