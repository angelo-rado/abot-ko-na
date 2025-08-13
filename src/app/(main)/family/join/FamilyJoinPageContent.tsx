'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import {
  arrayUnion,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { useAuth } from '@/lib/useAuth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const LOCAL_FAMILY_KEY = 'abot:selectedFamily'

type InviteDoc = {
  familyId: string
  createdAt?: any
  createdBy?: string
  expiresAt?: any
}

export default function FamilyJoinPageContent() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const params = useSearchParams()
  const invite = params.get('invite') || ''

  const [joining, setJoining] = useState(false)
  const [familyName, setFamilyName] = useState<string | null>(null)

  const disabled = loading || !invite || joining

  useEffect(() => {
    let alive = true
    if (!invite) return
    (async () => {
      try {
        // peek invite to show family name if you want
        const invRef = doc(firestore, 'invites', invite)
        const invSnap = await getDoc(invRef)
        if (!invSnap.exists()) return
        const inv = invSnap.data() as InviteDoc
        if (!inv.familyId) return
        const famSnap = await getDoc(doc(firestore, 'families', inv.familyId))
        if (!famSnap.exists()) return
        const name = (famSnap.data() as any)?.name ?? 'Family'
        if (alive) setFamilyName(name)
      } catch (e) {
        console.warn('[join] failed to peek family name', e)
      }
    })()
    return () => { alive = false }
  }, [invite])

  async function handleJoin() {
    if (!user) {
      toast.info('Please sign in to join a family.')
      router.push('/login')
      return
    }
    if (!invite) {
      toast.error('Invalid invite link.')
      return
    }

    setJoining(true)
    try {
      const invRef = doc(firestore, 'invites', invite)
      const invSnap = await getDoc(invRef)
      if (!invSnap.exists()) throw new Error('Invite not found or expired.')

      const inv = invSnap.data() as InviteDoc
      const familyId = inv.familyId
      if (!familyId) throw new Error('Malformed invite.')

      // add to families/{id}/members/{uid}
      const memberRef = doc(firestore, 'families', familyId, 'members', user.uid)
      await setDoc(memberRef, {
        role: 'member',
        joinedAt: serverTimestamp(),
      }, { merge: true })

      // add family to users/{uid}.joinedFamilies
      const userRef = doc(firestore, 'users', user.uid)
      await setDoc(userRef, { joinedFamilies: arrayUnion(familyId) }, { merge: true })

      // optional: delete single-use invite
      // await deleteDoc(invRef)

      localStorage.setItem(LOCAL_FAMILY_KEY, familyId)
      toast.success('Joined family!')
      router.replace(`/family/${familyId}?joined=1`)
    } catch (e: any) {
      console.error('[join] failed', e)
      toast.error(e?.message || 'Could not join family.')
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="max-w-xl mx-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle>Join Family</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {familyName ? `You’re about to join “${familyName}”.` : 'Validate your invite and join the family.'}
          </p>
          <div className="flex gap-2">
            <Button disabled={disabled} onClick={handleJoin}>
              {joining ? 'Joining…' : 'Join'}
            </Button>
            <Button variant="outline" onClick={() => router.push('/family')}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
