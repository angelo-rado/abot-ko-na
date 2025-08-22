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
  const svgWrapRef = useRef<HTMLDivElement | null>(null)

  const inviteLink = typeof window !== 'undefined'
    ? `${window.location.origin}/family/join?invite=${encodeURIComponent(familyId)}`
    : ''

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
      toast.success('Invite link copied')
    } catch {
      toast.error('Failed to copy link')
    }
  }

  const handleDownloadQR = () => {
    const container = svgWrapRef.current
    if (!container) return
    const svg = container.querySelector('svg') as SVGSVGElement | null
    if (!svg) return

    // Determine an appropriate PNG size from the rendered SVG (avoid oversizing)
    const rect = svg.getBoundingClientRect()
    const base = Math.round(Math.max(rect.width, rect.height) || 160)
    const dpr = Math.min(2, Math.max(1, Math.ceil(window.devicePixelRatio || 1)))
    const size = Math.max(160, Math.min(320, base * dpr)) // clamp to 160–320px

    // Ensure xmlns + explicit size on the SVG before rasterizing
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

      // Save blob
      canvas.toBlob((blob) => {
        if (!blob) return
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `${familyName || 'invite'}-qr.png`
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 2000)
      }, 'image/png')
    }
    img.src = url
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite to {familyName || 'Family'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <Input value={inviteLink} readOnly />
          <Button onClick={handleCopy} type="button">
            {copied ? 'Copied!' : 'Copy link'}
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
