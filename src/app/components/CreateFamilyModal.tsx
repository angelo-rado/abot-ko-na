'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { createFamily } from '@/lib/family'
import { useAuth } from '@/lib/useAuth'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function CreateFamilyModal({ open, onOpenChange }: Props) {
  const [familyName, setFamilyName] = useState('')
  const [loading, setLoading] = useState(false)
  const { user } = useAuth()
  const router = useRouter()

  const handleCreate = async () => {
    if (!user || !familyName.trim()) return
    setLoading(true)

    try {
      const familyId = await createFamily(familyName.trim(), user.uid)

      setFamilyName('')
      onOpenChange(false)

      toast.success('Family created', {
        description: 'You can now invite other members.',
        duration: 3000,
      })

      router.push(`/family?created=${familyId}`)
    } catch (err) {
      console.error(err)
      toast.error('Failed to create family')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="sm:max-w-md animate-in fade-in zoom-in duration-200">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Create a Family</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <Input
            autoFocus
            placeholder="e.g. Santos Family"
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
          />
          <Button
            type="button"
            onClick={handleCreate}
            disabled={loading || !familyName.trim()}
            className="w-full"
          >
            {loading ? 'Creating...' : 'Create Family'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

