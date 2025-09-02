/* eslint-disable */
import { doc, updateDoc } from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { db } from '../db'
import { useEffect } from 'react'
import { useOnlineStatus } from '@/lib/hooks/useOnlinestatus'

export async function enqueueMarkRead(path: string, data: Record<string, any>) {
  await db.pendingWrites.add({
    kind: 'mark-read',
    path,
    data,
    ts: Date.now(),
  })
}

export async function flushPendingWrites() {
  const batch = await db.pendingWrites.toArray()
  for (const w of batch) {
    try {
      if (w.kind === 'mark-read') {
        await updateDoc(doc(firestore, w.path), w.data)
      }
      await db.pendingWrites.delete(w.id!)
    } catch {
      // stop early on connection failure to avoid hot loop
      break
    }
  }
}

export function useFlushMarkReadQueue() {
  const online = useOnlineStatus()
  useEffect(() => {
    if (!online) return
    // best-effort fire-and-forget
    flushPendingWrites()
  }, [online])
}
