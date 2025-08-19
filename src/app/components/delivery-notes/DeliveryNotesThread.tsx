'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { Skeleton } from '@/components/ui/skeleton'
import DeliveryNoteItem, { DeliveryNoteDoc } from './DeliveryNoteItem'
import DeliveryNoteComposer from './DeliveryNoteComposer'
import { AnimatePresence, motion } from 'framer-motion'

export default function DeliveryNotesThread({
  familyId,
  deliveryId,
}: {
  familyId: string
  deliveryId: string
}) {
  const [notes, setNotes] = useState<DeliveryNoteDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)

    const qy = query(
      collection(firestore, 'families', familyId, 'deliveries', deliveryId, 'notes'),
      orderBy('createdAt', 'asc')
    )

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const list: DeliveryNoteDoc[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
        setNotes(list)
        setLoading(false)
        setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50)
      },
      (err) => {
        console.error('DeliveryNotes snapshot error', err)
        // Show a friendly message and stop listening
        const msg =
          (err as any)?.code === 'permission-denied'
            ? 'You do not have access to notes for this delivery.'
            : 'Notes are unavailable right now.'
        setError(msg)
        setLoading(false)
      }
    )
    return () => unsub()
  }, [familyId, deliveryId])

  const onPosted = useCallback(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [])

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-sm p-3">
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-1">
        <AnimatePresence initial={false}>
          {notes.map((n) => (
            <DeliveryNoteItem key={n.id} familyId={familyId} deliveryId={deliveryId} note={n} />
          ))}
        </AnimatePresence>
        <div ref={endRef} />
      </div>

      <motion.div layout>
        <DeliveryNoteComposer familyId={familyId} deliveryId={deliveryId} onPosted={onPosted} />
      </motion.div>
    </div>
  )
}
