'use client'

import { useEffect, useRef, useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Send } from 'lucide-react'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { useAuth } from '@/lib/useAuth'
import { toast } from 'sonner'

type Props = {
  familyId: string
  deliveryId: string
  onPosted?: () => void
}

export default function DeliveryNoteComposer({ familyId, deliveryId, onPosted }: Props) {
  const { user } = useAuth()
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const taRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => { taRef.current?.focus() }, [])

  async function postNote() {
    const value = text.trim()
    if (!value || !user?.uid) return
    setSubmitting(true)
    try {
      await addDoc(collection(firestore, 'families', familyId, 'deliveries', deliveryId, 'notes'), {
        text: value,
        createdAt: serverTimestamp(),
        createdBy: user.uid,
        createdByName: user.name || user.email || 'Member',
        createdByPhotoURL: user.photoURL || null,
        editedAt: null,
        editedBy: null,
      })
      setText('')
      onPosted?.()
    } catch (e) {
      console.error('postNote failed', e)
      toast.error('Could not post note.')
    } finally {
      setSubmitting(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      postNote()
    }
  }

  return (
    <div className="rounded-lg border bg-card text-card-foreground p-3 sm:p-4">
      <Textarea
        ref={taRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Write a note… (Enter to send, Shift+Enter for newline)"
        className="min-h-[72px] resize-y"
        disabled={submitting}
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          Press <kbd className="px-1 py-0.5 border rounded">Enter</kbd> to send
        </span>
        <Button size="sm" onClick={postNote} disabled={submitting || !text.trim()}>
          <Send className="h-4 w-4 mr-1.5" />
          Post
        </Button>
      </div>
    </div>
  )
}

