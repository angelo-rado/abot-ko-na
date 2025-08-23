'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface ReceiverNoteDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (note: string) => void
  loading?: boolean
}

export function ReceiverNoteDialog({
  open,
  onClose,
  onSubmit,
  loading = false,
}: ReceiverNoteDialogProps) {
  const [note, setNote] = useState('')

  const handleConfirm = () => {
    onSubmit(note.trim())
    setNote('')
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent aria-describedby={undefined} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark as Received</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Optionally, add a note (e.g. who received it, any remarks).
          </p>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Received by Yeye"
            disabled={loading}
          />
        </div>
        <DialogFooter className="pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={loading}>
            {loading ? 'Saving…' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

