'use client'

import { HelpCircle } from 'lucide-react'
import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface HelpCircleHintProps {
  title?: string
  children: React.ReactNode
  iconClassName?: string
  className?: string
}

export function HelpCircleHint({
  title = 'Need help?',
  children,
  iconClassName,
  className,
}: HelpCircleHintProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn(
          'text-muted-foreground hover:text-foreground transition-colors',
          className
        )}
        aria-label="Help"
        type="button"
      >
        <HelpCircle className={cn('w-4 h-4', iconClassName)} />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground space-y-2">{children}</div>
        </DialogContent>
      </Dialog>
    </>
  )
}
