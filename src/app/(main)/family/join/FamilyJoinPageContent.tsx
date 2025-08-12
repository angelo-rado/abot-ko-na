'use client'

import { useState, useEffect, useMemo } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { useAuth } from '@/lib/useAuth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { useOnlineStatus } from '@/lib/hooks/useOnlinestatus'

const LOCAL_FAMILY_KEY = 'abot:selectedFamily'

type FamilyLite = {
  id: string
  name?: string | null
  createdBy?: unknown
}

export default function FamilyJoinPageContent() {
  const searchParams = useSearchParams()
  const inviteId = useMemo(() => {
    // ensure it is always a plain string
    const v = searchParams.get('invite')
    return typeof v === 'string' ? v : ''
  }, [searchParams])

  const router = useRouter()
  const { user, loading } = useAuth()
  const isOnline = useOnlineStatus()

  const [family, setFamily] = useState<FamilyLite | null | undefined>(undefined)
  const [joining, setJoining] = useState(false)
  const [onboarded, setOnboarded] = useState<boolean | null>(null)

  // Fetch invite target (with logging only to console)
  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!inviteId || !isOnline) {
        setFamily(null)
        return
      }
      try {
        const ref = doc(firestore, 'families', inviteId)
        const snap = await getDoc(ref)
        if (!alive) return
        if (snap.exists()) {
          const data = snap.data() as any
          // log but NEVER render raw objects
          console.log('[join] family doc data:', data)
          setFamily({
            id: snap.id,
            name: typeof data?.name === 'string' ? data.name : null,
            createdBy: data?.createdBy, // kept for diagnostics, not rendered
          })
        } else {
          setFamily(null)
        }
      } catch (err) {
        console.error('[join] load error', err)
        toast.error('Could not load invite.')
        setFamily(null)
      }
    })()
    return () => { alive = false }
  }, [inviteId, isOnline])

  // If signed in, check onboardingComplete
  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!user) { setOnboarded(null); return }
      try {
        const u = await getDoc(doc(firestore, 'users', user.uid))
        const ok = Boolean(u.exists() && (u.data() as any)?.onboardingComplete)
        if (alive) setOnboarded(ok)
      } catch {
        if (alive) setOnboarded(false)
      }
    })()
    return () => { alive = false }
  }, [user])

  // Auto-join when logged in AND already onboarded
  useEffect(() => {
    if (!user || onboarded !== true || !family?.id || joining) return
    void joinNow('auto')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, onboarded, family?.id])

  // Join helper (idempotent)
  const joinNow = async (source: 'auto' | 'button') => {
    if (!user || !family?.id) return
    setJoining(true)
    try {
      await setDoc(
        doc(firestore, 'families', family.id, 'members', user.uid),
        { joinedAt: serverTimestamp(), role: 'member' },
        { merge: true }
      )
      try { localStorage.setItem(LOCAL_FAMILY_KEY, family.id) } catch {}
      if (source === 'button') toast.success(`Joined ${family.name ?? 'family'}`)
      router.replace(`/family/${family.id}?joined=1`)
    } catch (err) {
      console.error('[join] set member failed', err)
      toast.error('Failed to join family.')
      setJoining(false)
    }
  }

  // SIGNED OUT → ask to sign in with Google, then onboarding (preserve invite)
  if (!loading && !user) {
    const redirect = `/onboarding?invite=${encodeURIComponent(inviteId)}`
    const googleUrl = `/login?provider=google&redirect=${encodeURIComponent(redirect)}`
    return (
      <div className="max-w-md mx-auto p-6">
        <Card>
          <CardHeader><CardTitle>Join this family</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Sign in to accept the invite.</p>
            {/* avoid asChild just in case */}
            <a className="w-full inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
               href={googleUrl}>
              Continue with Google
            </a>
          </CardContent>
        </Card>
      </div>
    )
  }

  // SIGNED IN but not onboarded → redirect to onboarding (keep invite)
  if (user && onboarded === false) {
    const url = `/onboarding?invite=${encodeURIComponent(inviteId)}`
    if (typeof window !== 'undefined') router.replace(url)
    return null
  }

  // Loading / not found
  if (family === undefined) {
    return <div className="max-w-md mx-auto p-6 text-center text-muted-foreground">Loading invite…</div>
  }
  if (family === null) {
    return (
      <div className="max-w-md mx-auto p-6">
        <Card>
          <CardHeader><CardTitle>Invite not found</CardTitle></CardHeader>
        </Card>
      </div>
    )
  }

  // SIGNED IN & onboarded → auto-join in effect; show subtle status
  if (user && onboarded === true) {
    return (
      <div className="max-w-md mx-auto p-6 text-center text-muted-foreground">
        Joining {typeof family.name === 'string' ? family.name : 'family'}…
      </div>
    )
  }

  // Fallback: allow manual Accept (render only strings)
  const safeFamilyName = typeof family.name === 'string' ? family.name : 'Family'

  return (
    <div className="max-w-md mx-auto p-6">
      <Card>
        <CardHeader><CardTitle>Join {safeFamilyName}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {/* Do NOT render createdBy at all to avoid object children */}
          <Button className="w-full" onClick={() => joinNow('button')} disabled={joining}>
            {joining ? 'Joining…' : 'Accept Invite'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
