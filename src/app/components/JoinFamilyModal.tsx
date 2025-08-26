// src/app/components/JoinFamilyModal.tsx
'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { decodeQrFromFile } from '@/lib/qr-decode'
import { toast } from 'sonner'
import { Upload, Link as LinkIcon, QrCode } from 'lucide-react'

function normalizeInviteOrCode(raw: string): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  try {
    const url = new URL(trimmed, typeof window !== 'undefined' ? window.location.origin : 'https://example.com')
    const qInvite = url.searchParams.get('invite')
    const qFam = url.searchParams.get('familyId')
    if (qInvite) return qInvite.trim()
    if (qFam) return qFam.trim()
    const parts = url.pathname.split('/').filter(Boolean)
    const famIdx = parts.findIndex((p) => p === 'family')
    if (famIdx !== -1 && parts[famIdx + 1]) return parts[famIdx + 1]
  } catch {}
  return trimmed
}

export default function JoinFamilyModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      setValue('')
      setBusy(false)
    }
  }, [open])

  const onSubmit = useCallback(() => {
    const key = normalizeInviteOrCode(value)
    if (!key) {
      toast.error('Enter an invite link or family code.')
      return
    }
    setBusy(true)
    router.push(`/family/join?invite=${encodeURIComponent(key)}`)
    onOpenChange(false)
  }, [value, router, onOpenChange])

  const onUploadQR = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setBusy(true)
    try {
      const decoded = await decodeQrFromFile(f)
      if (!decoded) {
        toast.error('Could not read QR from image.')
        return
      }
      const key = normalizeInviteOrCode(decoded)
      if (!key) {
        toast.error('QR is not a valid invite or family code.')
        return
      }
      setValue(decoded)
      router.push(`/family/join?invite=${encodeURIComponent(key)}`)
      onOpenChange(false)
    } finally {
      setBusy(false)
      try { e.target.value = '' } catch {}
    }
  }, [router, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Join a Family</DialogTitle>
          <DialogDescription>Paste an invite link or enter a family code. You can also upload a QR image.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="join-code" className="flex items-center gap-2"><LinkIcon className="w-4 h-4" /> Invite link or family code</Label>
            <Input
              id="join-code"
              ref={inputRef}
              inputMode="text"
              placeholder="Paste link or code (e.g., INV123…, or familyId)"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSubmit() }}
              disabled={busy}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={onSubmit} disabled={busy || !value.trim()}>Join</Button>
            <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Upload className="w-4 h-4 mr-1" /> Upload QR
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onUploadQR}
            />
          </div>

          <Separator />

          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <QrCode className="w-4 h-4" />
            If you have a printed/saved QR, tap <strong>Upload QR</strong> and select the image.
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
