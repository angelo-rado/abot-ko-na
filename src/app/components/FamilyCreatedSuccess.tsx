'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useRouter } from 'next/navigation'

interface Props {
  familyName: string
  familyId: string
  onClose?: () => void
}

export default function FamilyCreatedSuccess({ familyName, familyId, onClose }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(true)

  useEffect(() => {
    if (!open) return

    const timeout = setTimeout(() => {
      handleClose()
    }, 20000)

    return () => clearTimeout(timeout)
  }, [open])

  const handleClose = () => {
    setOpen(false)
    onClose?.()
  }

  const goToDashboard = () => {
    router.push(`/family/${familyId}`)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-md animate-in fade-in zoom-in duration-300">
        <DialogHeader>
          <DialogTitle className="text-green-600">Family Created!</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          <strong>{familyName}</strong> is all set! You're now the owner — head to your dashboard to set a home location and start inviting members.
        </p>



        <DialogFooter className="pt-4 flex gap-2 justify-end">
          <Button variant="outline" onClick={goToDashboard}>
            Dashboard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
