// src/app/(main)/family/[id]/_components/JoinFamilySuccess.tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export default function JoinFamilySuccess() {
  const router = useRouter()
  const sp = useSearchParams()
  const firedRef = useRef(false)
  const joined = sp.get('joined') === '1'
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (firedRef.current) return
    if (!joined) return
    firedRef.current = true
    setOpen(true)

    // strip param
    const url = new URL(window.location.href)
    url.searchParams.delete('joined')
    router.replace(url.pathname + (url.search ? url.search : ''), { scroll: false })
  }, [joined, router])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>You joined the family!</DialogTitle>
          <DialogDescription>
            You can now see updates from this family. Set it as your default in Settings anytime.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => router.push('/settings')}>Go to Settings</Button>
          <Button onClick={() => setOpen(false)}>Okay</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
