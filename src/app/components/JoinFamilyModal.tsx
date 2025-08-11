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
    // keep input in sync when modal opens via route param
    setValue(initialInvite ?? '')
  }, [initialInvite, open])

  // helper: extract familyId from either full invite link or raw id
  const extractFamilyId = (input: string) => {
    if (!input) return ''
    try {
      // try URL parsing
      const maybeUrl = new URL(input, typeof window !== 'undefined' ? window.location.origin : undefined)
      const invite = maybeUrl.searchParams.get('invite')
      if (invite) return invite
    } catch (err) {
      // not a full URL — fall through
    }
    // fallback: sanitize whitespace
    return input.trim()
  }

  const handleJoin = async () => {
    if (!user) {
      toast.error('Sign in to join a family.')
      return
    }
    const familyId = extractFamilyId(value)
    if (!familyId) {
      toast.error('Enter an invite link or family code.')
      return
    }

    setLoading(true)
    try {
      const famRef = doc(firestore, 'families', familyId)
      const famSnap = await getDoc(famRef)
      if (!famSnap.exists()) {
        toast.error('Invite is invalid — family not found.')
        setLoading(false)
        return
      }

      // If member doc already exists, short-circuit and redirect to family
      const memberRef = doc(firestore, 'families', familyId, 'members', user.uid)
      const existingMember = await getDoc(memberRef)
      if (existingMember.exists()) {
        toast.success('You are already a member of this family.')
        onOpenChange(false)
        // Persist locally so UI picks it up quickly
        try { localStorage.setItem(LOCAL_FAMILY_KEY, familyId) } catch {}
        router.replace(`/family/${familyId}`)
        return
      }

      // Write authoritative member doc (role, presence defaults and profile)
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

      // Best-effort: add uid to families/{id}.members array
      try {
        await updateDoc(famRef, {
          members: arrayUnion(user.uid),
        })
      } catch (err) {
        console.warn('Failed to update families.members array (non-fatal)', err)
        try {
          // fallback to set merge (best-effort)
          await setDoc(famRef, { members: [user.uid] }, { merge: true })
        } catch (e) {
          console.warn('Fallback set for families.members failed', e)
        }
      }

      // Best-effort: add family to user's doc and set preferredFamily
      const userRef = doc(firestore, 'users', user.uid)
      try {
        await updateDoc(userRef, {
          familiesJoined: arrayUnion(familyId),
          preferredFamily: familyId,
        })
      } catch (err) {
        console.warn('Could not update users.familiesJoined/preferredFamily (non-fatal)', err)
        try {
          await setDoc(userRef, { familiesJoined: [familyId], preferredFamily: familyId }, { merge: true })
        } catch (e) {
          console.warn('Fallback set for users doc failed', e)
        }
      }

      // Persist locally so UI early-init picks this family immediately
      try { localStorage.setItem(LOCAL_FAMILY_KEY, familyId) } catch (e) { /* ignore */ }

      toast.success('Joined family!')
      onOpenChange(false)
      // replace so back doesn't reopen join modal
      router.replace(`/family/${familyId}`)
    } catch (err) {
      console.error('JoinFamilyModal.handleJoin error', err)
      toast.error('Failed to join family. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md animate-in fade-in zoom-in duration-200">
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
