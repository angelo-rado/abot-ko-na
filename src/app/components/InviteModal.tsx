'use client'

import { useState, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import QRCode from 'react-qr-code'

type InviteModalProps = {
  familyId: string
  familyName?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function InviteModal({ familyId, familyName, open, onOpenChange }: InviteModalProps) {
  const [copied, setCopied] = useState(false)
  const svgWrapRef = useRef<HTMLDivElement>(null)

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
      } catch {
        toast.error('Copy not supported on this browser')
      }
      document.body.removeChild(tempInput)
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(inviteLink)
        .then(() => {
          toast.success('Invite link copied!')
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        })
        .catch(fallbackCopy)
    } else {
      fallbackCopy()
    }
  }

  const handleShare = () => {
    if (typeof navigator !== 'undefined' && (navigator as any).share) {
      (navigator as any).share({
        title: 'Join my family on Abot Ko Na',
        text: `Join ${displayName} on Abot Ko Na`,
        url: inviteLink,
      }).catch(() => toast.error('Sharing cancelled or failed.'))
    } else {
      navigator.clipboard?.writeText(inviteLink)
        .then(() => toast.success('Sharing not supported. Link copied instead.'))
        .catch(() => toast.error('Sharing not supported, and failed to copy link.'))
    }
  }

  // Convert <svg> QR to PNG and download (with Safari-safe fallback)
  const handleDownloadQR = () => {
    const container = svgWrapRef.current
    if (!container) return
    const svg = container.querySelector('svg') as SVGSVGElement | null
    if (!svg) return

    // Ensure xmlns + explicit size on the SVG before rasterizing
    const size = 640 // output PNG size
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    svg.setAttribute('width', String(size))
    svg.setAttribute('height', String(size))

    const serializer = new XMLSerializer()
    const svgStr = serializer.serializeToString(svg)
    const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)

    const img = new Image()
    img.onload = () => {
      // Draw onto canvas
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) { URL.revokeObjectURL(url); return }
      ctx.imageSmoothingEnabled = false
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, size, size)
      ctx.drawImage(img, 0, 0, size, size)
      URL.revokeObjectURL(url)

      // Prefer toBlob; fallback to dataURL (Safari)
      if (canvas.toBlob) {
        canvas.toBlob((blob) => {
          if (!blob) {
            // Fallback if toBlob returns null
            const dataURL = canvas.toDataURL('image/png')
            const a = document.createElement('a')
            a.href = dataURL
            a.download = `abot-ko-na-invite-${familyId}.png`
            a.click()
            return
          }
          const pngUrl = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = pngUrl
          a.download = `abot-ko-na-invite-${familyId}.png`
          a.click()
          setTimeout(() => URL.revokeObjectURL(pngUrl), 2000)
        }, 'image/png')
      } else {
        const dataURL = canvas.toDataURL('image/png')
        const a = document.createElement('a')
        a.href = dataURL
        a.download = `abot-ko-na-invite-${familyId}.png`
        a.click()
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      toast.error('Failed to generate QR code image.')
    }
    img.src = url
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm space-y-4">
        <DialogHeader>
          <DialogTitle>Invite to {displayName}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">Share this link or QR code with family members to invite them:</p>

        <Input readOnly value={inviteLink} className="text-sm" onFocus={(e) => e.target.select()} autoFocus />

        <div className="space-y-2">
          <Button type="button" onClick={handleCopy} className="w-full">
            {copied ? 'Copied!' : 'Copy Link'}
          </Button>
          <Button type="button" onClick={handleShare} variant="outline" className="w-full">
            Share
          </Button>
        </div>

        <div className="flex justify-center rounded bg-muted p-4">
          <div ref={svgWrapRef}>
            {/* react-qr-code renders an SVG */}
            <QRCode value={inviteLink} size={160} />
          </div>
        </div>

        <Button type="button" variant="secondary" onClick={handleDownloadQR} className="w-full">
          Download QR Code (PNG)
        </Button>
      </DialogContent>
    </Dialog>
  )
}
