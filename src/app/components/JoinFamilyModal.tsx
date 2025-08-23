'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useAuth } from '@/lib/useAuth'
import { useRouter } from 'next/navigation'
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  arrayUnion,
  serverTimestamp,
  increment,
} from 'firebase/firestore'
import { firestore } from '@/lib/firebase'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialInvite?: string | null // optional prefilled familyId or full link
}

const LOCAL_FAMILY_KEY = 'abot:selectedFamily'

export default function JoinFamilyModal({ open, onOpenChange, initialInvite }: Props) {
  const { user } = useAuth()
  const router = useRouter()

  const [value, setValue] = useState(initialInvite ?? '')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setValue(initialInvite ?? '')
  }, [initialInvite, open])

  // Accepts: full URL (?invite=...), deep links, or raw code
  const extractCode = (input: string) => {
    if (!input) return ''
    const trimmed = input.trim()
    try {
      const maybeUrl = new URL(
        trimmed,
        typeof window !== 'undefined' ? window.location.origin : 'https://abot-ko-na.local'
      )
      const qp = maybeUrl.searchParams.get('invite')
      if (qp) return qp.trim()
    } catch {
      // not a URL
    }
    return trimmed
  }

  // Resolve to a valid familyId.
  // Supports either direct familyId OR invite tokens stored under top-level `invites/{code}`.
  const resolveFamilyId = async (code: string) => {
    // 1) Try direct family doc id
    const famRefDirect = doc(firestore, 'families', code)
    const famSnapDirect = await getDoc(famRefDirect)
    if (famSnapDirect.exists()) {
      return { familyId: code, inviteRefPath: null as string | null }
    }

    // 2) Try invite token lookup
    const inviteRef = doc(firestore, 'invites', code)
    const inviteSnap = await getDoc(inviteRef)
    if (!inviteSnap.exists()) {
      return null
    }

    const inv = inviteSnap.data() as any
    const familyId: string | undefined =
      inv?.familyId ?? inv?.family ?? inv?.fid // support older field names if any

    if (!familyId) {
      return null
    }

    // Optional validations: revoked / expired / usage limits
    const revoked: boolean = !!inv?.revoked || !!inv?.disabled
    if (revoked) return { error: 'Invite has been revoked.', familyId: null, inviteRefPath: inviteRef.path }

    const now = Date.now()
    let expiresAt: number | null = null
    if (inv?.expiresAt) {
      if (typeof inv.expiresAt?.toDate === 'function') {
        expiresAt = inv.expiresAt.toDate().getTime()
      } else if (typeof inv.expiresAt === 'number') {
        expiresAt = inv.expiresAt
      } else if (typeof inv.expiresAt === 'string') {
        const t = Date.parse(inv.expiresAt)
        expiresAt = Number.isNaN(t) ? null : t
      }
    }
    if (expiresAt && now > expiresAt) {
      return { error: 'Invite has expired.', familyId: null, inviteRefPath: inviteRef.path }
    }

    const maxUses: number | undefined = typeof inv?.maxUses === 'number' ? inv.maxUses : undefined
    const uses: number = typeof inv?.uses === 'number' ? inv.uses : 0
    if (typeof maxUses === 'number' && uses >= maxUses) {
      return { error: 'Invite has reached its maximum number of uses.', familyId: null, inviteRefPath: inviteRef.path }
    }

    return { familyId, inviteRefPath: inviteRef.path }
  }

  const bumpInviteUsage = async (inviteRefPath: string | null) => {
    if (!inviteRefPath) return
    try {
      await updateDoc(doc(firestore, inviteRefPath), {
        uses: increment(1),
        lastUsedAt: serverTimestamp(),
      })
    } catch {
      // best-effort only
    }
  }

  const handleJoin = async () => {
    if (!user) {
      toast.error('Sign in to join a family.')
      return
    }
    const code = extractCode(value)
    if (!code) {
      toast.error('Enter an invite link or family code.')
      return
    }

    setLoading(true)
    try {
      const resolved = await resolveFamilyId(code)

      if (!resolved || (!resolved.familyId && !resolved.error)) {
        toast.error('Invite is invalid — code not recognized.')
        setLoading(false)
        return
      }
      if (resolved && resolved.error) {
        toast.error(resolved.error)
        setLoading(false)
        return
      }

      const familyId = resolved!.familyId as string

      // Verify family exists (in case invite pointed to deleted family)
      const famRef = doc(firestore, 'families', familyId)
      const famSnap = await getDoc(famRef)
      if (!famSnap.exists()) {
        toast.error('Invite is invalid — family not found.')
        setLoading(false)
        return
      }

      // If already a member, short-circuit
      const memberRef = doc(firestore, 'families', familyId, 'members', user.uid)
      const existingMember = await getDoc(memberRef)
      if (existingMember.exists()) {
        await bumpInviteUsage(resolved!.inviteRefPath ?? null)
        toast.success('You are already a member of this family.')
        onOpenChange(false)
        try { localStorage.setItem(LOCAL_FAMILY_KEY, familyId) } catch {}
        router.replace(`/family/${familyId}?joined=1`)
        return
      }

      // Create/merge member record
      await setDoc(
        memberRef,
        {
          uid: user.uid,
          role: 'member',
          addedAt: serverTimestamp(),
          status: 'away',
          statusSource: 'manual',
          updatedAt: serverTimestamp(),
          name: (user as any).name ?? (user as any).displayName ?? 'Unknown',
          photoURL: (user as any).photoURL ?? null,
        },
        { merge: true }
      )

      // Append to families.members (best-effort)
      try {
        await updateDoc(famRef, { members: arrayUnion(user.uid) })
      } catch {
        try {
          await setDoc(famRef, { members: [user.uid] }, { merge: true })
        } catch {}
      }

      // Update users doc (best-effort)
      const userRef = doc(firestore, 'users', user.uid)
      try {
        await updateDoc(userRef, {
          familiesJoined: arrayUnion(familyId),
          preferredFamily: familyId,
        })
      } catch {
        try {
          await setDoc(userRef, { familiesJoined: [familyId], preferredFamily: familyId }, { merge: true })
        } catch {}
      }

      await bumpInviteUsage(resolved!.inviteRefPath ?? null)

      try { localStorage.setItem(LOCAL_FAMILY_KEY, familyId) } catch {}

      toast.success('Joined family!')
      onOpenChange(false)
      router.replace(`/family/${familyId}?joined=1`)
    } catch (err) {
      console.error('JoinFamilyModal.handleJoin error', err)
      toast.error('Failed to join family. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="sm:max-w-md animate-in fade-in zoom-in duration-200">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Join a Family</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <p className="text-sm text-muted-foreground">
            Paste an invite link or family code to join an existing family.
          </p>

          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Invite link or family code"
            autoFocus
            className="text-sm"
          />

          <div className="flex gap-2">
            <Button 
              type="button"
              onClick={handleJoin}
              disabled={loading || !value.trim()}
              className="flex-1"
            >
              {loading ? 'Joining...' : 'Join Family'}
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setValue('')
                onOpenChange(false)
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

