'use client'

import { AnimatePresence, motion } from 'framer-motion'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export default function ConfirmDialog(props: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  description?: string
  danger?: boolean
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const {
    open, onOpenChange, title, description,
    danger, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
    onConfirm, onCancel
  } = props

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <DialogContent asChild>
            <motion.div
              initial={{ opacity: 0, scale: 0.98, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 8 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              <DialogHeader>
                <DialogTitle>{title}</DialogTitle>
                {description ? <DialogDescription>{description}</DialogDescription> : null}
              </DialogHeader>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={onCancel}>{cancelLabel}</Button>
                <Button variant={danger ? 'destructive' : 'default'} onClick={onConfirm}>
                  {confirmLabel}
                </Button>
              </DialogFooter>
            </motion.div>
          </DialogContent>
        ) : null}
      </AnimatePresence>
    </Dialog>
  )
}
