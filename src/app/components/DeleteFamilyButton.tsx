'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import ConfirmDialog from './ConfirmDialog'
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

export default function DeleteFamilyButton({ family, onClose }: Props) {
  const { user } = useAuth()
  const router = useRouter()

  const [loading, setLoading] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const isOwner = !!user && !!family && user.uid === family.createdBy

  const handleDelete = async () => {
    if (!isOwner) {
      toast.error('Only the family owner can delete this family.')
      return
    }

    setLoading(true)

    try {
      const familyId = family.id

      // Step 1: Gather member UIDs
      let memberUIDs: string[] = Array.isArray(family.members) ? [...family.members] : []

      if (memberUIDs.length === 0) {
        const membersSnap = await getDocs(collection(firestore, 'families', familyId, 'members'))
        memberUIDs = membersSnap.docs.map((d) => d.id)
      }

      // Step 2: Delete members subcollection in batches
      const memberDocRefs = memberUIDs.map((uid) =>
        doc(firestore, 'families', familyId, 'members', uid)
      )
      for (let i = 0; i < memberDocRefs.length; i += CHUNK_SIZE) {
        const chunk = memberDocRefs.slice(i, i + CHUNK_SIZE)
        const batch = writeBatch(firestore)
        chunk.forEach((ref) => batch.delete(ref))
        await batch.commit()
      }

      // Step 3: Remove family from users' familiesJoined
      const userDocRefs = memberUIDs.map((uid) => doc(firestore, 'users', uid))
      for (let i = 0; i < userDocRefs.length; i += CHUNK_SIZE) {
        const chunk = userDocRefs.slice(i, i + CHUNK_SIZE)
        const batch = writeBatch(firestore)
        chunk.forEach((userRef) =>
          batch.update(userRef, { familiesJoined: arrayRemove(family.id) } as any)
        )
        await batch.commit()
      }

      // Step 4: Delete family doc
      await deleteDoc(doc(firestore, 'families', familyId))

      toast.success('Family deleted')
      onClose?.()
      router.replace('/family')
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

      <div>
        <Button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={!isOwner || loading}
          className="bg-red-600 hover:bg-red-700 text-white"
        >
          {loading ? 'Deleting…' : 'Delete Family'}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Delete "${family.name ?? 'this family'}"?`}
        description="This will permanently remove the family and revoke access for all members. This action cannot be undone."
        cancelLabel="Cancel"
        confirmLabel="Delete"
        danger
        onConfirm={handleDelete}
      />
    </div>
  )
}
