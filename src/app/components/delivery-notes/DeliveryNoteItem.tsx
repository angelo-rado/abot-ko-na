'use client'

import { useMemo, useState } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { motion } from 'framer-motion'
import { Pencil, Trash2, Save, X } from 'lucide-react'
import { Timestamp, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { useAuth } from '@/lib/useAuth'
import ConfirmDialog from '@/app/components/ConfirmDialog'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export type DeliveryNoteDoc = {
  id: string
  text: string
  createdAt: Timestamp | { seconds: number } | null
  createdBy: string
  createdByName?: string
  createdByPhotoURL?: string | null
  editedAt?: Timestamp | { seconds: number } | null
  editedBy?: string | null
}

export default function DeliveryNoteItem({
  familyId,
  deliveryId,
  note,
}: {
  familyId: string
  deliveryId: string
  note: DeliveryNoteDoc
}) {
  const { user } = useAuth()
  const isOwner = user?.uid === note.createdBy

  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(note.text)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const createdLabel = useMemo(() => {
    if (!note.createdAt) return 'just now'
    const secs = (note.createdAt as any)?.seconds ?? (note.createdAt as any)?._seconds
    const date = secs ? new Date(secs * 1000) : new Date()
    return date.toLocaleString()
  }, [note.createdAt])

  async function saveEdit() {
    if (!isOwner || !value.trim()) {
      setEditing(false)
      setValue(note.text)
      return
    }
    try {
      await updateDoc(doc(firestore, 'families', familyId, 'deliveries', deliveryId, 'notes', note.id), {
        text: value.trim(),
        editedAt: serverTimestamp(),
        editedBy: user?.uid || null,
      })
      setEditing(false)
      toast.success('Note updated')
    } catch (e) {
      console.error(e)
      toast.error('Update failed')
    }
  }

  async function deleteNote() {
    try {
      await deleteDoc(doc(firestore, 'families', familyId, 'deliveries', deliveryId, 'notes', note.id))
      toast.success('Note deleted')
    } catch (e) {
      console.error(e)
      toast.error('Delete failed')
    }
  }

  const initials =
    (note.createdByName?.split(' ').map((s) => s[0]).join('').slice(0, 2) || 'A').toUpperCase()

  return (
    <>
      <motion.div
        layout
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.18 }}
        className="rounded-lg border bg-card text-card-foreground p-3 sm:p-4"
      >
        <div className="flex items-start gap-3">
          <Avatar className="h-9 w-9">
            <AvatarImage src={note.createdByPhotoURL || undefined} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>

          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{note.createdByName || 'Member'}</span>
              <span className="text-xs text-muted-foreground">• {createdLabel}</span>
              {note.editedAt ? <span className="text-xs text-muted-foreground">(edited)</span> : null}
            </div>

            {!editing ? (
              <p className="mt-1 text-sm whitespace-pre-wrap">{note.text}</p>
            ) : (
              <div className="mt-2">
                <Textarea value={value} onChange={(e) => setValue(e.target.value)} className="min-h-[80px]" />
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={saveEdit}>
                    <Save className="h-4 w-4 mr-1" /> Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditing(false)
                      setValue(note.text)
                    }}
                  >
                    <X className="h-4 w-4 mr-1" /> Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>

          {isOwner && !editing ? (
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className={cn('h-8 w-8 text-destructive')}
                onClick={() => setConfirmOpen(true)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
        </div>
      </motion.div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete note?"
        description="This action cannot be undone."
        danger
        confirmLabel="Delete"
        onConfirm={() => {
          setConfirmOpen(false)
          deleteNote()
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  )
}
