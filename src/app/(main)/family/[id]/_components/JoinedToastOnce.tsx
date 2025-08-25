'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export default function JoinedToastOnce() {
  const router = useRouter()
  const sp = useSearchParams()
  const firedRef = useRef(false)
  const joined = sp.get('joined') === '1'
  const created = sp.get('created') === '1'
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (firedRef.current) return
    if (!(joined || created)) return
    firedRef.current = true
    setOpen(true)

    // strip params so it never re-triggers
    const url = new URL(window.location.href)
    url.searchParams.delete('joined')
    url.searchParams.delete('created')
    router.replace(url.pathname + (url.search ? url.search : ''), { scroll: false })
  }, [joined, created, router])

  const title = joined ? 'You joined the family!' : 'Family created!'
  const desc = joined
    ? 'You can now see updates from this family. Set it as your default in Settings anytime.'
    : 'Invite members and set a home location to start using presence and deliveries.'

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{desc}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => router.push('/settings')}>Go to Settings</Button>
          <Button onClick={() => setOpen(false)}>Okay</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
