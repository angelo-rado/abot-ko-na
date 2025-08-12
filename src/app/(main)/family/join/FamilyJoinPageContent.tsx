'use client'

import { useState, useEffect, useMemo } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { useAuth } from '@/lib/useAuth'
import { toast } from 'sonner'

const LOCAL_FAMILY_KEY = 'abot:selectedFamily'

type FamilyLite = { id: string; name: string | null; createdBy: string | null }

function safeText(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  // Prevent React #130 by never rendering objects/functions directly
  console.warn('[join] prevented rendering non-primitive value:', v)
  return ''
}

export default function FamilyJoinPageContent() {
  const searchParams = useSearchParams()
  const inviteId = useMemo(() => searchParams.get('invite') ?? '', [searchParams])
  const router = useRouter()
  const { user, loading } = useAuth()

  const [family, setFamily] = useState<FamilyLite | null | undefined>(undefined)
  const [joining, setJoining] = useState(false)
  const [onboarded, setOnboarded] = useState<boolean | null>(null)

  // Load invite
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        if (!inviteId) { setFamily(null); return }
        const snap = await getDoc(doc(firestore, 'families', inviteId))
        if (!alive) return
        if (!snap.exists()) { setFamily(null); return }

        const data = snap.data() as any

        const name =
          typeof data?.name === 'string'
            ? data.name
            : data?.name?.toString?.() ?? null

        // Normalize createdBy to string if it’s a DocumentReference or object
        let createdBy: string | null = null
        if (typeof data?.createdBy === 'string') createdBy = data.createdBy
        else if (data?.createdBy?.id) createdBy = String(data.createdBy.id)
        else if (data?.createdBy?.uid) createdBy = String(data.createdBy.uid)

        setFamily({ id: snap.id, name, createdBy })
      } catch (e) {
        console.error('[join] load error', e)
        toast.error('Could not load invite.')
        setFamily(null)
      }
    })()
    return () => { alive = false }
  }, [inviteId])

  // Check onboarding
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        if (!user) { setOnboarded(null); return }
        const u = await getDoc(doc(firestore, 'users', user.uid))
        const ok = Boolean(u.exists() && (u.data() as any)?.onboardingComplete)
        if (alive) setOnboarded(ok)
      } catch {
        if (alive) setOnboarded(false)
      }
    })()
    return () => { alive = false }
  }, [user])

  // Auto-join once ready
  useEffect(() => {
    if (!user || onboarded !== true || !family?.id || joining) return
    void joinNow('auto')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, onboarded, family?.id])

  async function joinNow(source: 'auto' | 'button') {
    if (!user || !family?.id) return
    setJoining(true)
    try {
      await setDoc(
        doc(firestore, 'families', family.id, 'members', user.uid),
        { joinedAt: serverTimestamp(), role: 'member' },
        { merge: true }
      )
      try { localStorage.setItem(LOCAL_FAMILY_KEY, family.id) } catch {}
      if (source === 'button') toast.success(`Joined ${safeText(family.name) || 'family'}`)
      router.replace(`/family/${family.id}?joined=1`)
    } catch (err) {
      console.error('[join] set member failed', err)
      toast.error('Failed to join family.')
      setJoining(false)
    }
  }

  // --- RENDER ---

  // Signed out -> login flow preserving invite
  if (!loading && !user) {
    const redirect = `/onboarding?invite=${encodeURIComponent(inviteId)}`
    const googleUrl = `/login?provider=google&redirect=${encodeURIComponent(redirect)}`
    return (
      <div className="max-w-md mx-auto p-6">
        <h1 className="text-lg font-semibold mb-2">Join this family</h1>
        <p className="text-sm text-muted-foreground mb-3">Sign in to accept the invite.</p>
        <a className="inline-flex h-9 items-center px-4 rounded border" href={googleUrl}>
          Continue with Google
        </a>
      </div>
    )
  }

  // Signed in but not onboarded: redirect (keeps invite)
  if (user && onboarded === false) {
    const url = `/onboarding?invite=${encodeURIComponent(inviteId)}`
    if (typeof window !== 'undefined') router.replace(url)
    return null
  }

  if (family === undefined) {
    return <div className="max-w-md mx-auto p-6 text-center text-muted-foreground">Loading invite…</div>
  }

  if (family === null) {
    return (
      <div className="max-w-md mx-auto p-6">
        <h1 className="text-lg font-semibold mb-2">Invite not found</h1>
        <p className="text-sm text-muted-foreground">The family doesn’t exist or the link is invalid.</p>
      </div>
    )
  }

  // Signed in & onboarded -> auto join in effect
  if (user && onboarded === true) {
    return (
      <div className="max-w-md mx-auto p-6 text-center text-muted-foreground">
        Joining {safeText(family.name) || 'family'}…
      </div>
    )
  }

  // Fallback (manual accept)
  return (
    <div className="max-w-md mx-auto p-6">
      <h1 className="text-lg font-semibold mb-2">Join {safeText(family.name) || 'Family'}</h1>
      {/* If you want to show who created it, render normalized string only: */}
      {/* <p className="text-xs text-muted-foreground mb-3">
        Created by: {safeText(family.createdBy) || 'unknown'}
      </p> */}
      <button
        type="button"
        className="inline-flex h-9 items-center px-4 rounded border"
        onClick={() => joinNow('button')}
        disabled={joining}
      >
        {joining ? 'Joining…' : 'Accept Invite'}
      </button>
    </div>
  )
}
