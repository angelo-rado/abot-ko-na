'use client'

import {
  ReactNode, useEffect, useMemo, useRef, useState,
  createContext, useContext,
} from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/useAuth'
import { doc, getDoc } from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { Loader2 } from 'lucide-react'
import { subscribeUserFamilies, type FamilyLite } from '@/lib/memberships'

type FamiliesContextValue = {
  families: FamilyLite[]
  familiesLoading: boolean
  familiesError?: any
}
const FamiliesContext = createContext<FamiliesContextValue>({
  families: [],
  familiesLoading: true,
})

export function useFamiliesContext() {
  return useContext(FamiliesContext)
}

export default function Providers({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const [checking, setChecking] = useState(true)

  // Families subscription state
  const [families, setFamilies] = useState<FamilyLite[]>([])
  const [familiesLoading, setFamiliesLoading] = useState(true)
  const [familiesError, setFamiliesError] = useState<any>(undefined)
  const unsubRef = useRef<(() => void) | null>(null)

  // Onboarding gate
  useEffect(() => {
    if (loading) return

    if (!user) {
      setChecking(false)
      setFamilies([])
      setFamiliesLoading(false)
      setFamiliesError(undefined)
      if (unsubRef.current) { try { unsubRef.current() } catch {} ; unsubRef.current = null }
      return
    }

    ;(async () => {
      try {
        const snap = await getDoc(doc(firestore, 'users', user.uid))
        const data = snap.data()
        if (!data?.onboardingComplete && !pathname.startsWith('/onboarding')) {
          const query = searchParams.toString()
          router.replace(`/onboarding${query ? `?${query}` : ''}`)
          return
        }
      } catch (err) {
        console.warn('Error checking onboarding', err)
      } finally {
        if (mounted.current) setChecking(false)
      }
    })()
  }, [user, loading, pathname, router, searchParams])

  // Families subscription (no collectionGroup anywhere)
  useEffect(() => {
    if (loading || checking) return

    if (unsubRef.current) { try { unsubRef.current() } catch {} ; unsubRef.current = null }

    if (!user?.uid) {
      setFamilies([])
      setFamiliesLoading(false)
      setFamiliesError(undefined)
      return
    }

    setFamiliesLoading(true)
    setFamiliesError(undefined)

    unsubRef.current = subscribeUserFamilies(
      firestore,
      user.uid,
      (rows) => {
        if (!mounted.current) return
        // Sort: owned first, then by name
        const me = user.uid
        const ordered = rows.slice().sort((a, b) => {
          const aOwned = (a.createdBy ?? a.owner) === me
          const bOwned = (b.createdBy ?? b.owner) === me
          if (aOwned !== bOwned) return aOwned ? -1 : 1
          return (a.name ?? '').localeCompare(b.name ?? '')
        })
        setFamilies(ordered)
        setFamiliesLoading(false)
      },
      (err) => {
        console.error('[providers] families subscribe error', err)
        if (!mounted.current) return
        setFamilies([])
        setFamiliesLoading(false)
        setFamiliesError(err)
      }
    )

    return () => {
      if (unsubRef.current) { try { unsubRef.current() } catch {} ; unsubRef.current = null }
    }
  }, [loading, checking, user?.uid])

  const ctx = useMemo<FamiliesContextValue>(() => ({
    families,
    familiesLoading,
    familiesError,
  }), [families, familiesLoading, familiesError])

  if (loading || checking) {
    return (
      <main className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    )
  }

  return (
    <FamiliesContext.Provider value={ctx}>
      {children}
    </FamiliesContext.Provider>
  )
}
