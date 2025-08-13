'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import {
  arrayUnion,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { useAuth } from '@/lib/useAuth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const LOCAL_FAMILY_KEY = 'abot:selectedFamily'

type InviteDoc = {
  familyId: string
  familyName?: string
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

  // Peek invite; only fetch family doc if signed-in to avoid rules errors
  useEffect(() => {
    let alive = true
    if (!invite) return
    ;(async () => {
      try {
        const invRef = doc(firestore, 'invites', invite)
        const invSnap = await getDoc(invRef)
        if (!invSnap.exists()) return
        const inv = invSnap.data() as InviteDoc
        if (inv.familyName) {
          if (alive) setFamilyName(inv.familyName)
          return
        }
        if (user) {
          const famSnap = await getDoc(doc(firestore, 'families', inv.familyId))
          if (famSnap.exists()) {
            const name = (famSnap.data() as any)?.name
            if (alive) setFamilyName(typeof name === 'string' ? name : null)
          }
        }
      } catch {
        // ignore; don't block join flow with preview errors
      }
    })()
    return () => { alive = false }
  }, [invite, user])

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
      await setDoc(doc(firestore, 'families', familyId, 'members', user.uid), {
        role: 'member',
        joinedAt: serverTimestamp(),
      }, { merge: true })

      // maintain users/{uid}.joinedFamilies for rules overlap checks
      await setDoc(doc(firestore, 'users', user.uid), { joinedFamilies: arrayUnion(familyId) }, { merge: true })

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
            {familyName ? `You’re about to join “${familyName}”.` : 'Join the family with this invite link.'}
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
