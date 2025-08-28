// src/app/family/join/FamilyJoinPageContent.tsx
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
  updateDoc,
} from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { useAuth } from '@/lib/useAuth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const LOCAL_FAMILY_KEY = 'abot:selectedFamily'
const JUST_JOINED_KEY = 'abot:justJoinedFamily'

type InviteDoc = {
  familyId: string
  familyName?: string
  createdAt?: any
  createdBy?: string
  expiresAt?: any
  revoked?: boolean
}

function normalizeInviteParam(raw: string): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  try {
    const url = new URL(trimmed, typeof window !== 'undefined' ? window.location.origin : 'https://example.com')
    const qInvite = url.searchParams.get('invite')
    const qFam = url.searchParams.get('familyId')
    if (qInvite) return qInvite.trim()
    if (qFam) return qFam.trim()
    const parts = url.pathname.split('/').filter(Boolean)
    const famIdx = parts.findIndex((p) => p === 'family')
    if (famIdx !== -1 && parts[famIdx + 1]) return parts[famIdx + 1]
  } catch {}
  return trimmed
}

export default function FamilyJoinPageContent() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const params = useSearchParams()

  const rawInvite = params.get('invite') || ''
  const autoJoin = params.get('autoJoin') === '1'
  const key = normalizeInviteParam(rawInvite)

  const [joining, setJoining] = useState(false)
  const [familyName, setFamilyName] = useState<string | null>(null)
  const [inviteExists, setInviteExists] = useState<boolean | null>(null)
  const [expired, setExpired] = useState(false)
  const triedAutoJoinRef = useRef(false)

  useEffect(() => {
    let alive = true
    if (!key) return

    ;(async () => {
      try {
        const invRef = doc(firestore, 'invites', key)
        const invSnap = await getDoc(invRef)

        if (invSnap.exists()) {
          const inv = invSnap.data() as InviteDoc
          if (!alive) return
          setInviteExists(true)
          if (inv?.expiresAt?.toDate) {
            const when = inv.expiresAt.toDate()
            setExpired(when.getTime() < Date.now())
          }
          if (inv.familyName) setFamilyName(inv.familyName)

          if (!inv.familyName && inv.familyId) {
            try {
              const famSnap = await getDoc(doc(firestore, 'families', inv.familyId))
              if (alive && famSnap.exists()) {
                const name = (famSnap.data() as any)?.name
                if (typeof name === 'string') setFamilyName(name)
              }
            } catch {}
          }
          return
        }

        try {
          const famRef = doc(firestore, 'families', key)
          const famSnap = await getDoc(famRef)
          if (!alive) return
          if (famSnap.exists()) {
            setInviteExists(true)
            const name = (famSnap.data() as any)?.name
            setFamilyName(typeof name === 'string' ? name : null)
            return
          }
          setInviteExists(false)
        } catch {
          if (alive) setInviteExists((prev) => (prev === null ? null : prev))
        }
      } catch {}
    })()

    return () => { alive = false }
  }, [key])

  useEffect(() => {
    if (!autoJoin || triedAutoJoinRef.current) return
    if (loading) return
    if (user && key) {
      triedAutoJoinRef.current = true
      void handleJoin()
    }
  }, [autoJoin, loading, user, key])

  function deriveDisplayName(u: any): string {
    return u?.displayName || u?.name || u?.email || u?.uid || 'User'
  }

  async function handleJoin() {
    if (!key) {
      toast.error('Invalid invite link.')
      return
    }
    if (!user) {
      router.push(`/login?invite=${encodeURIComponent(rawInvite)}&autoJoin=1`)
      return
    }

    setJoining(true)
    try {
      let familyId: string | null = null
      let viaInvite = false
      let famName: string | null = null

      try {
        const invSnap = await getDoc(doc(firestore, 'invites', key))
        if (invSnap.exists()) {
          const inv = invSnap.data() as InviteDoc
          if (inv.revoked) throw new Error('Invite has been revoked.')
          if (inv.expiresAt?.toDate && inv.expiresAt.toDate().getTime() < Date.now()) {
            throw new Error('Invite has expired.')
          }
          familyId = inv.familyId
          famName = inv.familyName ?? null
          viaInvite = true
        }
      } catch (err: any) {
        console.warn('[join] invite lookup error', err?.code || err?.message || err)
      }

      if (!familyId) {
        familyId = key
        try {
          const famSnap = await getDoc(doc(firestore, 'families', familyId))
          if (famSnap.exists()) {
            const n = (famSnap.data() as any)?.name
            famName = typeof n === 'string' ? n : null
          }
        } catch {}
      }
      if (!familyId) throw new Error('Invite is invalid.')

      await setDoc(
        doc(firestore, 'families', familyId, 'members', user.uid),
        {
          uid: user.uid,
          role: 'member',
          joinedAt: serverTimestamp(),
        },
        { merge: true }
      )

      try {
        await updateDoc(doc(firestore, 'families', familyId), {
          members: arrayUnion(user.uid),
        })
      } catch (e) {
        console.warn('[join] unable to update families.members array', e)
      }

      await setDoc(
        doc(firestore, 'families', familyId, 'members', user.uid),
        {
          uid: user.uid,
          name: deriveDisplayName(user),
          photoURL: (user as any)?.photoURL ?? null,
        },
        { merge: true }
      )

      await setDoc(
        doc(firestore, 'users', user.uid),
        { joinedFamilies: arrayUnion(familyId), preferredFamily: familyId },
        { merge: true }
      )

      await setDoc(
        doc(firestore, 'users', user.uid, 'families', familyId),
        {
          familyId,
          familyName: famName ?? familyName ?? familyId,
          lastUpdated: serverTimestamp(),
        },
        { merge: true }
      )

      try { localStorage.setItem(LOCAL_FAMILY_KEY, familyId) } catch {}
      try { sessionStorage.setItem(JUST_JOINED_KEY, familyId) } catch {}
      try {
        window.dispatchEvent(new CustomEvent('abn:family-joined', { detail: { familyId } }))
      } catch {}

      toast.success('Joined family!')
      router.replace(`/(main)?joined=1&family=${encodeURIComponent(familyId)}`)
    } catch (e: any) {
      console.error('[join] failed', e)
      const msg =
        e?.message?.includes('expired') || e?.message?.includes('revoked')
          ? e.message
          : e?.code === 'permission-denied'
            ? 'Invite could not be validated due to permissions. Try joining while signed in.'
            : 'Could not join family.'
      toast.error(msg)
      setJoining(false)
    }
  }

  const isJoiningDisabled = joining || !key || loading

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
                  : 'Join the family with this invite.'}
                {expired && (
                  <span className="block text-xs mt-1 text-amber-600 dark:text-amber-400">
                    Heads up: this invite looks past its expiry.
                  </span>
                )}
              </p>

              <div className="flex gap-2 flex-wrap">
                <Button disabled={isJoiningDisabled} onClick={handleJoin}>
                  {joining ? 'Joining…' : (user ? 'Join' : 'Sign in to Join')}
                </Button>
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => router.push('/family')}
                >
                  Cancel
                </Button>
              </div>

              {!user && !!key && (
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
