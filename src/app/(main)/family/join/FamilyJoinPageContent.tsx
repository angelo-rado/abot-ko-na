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
  const { user, loading: authLoading } = useAuth()
  const isOnline = useOnlineStatus()

  const [family, setFamily] = useState<FamilyLite | null | undefined>(undefined)
  const [joining, setJoining] = useState(false)
  const [onboarded, setOnboarded] = useState<boolean | null>(null)
  const [familyLoaded, setFamilyLoaded] = useState(false)
  const [alreadyMember, setAlreadyMember] = useState(false)

  // Fetch invite target
  useEffect(() => {
    let alive = true
    async function run() {
      if (!inviteId || !isOnline) {
        setFamily(null)
        setFamilyLoaded(true)
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
      } finally {
        if (alive) setFamilyLoaded(true)
      }
    }
    run()
    return () => { alive = false }
  }, [inviteId, isOnline])

  // If signed in, check onboardingComplete and membership
  useEffect(() => {
    let alive = true
    async function checkOnboardingAndMembership() {
      if (!user || !family?.id) {
        setOnboarded(null)
        return
      }
      try {
        // onboarding check
        const u = await getDoc(doc(firestore, 'users', user.uid))
        const ok = Boolean(u.exists() && (u.data() as any)?.onboardingComplete)
        if (alive) setOnboarded(ok)

        // membership check
        const m = await getDoc(doc(firestore, 'families', family.id, 'members', user.uid))
        if (m.exists()) {
          if (alive) setAlreadyMember(true)
        }
      } catch {
        if (alive) {
          setOnboarded(false)
          setAlreadyMember(false)
        }
      }
    }
    checkOnboardingAndMembership()
    return () => { alive = false }
  }, [user, family?.id])

  // Join helper
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
      router.replace(`/family/${family.id}?joined=1`)
    } catch (err) {
      console.error('[join] set member failed', err)
      toast.error('Failed to join family.')
      setJoining(false)
    }
  }

  // Auto-join or skip if already a member
  useEffect(() => {
    if (!user || !family?.id || joining || !familyLoaded) return
    if (alreadyMember) {
      // Skip join, go directly
      localStorage.setItem(LOCAL_FAMILY_KEY, family.id)
      router.replace(`/family/${family.id}`)
      return
    }
    if (onboarded === true) {
      joinNow('auto')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, onboarded, family?.id, familyLoaded, alreadyMember])

  // SIGNED OUT
  if (!authLoading && !user) {
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

  // NOT onboarded yet
  if (user && onboarded === false) {
    if (typeof window !== 'undefined') {
      router.replace(`/onboarding?invite=${encodeURIComponent(inviteId)}`)
    }
    return (
      <div className="max-w-md mx-auto p-6 text-center text-muted-foreground">
        Redirecting to onboarding…
      </div>
    )
  }

  // Loading family data
  if (!familyLoaded) {
    return <div className="max-w-md mx-auto p-6 text-center text-muted-foreground">Loading invite…</div>
  }

  // Invite not found
  if (family === null) {
    return (
      <div className="max-w-md mx-auto p-6">
        <Card>
          <CardHeader><CardTitle>Invite not found</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            The family doesn’t exist or the link is invalid.
          </CardContent>
        </Card>
      </div>
    )
  }

  // Joining state
  if (joining) {
    return (
      <div className="max-w-md mx-auto p-6 text-center text-muted-foreground">
        Joining {family?.name ?? 'family'}…
      </div>
    )
  }

  // Manual join (fallback)
  return (
    <div className="max-w-md mx-auto p-6">
      <Card>
        <CardHeader><CardTitle>Join {family?.name ?? 'Family'}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">Created by: {family?.createdBy ?? 'unknown'}</p>
          <Button className="w-full" onClick={() => joinNow('button')} disabled={joining}>
            Accept Invite
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
