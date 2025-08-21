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
  revoked?: boolean
}

/** Accepts full share links, raw invite codes, or family IDs. Returns a normalized key. */
function normalizeInviteParam(raw: string): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  try {
    // If they pasted a full URL, extract ?invite= or ?familyId=
    const url = new URL(trimmed, typeof window !== 'undefined' ? window.location.origin : 'https://example.com')
    const qInvite = url.searchParams.get('invite')
    const qFam = url.searchParams.get('familyId')
    if (qInvite) return qInvite.trim()
    if (qFam) return qFam.trim()
    // If the path looks like /family/<id>, pick last segment
    const parts = url.pathname.split('/').filter(Boolean)
    const famIdx = parts.findIndex((p) => p === 'family')
    if (famIdx !== -1 && parts[famIdx + 1]) return parts[famIdx + 1]
  } catch {
    // not a URL — fallthrough
  }
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
  const [inviteExists, setInviteExists] = useState<boolean | null>(null) // null = unknown; true/false = confident
  const [expired, setExpired] = useState(false)
  const [effectiveFamilyId, setEffectiveFamilyId] = useState<string | null>(null) // resolved family id (from invite or fallback)

  const triedAutoJoinRef = useRef(false)

  // Peek: try invites/{key}, then fallback to families/{key}
  useEffect(() => {
    let alive = true
    if (!key) return

    ;(async () => {
      try {
        // 1) Look up invite doc by code
        const invRef = doc(firestore, 'invites', key)
        const invSnap = await getDoc(invRef)

        if (invSnap.exists()) {
          const inv = invSnap.data() as InviteDoc
          if (!alive) return
          setInviteExists(true)
          setEffectiveFamilyId(inv.familyId || null)

          // expiry hint
          if (inv?.expiresAt?.toDate) {
            const when = inv.expiresAt.toDate()
            setExpired(when.getTime() < Date.now())
          }
          if (inv.familyName) setFamilyName(inv.familyName)

          // Try to enrich name from families if not present (best-effort; may 403 if rules disallow)
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

        // 2) Not an invite code; treat as possible familyId
        try {
          const famRef = doc(firestore, 'families', key)
          const famSnap = await getDoc(famRef)
          if (!alive) return
          if (famSnap.exists()) {
            setInviteExists(true) // exists (via family fallback)
            setEffectiveFamilyId(key)
            const name = (famSnap.data() as any)?.name
            setFamilyName(typeof name === 'string' ? name : null)
            return
          }
          // definitively not found in either collection
          setInviteExists(false)
        } catch {
          // If we can't read family due to rules, we don't know—leave as null (no red error)
          if (alive) {
            setInviteExists((prev) => prev === null ? null : prev)
          }
        }
      } catch {
        // could not read invite due to rules; leave inviteExists as null (don't show red error)
      }
    })()

    return () => { alive = false }
  }, [key, user])

  // Auto-join after login if requested
  useEffect(() => {
    if (!autoJoin || triedAutoJoinRef.current) return
    if (loading) return
    if (user && key) {
      triedAutoJoinRef.current = true
      void handleJoin() // do not await
    }
  }, [autoJoin, loading, user, key])

  async function handleJoin() {
    if (!key) {
      toast.error('Invalid invite link.')
      return
    }
    if (!user) {
      // Preserve original raw string so login can send us back correctly
      router.push(`/login?invite=${encodeURIComponent(rawInvite)}&autoJoin=1`)
      return
    }

    setJoining(true)
    try {
      // Try invite first
      let familyId: string | null = null
      let viaInvite = false

      try {
        const invSnap = await getDoc(doc(firestore, 'invites', key))
        if (invSnap.exists()) {
          const inv = invSnap.data() as InviteDoc
          if (inv.revoked) throw new Error('Invite has been revoked.')
          if (inv.expiresAt?.toDate && inv.expiresAt.toDate().getTime() < Date.now()) {
            throw new Error('Invite has expired.')
          }
          familyId = inv.familyId
          viaInvite = true
        }
      } catch (err: any) {
        // If rules block reading invites, we’ll try family fallback below
        console.warn('[join] invite lookup error', err?.code || err?.message || err)
      }

      // Fallback: treat key as a familyId
      if (!familyId) {
        familyId = key
      }

      if (!familyId) {
        throw new Error('Invite is invalid.')
      }

      // Create/merge membership
      await setDoc(
        doc(firestore, 'families', familyId, 'members', user.uid),
        {
          uid: user.uid,
          role: 'member',
          joinedAt: serverTimestamp(),
        },
        { merge: true }
      )

      // Update user doc (best effort)
      await setDoc(
        doc(firestore, 'users', user.uid),
        { joinedFamilies: arrayUnion(familyId), preferredFamily: familyId },
        { merge: true }
      )

      try { localStorage.setItem(LOCAL_FAMILY_KEY, familyId) } catch {}

      if (viaInvite) {
        // You can optionally increment usage or log join here via a callable or rules-safe write
        // left as best-effort / TODO
      }

      toast.success('Joined family!')
      router.replace(`/family/${familyId}?joined=1`)
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
                  : 'Join the family with this invite link.'}
                {expired && (
                  <span className="block text-xs mt-1 text-amber-600 dark:text-amber-400">
                    Heads up: this invite looks past its expiry.
                  </span>
                )}
              </p>

              <div className="flex gap-2 flex-wrap">
                <Button disabled={isJoiningDisabled} onClick={handleJoin}>
                  {joining ? 'Joining…' : user ? 'Join' : 'Sign in to Join'}
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
