'use client'

import { useEffect, useState } from 'react'
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

/* ----------------------------
   Relative time (live)
   ---------------------------- */
function toDate(input: any): Date | null {
  if (!input) return null
  if ((input as any)?.toDate) return (input as any).toDate()
  if ((input as any)?.seconds) return new Date((input as any).seconds * 1000)
  if (typeof input === 'number' || typeof input === 'string') {
    const v = new Date(input)
    if (!Number.isNaN(v.getTime())) return v
  }
  return null
}
function formatRelative(from: Date, to: Date) {
  const s = Math.floor((from.getTime() - to.getTime()) / 1000)
  const abs = Math.max(0, s)
  if (abs < 10) return 'a few seconds ago'
  if (abs < 60) return `${abs} seconds ago`
  const m = Math.floor(abs / 60)
  if (m === 1) return 'a minute ago'
  if (m < 60) return '${m} minutes ago'
  const h = Math.floor(m / 60)
  if (h === 1) return 'an hour ago'
  if (h < 24) return '${h} hours ago'
  const d = Math.floor(h / 24)
  if (d === 1) return 'a day ago'
  return `${d} days ago`
}
function useRelativeTime(rawDate: any) {
  const [label, setLabel] = useState<string>(() => {
    const init = toDate(rawDate)
    return init ? formatRelative(new Date(), init) : 'just now'
  })
  useEffect(() => {
    const dMaybe = toDate(rawDate)
    if (!dMaybe) {
      setLabel('just now')
      return
    }
    // Narrow to Date for TS:
    const dd: Date = dMaybe
    function update() { setLabel(formatRelative(new Date(), dd)) }
    update()
    const diffSec = Math.abs((Date.now() - dd.getTime()) / 1000)
    let interval = 1000
    if (diffSec > 60 && diffSec <= 3600) interval = 30_000
    else if (diffSec > 3600 && diffSec <= 86400) interval = 300_000
    else if (diffSec > 86400) interval = 3600_000
    const id = setInterval(update, interval)
    return () => clearInterval(id)
  }, [rawDate])
  return label
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

  const createdLabel = useRelativeTime(note.createdAt)
  const editedLabel = useRelativeTime(note.editedAt)

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

  const displayName = isOwner ? 'You' : (note.createdByName || 'Member')

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
              <span className="text-sm font-medium">{displayName}</span>
              <span className="text-xs text-muted-foreground">• {createdLabel}</span>
              {note.editedAt ? <span className="text-xs text-muted-foreground">(edited {editedLabel})</span> : null}
            </div>

            {!editing ? (
              <motion.p
                layout
                initial={{ opacity: 0.8 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.15 }}
                className="mt-1 text-sm whitespace-pre-wrap"
              >
                {note.text}
              </motion.p>
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
