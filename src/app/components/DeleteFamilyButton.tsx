'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import {
  doc,
  collection,
  getDocs,
  writeBatch,
  deleteDoc,
  updateDoc,
  arrayRemove,
} from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { useAuth } from '@/lib/useAuth'
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogCancel,
  AlertDialogAction, AlertDialogTrigger
} from '@/components/ui/alert-dialog'

type Props = {
  family: {
    id: string
    name?: string
    createdBy?: string
    members?: string[]
  }
  onClose: () => void
}

const CHUNK_SIZE = 400
const LOCAL_FAMILY_KEY = 'abot:selectedFamily'

async function deleteSubcollection(familyId: string, sub: string) {
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
  if (typeof window !== 'undefined') window.location.replace(url)
}

export default function DeleteFamilyButton({ family, onClose }: Props) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const isOwner = !!user && !!family && user.uid === family.createdBy

  const handleDelete = async () => {
    if (!isOwner) { toast.error('Only the family owner can delete this family.'); return }
    setLoading(true)
    try {
      const familyId = family.id

      // gather members if needed
      let memberUIDs: string[] = Array.isArray(family.members) ? [...family.members] : []
      if (memberUIDs.length === 0) {
        const membersSnap = await getDocs(collection(firestore, 'families', familyId, 'members'))
        memberUIDs = membersSnap.docs.map((d) => d.id)
      }

      // delete common subcollections first
      await deleteSubcollection(familyId, 'members')
      await deleteSubcollection(familyId, 'deliveries').catch(() => {})
      await deleteSubcollection(familyId, 'presence').catch(() => {})
      await deleteSubcollection(familyId, 'tokens').catch(() => {})

      // best-effort: remove from users
      for (let i = 0; i < memberUIDs.length; i += CHUNK_SIZE) {
        const chunk = memberUIDs.slice(i, i + CHUNK_SIZE)
        const batch = writeBatch(firestore)
        chunk.forEach((uid) => batch.update(doc(firestore, 'users', uid), { familiesJoined: arrayRemove(familyId) } as any))
        await batch.commit().catch(() => {})
      }

      // delete family doc
      await deleteDoc(doc(firestore, 'families', familyId))

      // clear selected family
      try { if (localStorage.getItem(LOCAL_FAMILY_KEY) === familyId) localStorage.removeItem(LOCAL_FAMILY_KEY) } catch {}

      toast.success('Family deleted')
      setOpen(false)
      onClose?.()
      // hard reload to avoid any residual hook trees
      setTimeout(() => hardNavigate('/family?deleted=1'), 0)
    } catch (err) {
      console.error('Failed to delete family', err)
      toast.error('Failed to delete family. Try again or contact support.')
    } finally {
      setLoading(false)
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
            disabled={!isOwner || loading}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {loading ? 'Deleting…' : 'Delete Family'}
          </Button>
        </AlertDialogTrigger>

        <AlertDialogContent aria-describedby={undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{family.name ?? 'this family'}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the family and revoke access for all members. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={loading}
            >
              {loading ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

