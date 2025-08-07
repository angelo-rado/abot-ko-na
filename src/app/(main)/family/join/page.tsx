'use client'

import { useState, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  arrayUnion,
  serverTimestamp,
} from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { useAuth } from '@/lib/useAuth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import Link from 'next/link'
import { useOnlineStatus } from '@/lib/hooks/useOnlinestatus'

const LOCAL_FAMILY_KEY = 'abot:selectedFamily'

export default function FamilyJoinPage() {
  const searchParams = useSearchParams()
  const rawInvite = searchParams.get('invite')
  const { user, loading } = useAuth()
  const router = useRouter()

  const [family, setFamily] = useState<{ id: string; name?: string } | null>(null)
  const [fetchingFamily, setFetchingFamily] = useState<boolean>(false)
  const [joining, setJoining] = useState(false)
  const isOnline = useOnlineStatus()
    if (!isOnline) {
      return <p className="text-center text-red-500">You're offline — cached content only.</p>
    }

  // Helper to extract an ID if someone passed a full URL into the invite param.
  const extractFamilyId = (val: string | null) => {
    if (!val) return ''
    try {
      const maybe = new URL(val, typeof window !== 'undefined' ? window.location.origin : undefined)
      const p = maybe.searchParams.get('invite')
      if (p) return p
    } catch (_) {
      // not a URL — fall through
    }
    return val.trim()
  }

  const invite = extractFamilyId(rawInvite)

  useEffect(() => {
    if (!invite) return
    let mounted = true
    const fetchFamily = async () => {
      setFetchingFamily(true)
      try {
        const famDoc = await getDoc(doc(firestore, 'families', invite))
        if (!mounted) return
        if (famDoc.exists()) {
          const data = famDoc.data() as any
          setFamily({ id: famDoc.id, name: data?.name ?? undefined })
        } else {
          toast.error('Invalid invite link: family not found')
          setFamily(null)
        }
      } catch (err) {
        console.error('Failed to fetch family for invite', err)
        toast.error('Failed to validate invite link')
        setFamily(null)
      } finally {
        if (mounted) setFetchingFamily(false)
      }
    }
    fetchFamily()
    return () => { mounted = false }
  }, [invite])

  // If user is already a member (member doc exists) redirect them to the family page.
  useEffect(() => {
    if (!user || !family) return
    let mounted = true
    const checkAlreadyMember = async () => {
      try {
        const memberRef = doc(firestore, 'families', family.id, 'members', user.uid)
        const memberSnap = await getDoc(memberRef)
        if (!mounted) return
        if (memberSnap.exists()) {
          toast.success(`You're already a member of ${family.name ?? 'this family'}`)
          router.replace(`/family/${family.id}`)
        }
      } catch (err) {
        console.warn('Failed to check existing member', err)
      }
    }
    checkAlreadyMember()
    return () => { mounted = false }
  }, [user, family, router])

  const handleJoin = async () => {
    if (!user || !family) return
    setJoining(true)

    try {
      const userRef = doc(firestore, 'users', user.uid)
      const familyRef = doc(firestore, 'families', family.id)
      const memberRef = doc(firestore, 'families', family.id, 'members', user.uid)

      // 0) Guard: if member doc already exists, redirect (avoid race)
      const existing = await getDoc(memberRef)
      if (existing.exists()) {
        toast.success(`You're already a member of ${family.name ?? 'this family'}`)
        router.replace(`/family/${family.id}`)
        return
      }

      // 1) Write authoritative membership subdoc (presence defaults, role).
      //    Include profile fields (name/photo) so readers don't need users/{uid}.
      await setDoc(memberRef, {
        uid: user.uid,
        role: 'member',
        addedAt: serverTimestamp(),
        // presence defaults (manual by default)
        status: 'away',
        statusSource: 'manual',
        updatedAt: serverTimestamp(),
        name: (user as any).name ?? (user as any).displayName ?? 'Unknown',
        photoURL: (user as any).photoURL ?? null,
      }, { merge: true })

      // 2) Best-effort: add user to families.{id}.members array so array-contains queries work
      try {
        await updateDoc(familyRef, {
          members: arrayUnion(user.uid),
        })
      } catch (err) {
        console.warn('Could not update families.members array (will fallback to set merge)', err)
        try {
          // fallback: set merge with array if updateDoc failed
          await setDoc(familyRef, { members: [user.uid] }, { merge: true })
        } catch (err2) {
          console.warn('Fallback set for families.members failed', err2)
        }
      }

      // 3) Best-effort: add family id to user's familiesJoined and set preferredFamily so UI picks it up
      try {
        await updateDoc(userRef, {
          familiesJoined: arrayUnion(family.id),
          preferredFamily: family.id,
        })
      } catch (err) {
        console.warn('Could not update users.familiesJoined/preferredFamily (will fallback to set merge)', err)
        try {
          await setDoc(userRef, { familiesJoined: [family.id], preferredFamily: family.id }, { merge: true })
        } catch (err2) {
          console.warn('Fallback set for users doc failed', err2)
        }
      }

      // 4) Persist locally so UI early-init picks this family immediately
      try { localStorage.setItem(LOCAL_FAMILY_KEY, family.id) } catch (e) { /* ignore */ }

      toast.success(`You joined the family: ${family.name ?? family.id}`)
      // navigate to family page
      router.replace(`/family/${family.id}`)
    } catch (e) {
      console.error('Failed to join family', e)
      toast.error('Failed to join family. Please try again.')
    } finally {
      setJoining(false)
    }
  }

  // Render states
  if (!invite) {
    return (
      <div className="max-w-xl mx-auto p-6 text-center">
        <p className="text-muted-foreground">No invite code provided.</p>
        <Link href="/family">
          <Button className="mt-4">Go to Families</Button>
        </Link>
      </div>
    )
  }

  if (fetchingFamily) {
    return (
      <div className="max-w-xl mx-auto p-6 text-center">
        <p className="text-muted-foreground">Loading family info…</p>
      </div>
    )
  }

  if (!family) {
    return (
      <div className="max-w-xl mx-auto p-6 text-center">
        <p className="text-muted-foreground">Invalid invite link: family not found.</p>
        <Link href="/family">
          <Button className="mt-4">Browse Families</Button>
        </Link>
      </div>
    )
  }

  // Force redirect to login if unauthenticated
if (!user && !loading) {
  const currentPath = `/family/join?invite=${invite}`
  router.replace(`/login?redirect=${encodeURIComponent(currentPath)}`)
  return null
}

  return (
    <main className="max-w-xl mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Join Family</CardTitle>
        </CardHeader>
        <CardContent>
          <p>
            You have been invited to join the family <strong>{family.name ?? family.id}</strong>.
          </p>

          <div className="mt-4">
            <Button
              onClick={handleJoin}
              disabled={joining}
              className="w-full"
            >
              {joining ? 'Joining…' : 'Accept Invite'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
