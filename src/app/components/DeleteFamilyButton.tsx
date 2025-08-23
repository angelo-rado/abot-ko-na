'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import {
  doc, collection, getDocs, writeBatch, deleteDoc, arrayRemove
} from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { useAuth } from '@/lib/useAuth'
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogCancel,
  AlertDialogAction, AlertDialogTrigger
} from '@/components/ui/alert-dialog'

type Props = {
  family: { id: string; name?: string; createdBy?: string; members?: string[] }
  onClose: () => void
}

const CHUNK_SIZE = 400
const LOCAL_FAMILY_KEY = 'abot:selectedFamily'

// best-effort: delete all docs in a subcollection
async function deleteSubcol(familyId: string, sub: string) {
  const ref = collection(firestore, 'families', familyId, sub)
  const snap = await getDocs(ref)
  if (snap.empty) return
  const refs = snap.docs.map(d => d.ref)
  for (let i = 0; i < refs.length; i += CHUNK_SIZE) {
    const batch = writeBatch(firestore)
    refs.slice(i, i + CHUNK_SIZE).forEach(r => batch.delete(r))
    await batch.commit()
  }
}

function hardNavigate(url: string) {
  // Force a new React root; avoids #310 during teardown
  if (typeof window !== 'undefined') window.location.replace(url)
}

export default function DeleteFamilyButton({ family, onClose }: Props) {
  const { user } = useAuth()
  const isOwner = !!user && user.uid === family.createdBy

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const onConfirm = async () => {
    if (!isOwner) {
      toast.error('Only the family owner can delete this family.')
      return
    }
    setBusy(true)
    const familyId = family.id
    try {
      // gather members if not provided
      let memberUIDs = Array.isArray(family.members) ? [...family.members] : []
      if (memberUIDs.length === 0) {
        const ms = await getDocs(collection(firestore, 'families', familyId, 'members'))
        memberUIDs = ms.docs.map(d => d.id)
      }

      // delete common subcollections first (no cascade in Firestore)
      await deleteSubcol(familyId, 'members')
      await deleteSubcol(familyId, 'deliveries').catch(() => {})
      await deleteSubcol(familyId, 'presence').catch(() => {})
      await deleteSubcol(familyId, 'tokens').catch(() => {})

      // best-effort: clean users.familiesJoined (may be blocked by rules)
      for (let i = 0; i < memberUIDs.length; i += CHUNK_SIZE) {
        const chunk = memberUIDs.slice(i, i + CHUNK_SIZE)
        const batch = writeBatch(firestore)
        chunk.forEach(uid => {
          batch.update(doc(firestore, 'users', uid), { familiesJoined: arrayRemove(familyId) } as any)
        })
        await batch.commit().catch(() => {})
      }

      // finally, delete family doc
      await deleteDoc(doc(firestore, 'families', familyId))

      // clear selected family
      try { if (localStorage.getItem(LOCAL_FAMILY_KEY) === familyId) localStorage.removeItem(LOCAL_FAMILY_KEY) } catch {}

      toast.success('Family deleted')
      setOpen(false)
      onClose?.()

      // IMPORTANT: hard reload out of the page to avoid hook mismatches while unmounting
      setTimeout(() => hardNavigate('/family?deleted=1'), 0)
    } catch (e) {
      console.error('Delete family failed', e)
      toast.error('Failed to delete family. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-t pt-4">
      <h3 className="text-sm font-semibold text-destructive mb-2">Delete Family</h3>
      <p className="text-muted-foreground text-sm mb-4">
        This will permanently delete this family and remove all members.
      </p>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            disabled={!isOwner || busy}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {busy ? 'Deleting…' : 'Delete Family'}
          </Button>
        </AlertDialogTrigger>

        {/* keep hooks stable; silence Radix warning */}
        <AlertDialogContent aria-describedby={undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{family.name || 'this family'}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the family and revokes access for all members. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={onConfirm}
              disabled={busy}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
