'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, arrayUnion } from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { useAuth } from '@/lib/useAuth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'

type FamilyLite = { id: string; name?: string | null }

export default function FamilyJoinPageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { user, loading } = useAuth()

  const inviteId = useMemo(() => searchParams.get('invite') ?? '', [searchParams])

  const [family, setFamily] = useState<FamilyLite | null | undefined>(undefined) // undefined=loading, null=not found
  const [fetching, setFetching] = useState(false)
  const [joining, setJoining] = useState(false)

  // Load invite target family
  useEffect(() => {
    let alive = true
    async function run() {
      if (!inviteId) {
        setFamily(null)
        return
      }
      setFetching(true)
      try {
        const snap = await getDoc(doc(firestore, 'families', inviteId))
        if (!alive) return
        if (snap.exists()) {
          const data = snap.data() as any
          setFamily({ id: snap.id, name: data?.name ?? null })
        } else {
          setFamily(null)
        }
      } catch (err) {
        console.error('[family/join] load error', err)
        toast.error('Could not load invite. Please try again.')
        setFamily(null)
      } finally {
        if (alive) setFetching(false)
      }
    }
    run()
    return () => {
      alive = false
    }
  }, [inviteId])

  async function handleJoin() {
    if (!user) {
      toast.error('Please sign in to accept the invite.')
      return
    }
    if (!family?.id) return
    setJoining(true)
    try {
      const familyId = family.id
      const uid = user.uid

      // 1) Ensure member doc exists (idempotent)
      const memberRef = doc(firestore, 'families', familyId, 'members', uid)
      await setDoc(
        memberRef,
        {
          uid,
          joinedAt: serverTimestamp(),
        },
        { merge: true }
      )

      // 2) Add to users/{uid}.familiesJoined (idempotent)
      const userRef = doc(firestore, 'users', uid)
      await setDoc(
        userRef,
        {
          uid,
          updatedAt: serverTimestamp(),
          familiesJoined: arrayUnion(familyId),
        },
        { merge: true }
      )

      // 3) Optional: ensure family.members array contains uid (if your doc uses it)
      const famRef = doc(firestore, 'families', familyId)
      await updateDoc(famRef, {
        members: arrayUnion(uid),
        updatedAt: serverTimestamp(),
      }).catch(() => {
        /* ignore if field doesn't exist; subcollection controls membership */
      })

      toast.success('You’ve joined the family!')
      // Redirect to family area (adjust route as needed)
      router.replace(`/family/${familyId}`)
    } catch (err: any) {
      console.error('[family/join] join error', err)
      toast.error('Joining failed. Please try again.')
    } finally {
      setJoining(false)
    }
  }

  // UI
  if (!inviteId) {
    return (
      <div className="max-w-md mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>Invalid invite</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">This link is missing an <code>invite</code> parameter.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (fetching || family === undefined) {
    return (
      <div className="max-w-md mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>Checking invite…</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Please wait.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (family === null) {
    return (
      <div className="max-w-md mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>Invite not found</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              The invite is invalid or the family was deleted. Double-check the link.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle>Join “{family.name || 'Family'}”</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Accept to become a member and see deliveries and presence with the family.
          </p>
          <Button
            onClick={handleJoin}
            disabled={joining || loading}
            aria-disabled={joining || loading}
            aria-busy={joining}
            className="w-full"
          >
            {joining ? 'Joining…' : 'Accept Invite'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
