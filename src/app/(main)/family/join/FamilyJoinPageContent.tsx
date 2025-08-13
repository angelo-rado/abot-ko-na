'use client'

import { useEffect, useRef, useState } from 'react'
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
  const autoJoin = params.get('autoJoin') === '1'

  const [joining, setJoining] = useState(false)
  const [familyName, setFamilyName] = useState<string | null>(null)
  const [inviteExists, setInviteExists] = useState<boolean | null>(null)
  const [expired, setExpired] = useState(false)

  const triedAutoJoinRef = useRef(false)

  // Peek invite; only fetch family doc if signed-in (to avoid rule issues)
  useEffect(() => {
    let alive = true
    if (!invite) return
    ;(async () => {
      try {
        const invRef = doc(firestore, 'invites', invite)
        const invSnap = await getDoc(invRef)
        if (!invSnap.exists()) {
          if (alive) { setInviteExists(false) }
          return
        }
        if (alive) setInviteExists(true)
        const inv = invSnap.data() as InviteDoc

        // Expiry hint (soft check—doesn't block join)
        if (inv?.expiresAt?.toDate) {
          const when = inv.expiresAt.toDate()
          if (alive) setExpired(when.getTime() < Date.now())
        }

        if (inv.familyName) {
          if (alive) setFamilyName(inv.familyName)
        } else if (user) {
          const famSnap = await getDoc(doc(firestore, 'families', inv.familyId))
          if (famSnap.exists()) {
            const name = (famSnap.data() as any)?.name
            if (alive) setFamilyName(typeof name === 'string' ? name : null)
          }
        }
      } catch {
        // ignore preview errors
      }
    })()
    return () => { alive = false }
  }, [invite, user])

  // Auto-join after login if requested
  useEffect(() => {
    if (!autoJoin || triedAutoJoinRef.current) return
    if (loading) return
    if (user && invite) {
      triedAutoJoinRef.current = true
      handleJoin()
    }
  }, [autoJoin, loading, user, invite])

  async function handleJoin() {
    if (!invite) {
      toast.error('Invalid invite link.')
      return
    }
    if (!user) {
      // 👉 pass invite along so Login can send us back here with autoJoin=1
      const url = `/login?invite=${encodeURIComponent(invite)}`
      router.push(url)
      return
    }

    setJoining(true)
    try {
      // Validate invite
      const invRef = doc(firestore, 'invites', invite)
      const invSnap = await getDoc(invRef)
      if (!invSnap.exists()) throw new Error('Invite not found or expired.')

      const inv = invSnap.data() as InviteDoc
      const familyId = inv.familyId
      if (!familyId) throw new Error('Malformed invite.')

      // Add to families/{id}/members/{uid}
      await setDoc(
        doc(firestore, 'families', familyId, 'members', user.uid),
        { role: 'member', joinedAt: serverTimestamp() },
        { merge: true }
      )

      // Maintain users/{uid}.joinedFamilies (allowed since it’s the signed-in user)
      await setDoc(
        doc(firestore, 'users', user.uid),
        { joinedFamilies: arrayUnion(familyId) },
        { merge: true }
      )

      try { localStorage.setItem(LOCAL_FAMILY_KEY, familyId) } catch {}

      toast.success('Joined family!')
      router.replace(`/family/${familyId}?joined=1`)
    } catch (e: any) {
      console.error('[join] failed', e)
      toast.error(e?.message || 'Could not join family.')
      setJoining(false)
    }
  }

  const isJoiningDisabled = joining || !invite || loading

  return (
    <div className="max-w-xl mx-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle>Join Family</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {inviteExists === false ? (
            <p className="text-sm text-destructive">
              This invite is invalid or has expired.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {familyName
                  ? `You’re about to join “${familyName}”.`
                  : 'Join the family with this invite link.'}
                {expired && (
                  <span className="block text-xs mt-1 text-amber-600 dark:text-amber-400">
                    Heads up: this invite looks past its expiry.
                  </span>
                )}
              </p>

              <div className="flex gap-2 flex-wrap">
                <Button disabled={isJoiningDisabled} onClick={handleJoin}>
                  {joining
                    ? 'Joining…'
                    : user
                      ? 'Join'
                      : 'Sign in to Join'}
                </Button>
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => router.push('/family')}
                >
                  Cancel
                </Button>
              </div>

              {!user && !!invite && (
                <p className="text-xs text-muted-foreground">
                  You’ll be redirected back here to finish joining after sign-in.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
