'use client'

import { useState, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { useAuth } from '@/lib/useAuth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { useOnlineStatus } from '@/lib/hooks/useOnlinestatus'

const LOCAL_FAMILY_KEY = 'abot:selectedFamily'

export default function FamilyJoinPageContent() {
  const searchParams = useSearchParams()
  const inviteId = searchParams.get('invite')
  const { user, loading } = useAuth()
  const router = useRouter()
  const isOnline = useOnlineStatus()

  const [family, setFamily] = useState<any>(null)
  const [joining, setJoining] = useState(false)

  if (!user && !loading) {
    const url = `/login?redirect=${encodeURIComponent(`/family/join?invite=${inviteId}`)}`
    return (
      <div className="max-w-md mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>Sign in to join</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              You need to be signed in to accept this invite.
            </p>
            <Button className="w-full" asChild>
              <a href={url}>Sign in</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  useEffect(() => {
    const loadFamily = async () => {
      if (!inviteId || !isOnline) return
      try {
        const ref = doc(firestore, 'families', inviteId)
        const snap = await getDoc(ref)
        if (snap.exists()) {
          setFamily({ id: snap.id, ...snap.data() })
        } else {
          toast.error('Family not found.')
        }
      } catch (err) {
        console.error(err)
        toast.error('Failed to load family.')
      }
    }
    loadFamily()
  }, [inviteId, isOnline])

  const joinFamily = async () => {
    if (!user || !family) return
    setJoining(true)
    try {
      await setDoc(doc(firestore, 'families', inviteId!, 'members', user.uid), {
        joinedAt: serverTimestamp(),
        role: 'member',
      })
      localStorage.setItem(LOCAL_FAMILY_KEY, inviteId!)
      toast.success(`Joined ${family.name}`)
      router.push(`/family/${inviteId}`)
    } catch (err) {
      console.error(err)
      toast.error('Failed to join family.')
    } finally {
      setJoining(false)
    }
  }

  if (!family) {
    return (
      <div className="max-w-md mx-auto p-6 text-center text-muted-foreground">
        Loading family…
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle>Join {family.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">Created by: {family.createdBy}</p>
          <Button className="w-full" onClick={joinFamily} disabled={joining}>
            {joining ? 'Joining…' : 'Accept Invite'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
