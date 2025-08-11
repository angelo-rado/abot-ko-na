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
import { useOnlineStatus } from '@/lib/hooks/useOnlinestatus'
import JoinFamilyModal from '@/app/components/JoinFamilyModal'

const LOCAL_FAMILY_KEY = 'abot:selectedFamily'

export default function FamilyJoinPageContent() {
  const searchParams = useSearchParams()
  const rawInvite = searchParams.get('invite')
  const { user, loading } = useAuth()
  const router = useRouter()
  const isOnline = useOnlineStatus()

  const [family, setFamily] = useState<{ id: string; name?: string } | null>(null)
  const [fetchingFamily, setFetchingFamily] = useState<boolean>(false)
  const [joining, setJoining] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)

  if (!isOnline) {
    return <p className="text-center text-red-500">You're offline — cached content only.</p>
  }

  const extractFamilyId = (val: string | null) => {
    if (!val) return ''
    try {
      const maybe = new URL(val, typeof window !== 'undefined' ? window.location.origin : undefined)
      const p = maybe.searchParams.get('invite')
      if (p) return p
    } catch {}
    return val.trim()
  }

  const invite = extractFamilyId(rawInvite)

  useEffect(() => {
    if (!user && !loading && invite) {
      const currentPath = `/family/join?invite=${invite}`
      router.replace(`/login?redirect=${encodeURIComponent(currentPath)}`)
    }
  }, [user, loading, invite, router])

  useEffect(() => {
    if (!invite || !user || loading) return
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
  }, [invite, user, loading])

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
          router.replace(`/onboarding?family=${family.id}`)
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

      const existing = await getDoc(memberRef)
      if (existing.exists()) {
        toast.success(`You're already a member of ${family.name ?? 'this family'}`)
        router.replace(`/onboarding?family=${family.id}`)
        return
      }

      await setDoc(memberRef, {
        uid: user.uid,
        role: 'member',
        addedAt: serverTimestamp(),
        status: 'away',
        statusSource: 'manual',
        updatedAt: serverTimestamp(),
        name: (user as any).name ?? (user as any).displayName ?? 'Unknown',
        photoURL: (user as any).photoURL ?? null,
      }, { merge: true })

      try {
        await updateDoc(familyRef, { members: arrayUnion(user.uid) })
      } catch {
        await setDoc(familyRef, { members: [user.uid] }, { merge: true })
      }

      try {
        await updateDoc(userRef, {
          familiesJoined: arrayUnion(family.id),
          preferredFamily: family.id,
        })
      } catch {
        await setDoc(userRef, {
          familiesJoined: [family.id],
          preferredFamily: family.id,
        }, { merge: true })
      }

      try {
        localStorage.setItem(LOCAL_FAMILY_KEY, family.id)
      } catch {}

      toast.success(`You joined the family: ${family.name ?? family.id}`)
      router.replace(`/onboarding?family=${family.id}`)
    } catch (e) {
      console.error('Failed to join family', e)
      toast.error('Failed to join family. Please try again.')
    } finally {
      setJoining(false)
    }
  }

  if (!invite) {
    return (
      <div className="max-w-xl mx-auto p-6 text-center">
        <p className="text-muted-foreground">No invite code provided. Please enter invite code below</p>
        <JoinFamilyModal open={joinOpen} onOpenChange={setJoinOpen} />
        <Button type="button" className="mt-4" variant="outline" onClick={() => setJoinOpen(true)}>Enter Invite Code</Button>
      </div>
    )
  }

  if (loading || !user || fetchingFamily) {
    return (
      <div className="max-w-xl mx-auto p-6 text-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    )
  }

  if (!family) {
    return (
      <div className="max-w-xl mx-auto p-6 text-center">
        <p className="text-muted-foreground">Invalid invite link: family not found.</p>
      </div>
    )
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
