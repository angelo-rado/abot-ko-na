'use client'

import { ReactNode, useEffect, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/useAuth'
import { doc, getDoc } from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { Loader2 } from 'lucide-react'

export default function Providers({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    if (loading) return

    if (!user) {
      setChecking(false)
      return
    }

    const checkOnboarding = async () => {
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
        setChecking(false)
      }
    }

    checkOnboarding()
  }, [user, loading, pathname, router, searchParams])

  if (loading || checking) {
    return (
      <main className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    )
  }

  return <>{children}</>
}
