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
const LOCAL_FAMILY_KEY = 'abot:selectedFamily'

// util: delete all docs in a subcollection in chunks (best-effort)
async function deleteSubcolDocs(familyId: string, subcol: string) {
  const ref = collection(firestore, 'families', familyId, subcol)
  const snap = await getDocs(ref)
  if (snap.empty) return
  const refs = snap.docs.map(d => d.ref)
  for (let i = 0; i < refs.length; i += CHUNK_SIZE) {
    const batch = writeBatch(firestore)
    refs.slice(i, i + CHUNK_SIZE).forEach(r => batch.delete(r))
    await batch.commit()
  }
}

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
    const familyId = family.id

    try {
      // 1) Gather member UIDs (from prop or live read)
      let memberUIDs: string[] = Array.isArray(family.members) ? [...family.members] : []
      if (memberUIDs.length === 0) {
        const membersSnap = await getDocs(collection(firestore, 'families', familyId, 'members'))
        memberUIDs = membersSnap.docs.map((d) => d.id)
      }

      // 2) Best-effort: delete common subcollections (members, deliveries, presence, tokens)
      await deleteSubcolDocs(familyId, 'members')
      await deleteSubcolDocs(familyId, 'deliveries').catch(() => {})
      await deleteSubcolDocs(familyId, 'presence').catch(() => {})
      await deleteSubcolDocs(familyId, 'tokens').catch(() => {})

      // 3) Best-effort: remove family from users/{uid}.familiesJoined (may be blocked by rules; ignore failures)
      if (memberUIDs.length) {
        for (let i = 0; i < memberUIDs.length; i += CHUNK_SIZE) {
          const chunk = memberUIDs.slice(i, i + CHUNK_SIZE)
          const batch = writeBatch(firestore)
          chunk.forEach((uid) => {
            batch.update(doc(firestore, 'users', uid), { familiesJoined: arrayRemove(familyId) } as any)
          })
          await batch.commit().catch(() => {}) // non-fatal
        }
      }

      // 4) Delete family doc last
      await deleteDoc(doc(firestore, 'families', familyId))

      // 5) Clear client-selected family and leave the detail route immediately
      try {
        if (localStorage.getItem(LOCAL_FAMILY_KEY) === familyId) {
          localStorage.removeItem(LOCAL_FAMILY_KEY)
        }
      } catch {}

      toast.success('Family deleted')
      onClose?.()
      setConfirmOpen(false)

      // Hard exit from /family/[id] so children don’t render while tearing down
      router.replace('/family?deleted=1')
      router.refresh()
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
