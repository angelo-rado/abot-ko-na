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
const SelectedFamilyCtx = createContext<Ctx | null>(null)

export function SelectedFamilyProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [families, setFamilies] = useState<Family[]>([])
  const [loadingFamilies, setLoadingFamilies] = useState(false)
  const [familyId, setFamilyIdState] = useState<string | null>(null)

  // ✅ initialize ref with null (fixes “Expected 1 arguments”)
  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    // clean up any previous listener
    if (unsubRef.current) {
      try { unsubRef.current() } catch {}
      unsubRef.current = null
    }

    if (!user?.uid) {
      setFamilies([])
      setFamilyIdState(null)
      setLoadingFamilies(false)
      return
    }

    setLoadingFamilies(true)
    // Reliable membership: families/{id}/members/{uid}
    // FIX: use a field filter instead of documentId() on collectionGroup
    const qy = query(collectionGroup(firestore, 'members'), where('uid', '==', user.uid))

    const unsub = onSnapshot(
      qy,
      async (snap) => {
        const ids = Array.from(
          new Set(
            snap.docs
              .map((d) => d.ref.parent.parent?.id)
              .filter((v): v is string => typeof v === 'string' && v.length > 0)
          )
        )

        const out: Family[] = []
        await Promise.all(
          ids.map(async (id) => {
            try {
              const fam = await getDoc(doc(firestore, 'families', id))
              if (fam.exists()) {
                const data = fam.data() as any
                out.push({ id, name: typeof data?.name === 'string' ? data.name : undefined })
              } else {
                out.push({ id })
              }
            } catch {
              out.push({ id })
            }
          })
        )
        out.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        setFamilies(out)

        // pick selected family: localStorage -> users/{uid}.preferredFamily -> first available
        let next: string | null = null
        try { next = localStorage.getItem(LOCAL_KEY) } catch {}
        if (!next) {
          try {
            const u = await getDoc(doc(firestore, 'users', user.uid))
            const pf = (u.exists() ? (u.data() as any).preferredFamily : null) ?? null
            if (pf) next = pf
          } catch {}
        }

        if (next && !out.some((f) => f.id === next)) {
          next = out[0]?.id ?? null
        }
        setFamilyIdState(next ?? out[0]?.id ?? null)
        setLoadingFamilies(false)
      },
      () => setLoadingFamilies(false)
    )

    unsubRef.current = unsub
    return () => { try { unsub(); } catch {} }
  }, [user?.uid])

  const persistPreferred = async (id: string | null) => {
    setFamilyIdState(id)
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
      if (pf && families.some((f) => f.id === pf)) {
        await persistPreferred(pf)
      }
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
