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

type FamilyLite = { id: string; name?: string | null; createdBy?: string | null }

export default function FamilyJoinPageContent() {
  const searchParams = useSearchParams()
  const inviteId = useMemo(() => searchParams.get('invite') ?? '', [searchParams])
  const router = useRouter()
  const { user, loading } = useAuth()
  const isOnline = useOnlineStatus()

  const [family, setFamily] = useState<FamilyLite | null | undefined>(undefined)
  const [joining, setJoining] = useState(false)
  const [onboarded, setOnboarded] = useState<boolean | null>(null) // null = unknown

  // Fetch invite target
  useEffect(() => {
    let alive = true
    async function run() {
      if (!inviteId || !isOnline) {
        setFamily(null)
        return
      }
      try {
        const snap = await getDoc(doc(firestore, 'families', inviteId))
        if (!alive) return
        if (snap.exists()) {
          const data = snap.data() as any
          setFamily({ id: snap.id, name: data?.name ?? null, createdBy: data?.createdBy ?? null })
        } else {
          setFamily(null)
        }
      } catch (err) {
        console.error('[join] load error', err)
        toast.error('Could not load invite.')
        setFamily(null)
      }
    }
    run()
    return () => { alive = false }
  }, [inviteId, isOnline])

  // If signed in, check onboardingComplete
  useEffect(() => {
    let alive = true
    async function checkOnboarding() {
      if (!user) { setOnboarded(null); return }
      try {
        const u = await getDoc(doc(firestore, 'users', user.uid))
        const ok = Boolean(u.exists() && (u.data() as any)?.onboardingComplete)
        if (alive) setOnboarded(ok)
      } catch {
        if (alive) setOnboarded(false)
      }
    }
    checkOnboarding()
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
      localStorage.setItem(LOCAL_FAMILY_KEY, family.id)
      if (source === 'button') toast.success(`Joined ${family.name ?? 'family'}`)
      // Route to family with joined=1 so detail page can show success dialog
      router.replace(`/family/${family.id}?joined=1`)
    } catch (err) {
      console.error('[join] set member failed', err)
      toast.error('Failed to join family.')
      setJoining(false)
    }
  }

  // SIGNED OUT -> ask to sign up with Google then go to onboarding (preserves invite)
  if (!loading && !user) {
    const redirect = `/onboarding?invite=${encodeURIComponent(inviteId)}`
    const googleUrl = `/login?provider=google&redirect=${encodeURIComponent(redirect)}`
    return (
      <div className="max-w-md mx-auto p-6">
        <Card>
          <CardHeader><CardTitle>Join this family</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Sign in to accept the invite.</p>
            <Button className="w-full" asChild>
              <a href={googleUrl}>Continue with Google</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // SIGNED IN but not onboarded -> send to onboarding (keeps invite)
  if (user && onboarded === false) {
    const url = `/onboarding?invite=${encodeURIComponent(inviteId)}`
    if (typeof window !== 'undefined') router.replace(url)
    return null
  }

  // Loading states
  if (family === undefined) {
    return <div className="max-w-md mx-auto p-6 text-center text-muted-foreground">Loading invite…</div>
  }
  if (family === null) {
    return (
      <div className="max-w-md mx-auto p-6">
        <Card>
          <CardHeader><CardTitle>Invite not found</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">The family doesn’t exist or the link is invalid.</CardContent>
        </Card>
      </div>
    )
  }

  // SIGNED IN & onboarded -> auto-join happens in effect; show subtle status
  if (user && onboarded === true) {
    return (
      <div className="max-w-md mx-auto p-6 text-center text-muted-foreground">
        Joining {family.name ?? 'family'}…
      </div>
    )
  }

  // Fallback: if user is signed in and onboarding is unknown yet, allow manual Accept
  return (
    <div className="max-w-md mx-auto p-6">
      <Card>
        <CardHeader><CardTitle>Join {family.name ?? 'Family'}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">Created by: {family.createdBy ?? 'unknown'}</p>
          <Button className="w-full" onClick={() => joinNow('button')} disabled={joining}>
            {joining ? 'Joining…' : 'Accept Invite'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
