'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useState } from 'react'

export function DeliveryNotesDialog({ note, receiverNote }: { note?: string; receiverNote?: string }) {
  const [open, setOpen] = useState(false)

  if (!note && !receiverNote) return null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <div className="mt-2 text-xs text-muted-foreground underline underline-offset-2 cursor-pointer">
          View Notes
        </div>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined} className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delivery Notes</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm text-muted-foreground">
          {note && (
            <div>
              <p className="font-medium">📝 Creator's Note:</p>
              <p className="whitespace-pre-wrap">{note}</p>
            </div>
          )}
          {receiverNote && (
            <div>
              <p className="font-medium">📩 Receiver's Note:</p>
              <p className="whitespace-pre-wrap">{receiverNote}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

