// src/components/ConfirmDialog.tsx
'use client'

import React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { motion } from 'framer-motion'

type ConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  description?: string
  onConfirm?: () => void
  onCancel?: () => void
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

/**
 * Lightweight reusable ConfirmDialog that matches the Dialog markup used in the page.
 */
export default function ConfirmDialog({
  open,
  onOpenChange,
  title = 'Confirm',
  description = '',
  onConfirm,
  onCancel,
  confirmLabel = 'Proceed',
  cancelLabel = 'Cancel',
  danger = false,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <motion.div
        key="confirm-dialog"
        initial={{ opacity: 0, y: -10, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.96 }}
        transition={{
          duration: 0.25,
          ease: [0.22, 1, 0.36, 1],
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>

          {description && (
            <div className="py-2 text-sm text-muted-foreground">{description}</div>
          )}

          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              delay: 0.15,
              duration: 0.25,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <DialogFooter className="pt-4">
              <div className="flex gap-2 justify-end w-full">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    onCancel?.()
                    onOpenChange(false)
                  }}
                >
                  {cancelLabel}
                </Button>
                <Button
                  onClick={() => {
                    onConfirm?.()
                    onOpenChange(false)
                  }}
                  className={danger ? 'bg-red-600 hover:bg-red-700 text-white' : undefined}
                >
                  {confirmLabel}
                </Button>
              </div>
            </DialogFooter>
          </motion.div>
        </DialogContent>
      </motion.div>
    </Dialog>
  )
}
