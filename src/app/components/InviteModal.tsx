'use client'

import { useState, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import QRCode from 'react-qr-code'

type InviteModalProps = {
  familyId: string
  familyName?: string // <-- optional now
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function InviteModal({
  familyId,
  familyName,
  open,
  onOpenChange,
}: InviteModalProps) {
  const [copied, setCopied] = useState(false)
  const svgRef = useRef<HTMLDivElement>(null)

  const displayName = familyName ?? 'your family'
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const inviteLink = `${origin}/family/join?invite=${familyId}`

  const handleCopy = () => {
    const fallbackCopy = () => {
      const tempInput = document.createElement('input')
      tempInput.value = inviteLink
      document.body.appendChild(tempInput)
      tempInput.select()
      try {
        const success = document.execCommand('copy')
        if (success) {
          toast.success('Invite link copied!')
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        } else {
          toast.error('Copy failed')
        }
      } catch (err) {
        toast.error('Copy not supported on this browser')
      }
      document.body.removeChild(tempInput)
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(inviteLink).then(() => {
        toast.success('Invite link copied!')
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }).catch(() => {
        fallbackCopy()
      })
    } else {
      fallbackCopy()
    }
  }

  const handleShare = () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      navigator.share({
        title: 'Join my family on Abot Ko Na',
        text: `Join ${displayName} on Abot Ko Na`,
        url: inviteLink,
      }).catch(() => toast.error('Sharing cancelled or failed.'))
    } else {
      // Fallback: Copy to clipboard + notify
      navigator.clipboard?.writeText(inviteLink)
        .then(() => {
          toast.success('Sharing not supported. Link copied instead.')
        })
        .catch(() => {
          toast.error('Sharing not supported, and failed to copy link.')
        })
    }
  }

  const handleDownloadQR = () => {
    const container = svgRef.current
    if (!container) return

    const svg = container.querySelector('svg')
    if (!svg) return

    const serializer = new XMLSerializer()
    const source = serializer.serializeToString(svg)
    const blob = new Blob([source], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url
    a.download = `abot-ko-na-invite-${familyId}.svg`
    a.click()

    URL.revokeObjectURL(url)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm space-y-4">
        <DialogHeader>
          <DialogTitle>Invite to {displayName}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Share this link or QR code with family members to invite them:
        </p>

        <Input
          readOnly
          value={inviteLink}
          className="text-sm"
          onFocus={(e) => e.target.select()}
          autoFocus
        />

        <div className="space-y-2">
          <Button onClick={handleCopy} className="w-full">
            {copied ? 'Copied!' : 'Copy Link'}
          </Button>
          <Button onClick={handleShare} variant="outline" className="w-full">
            Share
          </Button>
        </div>

        <div className="flex justify-center rounded bg-muted p-4">
          <div ref={svgRef}>
            <QRCode value={inviteLink} size={160} />
          </div>
        </div>

        <Button variant="secondary" onClick={handleDownloadQR} className="w-full">
          Download QR Code
        </Button>
      </DialogContent>
    </Dialog>
  )
}
