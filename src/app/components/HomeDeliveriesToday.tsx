// src/app/components/HomeDeliveriesToday.tsx
'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  collection,
  query,
  where,
  onSnapshot,
  Timestamp,
  orderBy,
  Unsubscribe,
  getDocs,
  doc,
  getDoc,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { firestore, auth } from '@/lib/firebase'
import {
  markDeliveryAsReceived,
  markChildItemAsReceived,
} from '@/lib/deliveries'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { MarkDeliveryButton } from './MarkDeliveryButton'
import { MarkDeliveryItemButton } from './MarkDeliveryItemButton'
import { ReceiverNoteDialog } from './ReceiverNoteDialog'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, ChevronRight } from 'lucide-react'

type Props = {
  familyId: string | null
  presenceLoading: boolean
  familiesLoading: boolean
  showAllUsers?: boolean
}

/* ---------- user name lookup (cached) ---------- */
const userNameCache: Record<string, string> = {}

function useUserName(userId?: string) {
  const [name, setName] = useState<string>('')

  useEffect(() => {
    if (!userId) { setName(''); return }
    if (userNameCache[userId]) { setName(userNameCache[userId]); return }

    let mounted = true
    const ref = doc(firestore, 'users', userId)
    getDoc(ref)
      .then((snap) => {
        if (!mounted) return
        if (!snap.exists()) {
          userNameCache[userId] = userId
          setName(userId)
          return
        }
        const data = snap.data()
        const displayName = (data?.displayName as string) || (data?.name as string) || userId
        userNameCache[userId] = displayName
        setName(displayName)
      })
      .catch((err) => {
        console.error('useUserName getDoc error', err)
        if (!mounted) return
        userNameCache[userId] = userId
        setName(userId)
      })

    return () => { mounted = false }
  }, [userId])

  return name
}

function UserName({ userId }: { userId?: string }) {
  const name = useUserName(userId)
  if (!userId) return null
  return <>{name || userId}</>
}

/* ---------- friendly dates ---------- */
function toDate(input: any): Date | null {
  if (!input) return null
  if (input.toDate) return input.toDate()
  if (input.seconds) return new Date(input.seconds * 1000)
  if (typeof input === 'number' || typeof input === 'string') {
    const v = new Date(input)
    if (!Number.isNaN(v.getTime())) return v
  }
  return null
}

function daysDiff(a: Date, b = new Date()) {
  const _a = new Date(a.getFullYear(), a.getMonth(), a.getDate())
  const _b = new Date(b.getFullYear(), b.getMonth(), b.getDate())
  const msPerDay = 1000 * 60 * 60 * 24
  return Math.round((_a.getTime() - _b.getTime()) / msPerDay)
}

function formatTimeShort(d: Date) {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function friendlyDeliveredLabel(raw: any) {
  const d = toDate(raw)
  if (!d) return ''
  const dd = daysDiff(d)
  if (dd === 0) return `Today at ${formatTimeShort(d)}`
  if (dd === 1) return `Tomorrow at ${formatTimeShort(d)}`
  if (dd === -1) return `Yesterday at ${formatTimeShort(d)}`
  if (Math.abs(dd) <= 7) {
    return `${d.toLocaleDateString(undefined, { weekday: 'long' })} at ${formatTimeShort(d)}`
  }
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} at ${formatTimeShort(d)}`
}

function formatRelative(from: Date, to: Date) {
  const s = Math.floor((from.getTime() - to.getTime()) / 1000)
  const abs = Math.max(0, s)
  if (abs < 10) return 'a few seconds ago'
  if (abs < 60) return `${abs} seconds ago`
  const m = Math.floor(abs / 60)
  if (m === 1) return 'a minute ago'
  if (m < 60) return `${m} minutes ago`
  const h = Math.floor(m / 60)
  if (h === 1) return 'an hour ago'
  if (h < 24) return `${h} hours ago`
  const d = Math.floor(h / 24)
  if (d === 1) return 'a day ago'
  return `${d} days ago`
}

function useRelativeTime(rawDate: any) {
  const [label, setLabel] = useState<string>(() => {
    const init = toDate(rawDate)
    return init ? formatRelative(new Date(), init) : 'just now'
  })

  useEffect(() => {
    const dMaybe = toDate(rawDate)
    if (!dMaybe) { setLabel('just now'); return }
    const dd: Date = dMaybe

    function update() { setLabel(formatRelative(new Date(), dd)) }
    update()

    const diffSec = Math.abs((Date.now() - dd.getTime()) / 1000)
    let interval = 1000
    if (diffSec > 60 && diffSec <= 3600) interval = 30_000
    else if (diffSec > 3600 && diffSec <= 86400) interval = 300_000
    else if (diffSec > 86400) interval = 3600_000

    const id = setInterval(update, interval)
    return () => clearInterval(id)
  }, [rawDate])

  return label
}

/* ---------- inline notes ---------- */
function NoteRow({ note, meId }: { note: any; meId?: string }) {
  const createdLabel = useRelativeTime(note?.createdAt)
  const isMe = meId && note?.createdBy === meId
  const displayName = isMe ? 'You' : (note?.createdByName as string | undefined)
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.16 }}
      className="rounded-md border bg-background p-2"
    >
      <div className="text-xs">
        <span className="font-medium">
          {displayName ?? <UserName userId={note?.createdBy} />}
        </span>
        <span className="text-muted-foreground">{` · ${createdLabel}`}</span>
      </div>
      <div className="mt-1 text-sm whitespace-pre-wrap break-words">{note?.text}</div>
    </motion.div>
  )
}

function NotesToggle({ open, count, onClick }: { open: boolean; count: number; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onClick}>
      {open ? 'Hide notes' : `Show notes${count ? ` (${count})` : ''}`}
    </Button>
  )
}

function DeliveryNotesThreadInline({ familyId, deliveryId }: { familyId: string; deliveryId: string }) {
  const [notes, setNotes] = useState<any[]>([])
  const [text, setText] = useState('')
  const [adding, setAdding] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const me = auth.currentUser
  const meName = useUserName(me?.uid)

  useEffect(() => {
    if (!familyId || !deliveryId) return
    const notesCol = collection(firestore, 'families', familyId, 'deliveries', deliveryId, 'notes')
    const qy = query(notesCol, orderBy('createdAt', 'asc'))
    const unsub = onSnapshot(
      qy,
      (snap) => {
        setLoadError(null)
        setNotes(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))
      },
      (err) => {
        console.error('DeliveryNotes snapshot error', err)
        setLoadError('Missing or insufficient permissions')
      }
    )
    return () => unsub()
  }, [familyId, deliveryId])

  const handleAdd = async () => {
    const user = auth.currentUser
    if (!user || !text.trim()) return
    setAdding(true)
    try {
      await addDoc(collection(firestore, 'families', familyId, 'deliveries', deliveryId, 'notes'), {
        text: text.trim(),
        createdAt: serverTimestamp(),
        createdBy: user.uid,
        createdByName: meName || user.displayName || null,
        createdByPhotoURL: user.photoURL || null,
      })
      setText('')
    } catch (e) {
      console.error('Failed to add note', e)
      alert('Failed to add note')
    } finally {
      setAdding(false)
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.18 }}
      className="mt-3 border rounded p-2 bg-muted/30 overflow-hidden"
    >
      <div className="text-xs font-semibold mb-2">Notes</div>

      {loadError ? (
        <div className="text-xs text-red-500">{loadError}</div>
      ) : (
        <>
          <AnimatePresence initial={false}>
            {notes.length === 0 ? (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-xs text-muted-foreground">
                No notes yet
              </motion.div>
            ) : (
              <div className="space-y-2">
                {notes.map((n) => <NoteRow key={n.id} note={n} meId={me?.uid} />)}
              </div>
            )}
          </AnimatePresence>

          <div className="mt-2 flex items-start gap-2">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note…" className="min-h-[60px]" />
            <Button size="sm" onClick={handleAdd} disabled={adding || !text.trim()}>
              {adding ? 'Posting…' : 'Post'}
            </Button>
          </div>
        </>
      )}
    </motion.div>
  )
}

/* ---------- component ---------- */
export default function HomeDeliveriesToday({
  familyId,
  presenceLoading,
  familiesLoading,
  showAllUsers = false,
}: Props) {
  const [deliveries, setDeliveries] = useState<any[]>([]) // pending + in_transit
  const [deliveryItemsMap, setDeliveryItemsMap] = useState<Map<string, any[]>>(new Map())
  const [deliveredToday, setDeliveredToday] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [dialogOpenId, setDialogOpenId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // (Removed: home-location banner; handled in Who's Home)

  // UI toggles
  const [openNotesIds, setOpenNotesIds] = useState<Set<string>>(() => new Set())
  const [openItemsIds, setOpenItemsIds] = useState<Set<string>>(() => new Set())
  const toggleNotes = (id: string) => setOpenNotesIds(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })
  const toggleItems = (id: string) => setOpenItemsIds(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })

  const me = auth.currentUser
  const myName = useUserName(me?.uid)

  const handleReceiverNoteSubmit = async (note: string) => {
    if (!dialogOpenId || !familyId) return
    setSaving(true)
    await handleMarkDelivery(dialogOpenId, note)
    setDialogOpenId(null)
    setSaving(false)
  }

  const unsubsRef = useRef<Unsubscribe[]>([])
  const deliveredUnsubRef = useRef<Unsubscribe | null>(null)
  const itemUnsubsRef = useRef<Record<string, Unsubscribe>>({})

  const todayRange = useCallback(() => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    const end = new Date(start); end.setDate(start.getDate() + 1)
    return { start, end }
  }, [])

  useEffect(() => {
    // cleanup
    unsubsRef.current.forEach((u) => u && u())
    unsubsRef.current = []
    Object.values(itemUnsubsRef.current).forEach((u) => u && u())
    itemUnsubsRef.current = {}
    setDeliveryItemsMap(new Map())
    setDeliveries([])
    setDeliveredToday([])
    setLoading(true)

    if (!familyId) { setLoading(false); return }

    const uid = auth.currentUser?.uid ?? null
    if (!showAllUsers && !uid) {
      setDeliveries([]); setDeliveryItemsMap(new Map()); setDeliveredToday([]); setLoading(false)
      return
    }

    const { start, end } = todayRange()
    const startTs = Timestamp.fromDate(start)
    const endTs = Timestamp.fromDate(end)

    const deliveriesCol = collection(firestore, 'families', familyId, 'deliveries')

    const baseConstraints: any[] = [
      where('expectedDate', '>=', startTs),
      where('expectedDate', '<', endTs),
      where('status', 'in', ['pending', 'in_transit']),
    ]

    if (!showAllUsers && uid) baseConstraints.push(where('createdBy', '==', uid))

    const deliveriesQ = query(deliveriesCol, ...baseConstraints, orderBy('expectedDate', 'asc'))

    const deliveriesUnsub = onSnapshot(
      deliveriesQ,
      (snap) => {
        const docs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
        setDeliveries(docs)
        setLoading(false)

        const keepIds = new Set(docs.map(d => d.id))
        Object.keys(itemUnsubsRef.current).forEach((delId) => {
          if (!keepIds.has(delId)) { try { itemUnsubsRef.current[delId]() } catch {}; delete itemUnsubsRef.current[delId] }
        })

        docs.forEach((d) => {
          const isSingleByDoc = d.type === 'single'
          if (isSingleByDoc) {
            if (itemUnsubsRef.current[d.id]) { try { itemUnsubsRef.current[d.id]() } catch {}; delete itemUnsubsRef.current[d.id] }
            setDeliveryItemsMap((prev) => { const copy = new Map(prev); copy.set(d.id, []); return copy })
            return
          }
          if (itemUnsubsRef.current[d.id]) return

          const itemsCol = collection(firestore, 'families', familyId, 'deliveries', d.id, 'items')
          const allItemsQ = query(itemsCol)

          const itemsUnsub = onSnapshot(
            allItemsQ,
            (itemsSnap) => {
              const rawRows = itemsSnap.docs.map((it) => ({ id: it.id, ...(it.data() as any) }))
              const { start, end } = todayRange()
              const startMs = start.getTime(), endMs = end.getTime()

              const filtered = rawRows.filter((it) => {
                if (!['pending', 'in_transit'].includes(it.status)) return false
                if (it.expectedDate) {
                  let millis = 0
                  if (it.expectedDate?.toDate) millis = it.expectedDate.toDate().getTime()
                  else if (typeof it.expectedDate?.seconds === 'number') millis = it.expectedDate.seconds * 1000
                  else if (typeof it.expectedDate === 'number') millis = it.expectedDate
                  else if (typeof it.expectedDate === 'string') {
                    const parsed = Date.parse(it.expectedDate); if (!Number.isNaN(parsed)) millis = parsed
                  }
                  if (millis) return millis >= startMs && millis < endMs
                }
                return true
              })

              filtered.sort((a, b) => {
                const toMillis = (x: any) => {
                  if (x.expectedDate?.toDate) return x.expectedDate.toDate().getTime()
                  if (typeof x.expectedDate?.seconds === 'number') return x.expectedDate.seconds * 1000
                  if (x.createdAt?.toDate) return x.createdAt.toDate().getTime()
                  if (typeof x.createdAt?.seconds === 'number') return x.createdAt.seconds * 1000
                  return 0
                }
                return toMillis(a) - toMillis(b)
              })

              setDeliveryItemsMap((prev) => { const copy = new Map(prev); copy.set(d.id, filtered); return copy })
            },
            (err) => console.error('[HomeDeliveriesToday] (items) snapshot error', d.id, err)
          )

          itemUnsubsRef.current[d.id] = itemsUnsub
        })
      },
      (err) => { console.error('[HomeDeliveriesToday] (deliveries) snapshot error', err); setLoading(false) }
    )
    unsubsRef.current.push(deliveriesUnsub)

    // delivered today
    try {
      const deliveredQ = query(
        deliveriesCol,
        where('status', '==', 'delivered'),
        where('receivedAt', '>=', startTs),
        where('receivedAt', '<', endTs),
        orderBy('receivedAt', 'desc')
      )

      const dUnsub = onSnapshot(
        deliveredQ,
        (snap) => {
          const loadItems = async () => {
            const enriched = await Promise.all(
              snap.docs.map(async (docSnap) => {
                const data = docSnap.data()
                const itemsSnap = await getDocs(
                  collection(firestore, 'families', familyId, 'deliveries', docSnap.id, 'items')
                )
                const items = itemsSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...(itemDoc.data() as any) }))
                return { id: docSnap.id, ...(data as any), items }
              })
            )
            setDeliveredToday(enriched)
          }
          loadItems().catch((err) => console.error('[HomeDeliveriesToday] failed to load items', err))
        },
        (err) => console.error('[HomeDeliveriesToday] deliveredToday snapshot error', err)
      )

      deliveredUnsubRef.current = dUnsub
    } catch (err) {
      console.error('[HomeDeliveriesToday] failed to attach deliveredToday listener', err)
    }

    return () => {
      unsubsRef.current.forEach((u) => u && u()); unsubsRef.current = []
      if (deliveredUnsubRef.current) { try { deliveredUnsubRef.current() } catch {}; deliveredUnsubRef.current = null }
      Object.keys(itemUnsubsRef.current).forEach((k) => { try { itemUnsubsRef.current[k]() } catch {} })
      itemUnsubsRef.current = {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId, todayRange, showAllUsers])

  const handleMarkDelivery = async (deliveryId: string, receiverNote: string) => {
    if (!familyId) return
    setProcessingId(deliveryId)
    try {
      await markDeliveryAsReceived(familyId, deliveryId, undefined as any)
      const user = auth.currentUser
      if (user) {
        const text = receiverNote?.trim()
          ? receiverNote.trim()
          : `Received by ${myName || user.displayName || 'Member'}`
        await addDoc(collection(firestore, 'families', familyId, 'deliveries', deliveryId, 'notes'), {
          text, createdAt: serverTimestamp(), createdBy: user.uid,
          createdByName: myName || user.displayName || null, createdByPhotoURL: user.photoURL || null,
        })
      }
    } catch (err) {
      console.error('handleMarkDelivery', err); alert('Failed to mark delivery')
    } finally {
      setProcessingId(null); setDialogOpenId(null)
    }
  }

  const handleMarkDeliveryItem = async (deliveryId: string, itemId: string) => {
    if (!familyId) return
    setProcessingId(itemId)
    try {
      const res = await markChildItemAsReceived(familyId, 'deliveries', deliveryId, itemId)
      if (!res || res.success === false) alert(res?.message ?? 'Failed to mark item')
    } catch (err) {
      console.error('handleMarkDeliveryItem', err); alert('Failed to mark item')
    } finally {
      setProcessingId(null)
    }
  }

  // derived
  const totalDeliveries = deliveries.length
  const itemsTotalPrice = Array.from(deliveryItemsMap.values()).flat().reduce((s, it) => s + (typeof it.price === 'number' ? it.price : 0), 0)
  const pendingDeliveries = deliveries.filter(d => d.status === 'pending')
  const inTransitDeliveries = deliveries.filter(d => d.status === 'in_transit')

  if (presenceLoading || familiesLoading) return null

  if (loading) {
    return (
      <>
        <div className="h-4 w-full mb-2 bg-muted animate-pulse rounded" />
        <div className="h-4 w-5/6 bg-muted animate-pulse rounded" />
      </>
    )
  }

  if (!deliveries.length && !deliveredToday.length) {
    return <p className="text-muted-foreground text-sm">No deliveries scheduled for today.</p>
  }

  const showHeaderCod =
    totalDeliveries === 1 &&
    (deliveries[0].type === 'single' || (typeof deliveries[0].itemCount === 'number' && deliveries[0].itemCount <= 1))

  const EtaChip = ({ label }: { label?: string }) =>
    label ? <span className="text-[11px] px-2 py-0.5 rounded bg-muted text-muted-foreground border border-muted-foreground/10">ETA {label}</span> : null

  const CodChip = ({ amount }: { amount?: number | null }) =>
    amount && amount > 0 ? (
      <span className="text-[11px] px-2 py-0.5 rounded bg-muted text-muted-foreground border border-muted-foreground/10">
        COD ₱{Number(amount).toFixed(2)}
      </span>
    ) : null

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div className="flex items-center justify-between p-3 bg-card text-card-foreground border rounded">
        <div>
          <div className="text-sm font-medium">Today — Deliveries</div>
          <div className="text-xs text-muted-foreground">
            {totalDeliveries} deliver{totalDeliveries !== 1 ? 'ies' : 'y'}
            {itemsTotalPrice > 0 ? ` • Items total ₱${itemsTotalPrice.toFixed(2)}` : ''}
          </div>
        </div>
        <div className="text-right text-sm">
          {showHeaderCod && typeof deliveries[0]?.codAmount === 'number' && (
            <div className="font-medium">COD ₱{deliveries[0].codAmount.toFixed(2)}</div>
          )}
          <div className="text-xs text-muted-foreground">Live • updated</div>
        </div>
      </div>

      {/* Pending */}
      {pendingDeliveries.length > 0 && (
        <section>
          <h4 className="font-semibold mb-2">Pending</h4>
          <div className="space-y-2">
            {pendingDeliveries.map((d) => {
              const isSingleByDoc = d.type === 'single' || (typeof d.itemCount === 'number' && d.itemCount <= 1)
              const items = deliveryItemsMap.get(d.id) ?? []
              const etaStr = d.expectedDate?.toDate
                ? d.expectedDate.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : d.expectedDate?.seconds
                  ? new Date(d.expectedDate.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : ''

              const itemsCount = isSingleByDoc ? 1 : (items?.length || d.itemCount || 0)
              const codTotal = (() => {
                if (isSingleByDoc) return typeof d.codAmount === 'number' ? d.codAmount : null
                if (items && items.length > 0) return items.reduce((s: number, it: any) => s + (typeof it.price === 'number' ? it.price : 0), 0)
                if (typeof d.codAmount === 'number') return d.codAmount
                return null
              })()

              const notesOpen = openNotesIds.has(d.id)
              const itemsOpen = openItemsIds.has(d.id)

              return (
                <div key={d.id} className="rounded border bg-card text-card-foreground p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-medium text-sm truncate">
                          {d.title ?? d.name ?? d.platform ?? 'Delivery'}
                        </div>
                        {!isSingleByDoc && (
                          <Badge variant="secondary" className="h-5 px-2 text-[11px]">
                            Multiple • {itemsCount}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <EtaChip label={etaStr || undefined} />
                        <CodChip amount={codTotal ?? undefined} />
                        <span className="text-[11px] text-muted-foreground">by <UserName userId={d.createdBy} /></span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {!isSingleByDoc && itemsCount > 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => toggleItems(d.id)}
                        >
                          {itemsOpen ? <ChevronDown className="w-4 h-4 mr-1" /> : <ChevronRight className="w-4 h-4 mr-1" />}
                          {itemsOpen ? 'Hide items' : `View items (${itemsCount})`}
                        </Button>
                      )}
                      <NotesToggle open={notesOpen} count={0} onClick={() => toggleNotes(d.id)} />
                      <MarkDeliveryButton id={d.id} isProcessing={processingId === d.id} onClick={() => setDialogOpenId(d.id)} />
                    </div>
                  </div>

                  <AnimatePresence initial={false}>
                    {!isSingleByDoc && itemsOpen && items.length > 0 && (
                      <motion.div
                        key={`items-${d.id}`}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.18 }}
                        className="mt-2 space-y-2"
                      >
                        {items.map((it) => {
                          const itemEta = it.expectedDate?.toDate
                            ? it.expectedDate.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : it.expectedDate?.seconds
                              ? new Date(it.expectedDate.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                              : etaStr
                          return (
                            <div key={it.id} className="flex items-center justify-between">
                              <div className="min-w-0">
                                <div className="text-sm font-medium truncate">{it.name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {typeof it.price === 'number' ? `₱${Number(it.price).toFixed(2)}` : '—'}
                                  {itemEta ? ` · ETA ${itemEta}` : ''}
                                </div>
                              </div>
                              {it.status !== 'delivered' ? (
                                <MarkDeliveryItemButton
                                  deliveryId={d.id}
                                  itemId={it.id}
                                  isProcessing={processingId === it.id}
                                  onClick={() => handleMarkDeliveryItem(d.id, it.id)}
                                />
                              ) : (
                                <div className="text-sm text-muted-foreground" />
                              )}
                            </div>
                          )
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <AnimatePresence initial={false}>
                    {notesOpen && familyId ? (
                      <DeliveryNotesThreadInline key={`notes-${d.id}`} familyId={familyId} deliveryId={d.id} />
                    ) : null}
                  </AnimatePresence>

                  <ReceiverNoteDialog
                    open={dialogOpenId === d.id}
                    onClose={() => setDialogOpenId(null)}
                    onSubmit={handleReceiverNoteSubmit}
                    loading={saving}
                  />
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* In Transit */}
      {inTransitDeliveries.length > 0 && (
        <section>
          <h4 className="font-semibold mb-2">In Transit</h4>
          <div className="space-y-2">
            {inTransitDeliveries.map((d) => {
              const isSingleByDoc = d.type === 'single' || (typeof d.itemCount === 'number' && d.itemCount <= 1)
              const items = deliveryItemsMap.get(d.id) ?? []
              const etaStr = d.expectedDate?.toDate
                ? d.expectedDate.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : d.expectedDate?.seconds
                  ? new Date(d.expectedDate.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : ''

              const itemsCount = isSingleByDoc ? 1 : (items?.length || d.itemCount || 0)
              const codTotal = (() => {
                if (isSingleByDoc) return typeof d.codAmount === 'number' ? d.codAmount : null
                if (items && items.length > 0) return items.reduce((s: number, it: any) => s + (typeof it.price === 'number' ? it.price : 0), 0)
                if (typeof d.codAmount === 'number') return d.codAmount
                return null
              })()

              const notesOpen = openNotesIds.has(d.id)
              const itemsOpen = openItemsIds.has(d.id)

              return (
                <div key={d.id} className="rounded border bg-card text-card-foreground p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-medium text-sm truncate">
                          {d.title ?? d.name ?? d.platform ?? 'Delivery'}
                        </div>
                        {!isSingleByDoc && (
                          <Badge variant="secondary" className="h-5 px-2 text-[11px]">
                            Multiple • {itemsCount}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <EtaChip label={etaStr || undefined} />
                        <CodChip amount={codTotal ?? undefined} />
                        <span className="text-[11px] text-muted-foreground">by <UserName userId={d.createdBy} /></span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {!isSingleByDoc && itemsCount > 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => toggleItems(d.id)}
                        >
                          {itemsOpen ? <ChevronDown className="w-4 h-4 mr-1" /> : <ChevronRight className="w-4 h-4 mr-1" />}
                          {itemsOpen ? 'Hide items' : `View items (${itemsCount})`}
                        </Button>
                      )}
                      <NotesToggle open={notesOpen} count={0} onClick={() => toggleNotes(d.id)} />
                      <MarkDeliveryButton id={d.id} isProcessing={processingId === d.id} onClick={() => setDialogOpenId(d.id)} />
                    </div>
                  </div>

                  <AnimatePresence initial={false}>
                    {!isSingleByDoc && itemsOpen && items.length > 0 && (
                      <motion.div
                        key={`items-${d.id}`}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.18 }}
                        className="mt-2 space-y-2"
                      >
                        {items.map((it) => {
                          const itemEta = it.expectedDate?.toDate
                            ? it.expectedDate.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : it.expectedDate?.seconds
                              ? new Date(it.expectedDate.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                              : etaStr
                          return (
                            <div key={it.id} className="flex items-center justify-between">
                              <div className="min-w-0">
                                <div className="text-sm font-medium truncate">{it.name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {typeof it.price === 'number' ? `₱${Number(it.price).toFixed(2)}` : '—'}
                                  {itemEta ? ` · ETA ${itemEta}` : ''}
                                </div>
                              </div>
                              {it.status !== 'delivered' ? (
                                <Button type="button" size="sm" onClick={() => handleMarkDeliveryItem(d.id, it.id)} disabled={processingId === it.id}>
                                  {processingId === it.id ? 'Saving…' : 'Mark as Received'}
                                </Button>
                              ) : (
                                <div className="text-sm text-muted-foreground" />
                              )}
                            </div>
                          )
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <AnimatePresence initial={false}>
                    {notesOpen && familyId ? (
                      <DeliveryNotesThreadInline key={`notes-${d.id}`} familyId={familyId} deliveryId={d.id} />
                    ) : null}
                  </AnimatePresence>

                  <ReceiverNoteDialog
                    open={dialogOpenId === d.id}
                    onClose={() => setDialogOpenId(null)}
                    onSubmit={handleReceiverNoteSubmit}
                    loading={saving}
                  />
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Delivered Today */}
      {deliveredToday.length > 0 && (
        <section>
          <h4 className="font-semibold mb-2">Delivered Today</h4>
          <div className="space-y-2">
            {deliveredToday.map((d) => {
              const receivedAtStr = d.receivedAt ? friendlyDeliveredLabel(d.receivedAt) : ''
              const isSingle = d.type === 'single' || (typeof d.itemCount === 'number' && d.itemCount <= 1)
              const codTotal = (() => {
                if (isSingle) return typeof d.codAmount === 'number' ? d.codAmount : null
                if (d.items && d.items.length > 0) return d.items.reduce((s: number, it: any) => s + (typeof it.price === 'number' ? it.price : 0), 0)
                if (typeof d.codAmount === 'number') return d.codAmount
                return null
              })()

              const notesOpen = openNotesIds.has(d.id)

              return (
                <div key={d.id} className="rounded border bg-card text-card-foreground p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{d.title ?? d.name ?? 'Delivery'}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {codTotal != null && codTotal > 0 && (
                          <span className="text-[11px] px-2 py-0.5 rounded bg-muted text-muted-foreground border border-muted-foreground/10">
                            COD ₱{Number(codTotal).toFixed(2)}
                          </span>
                        )}
                        <span className="text-[11px] text-muted-foreground">
                          {d.receivedBy ? <>Received by <UserName userId={d.receivedBy} /></> : 'Received'}
                          {receivedAtStr ? ` • ${receivedAtStr}` : ''}
                        </span>
                      </div>
                    </div>

                    <NotesToggle open={notesOpen} count={0} onClick={() => toggleNotes(d.id)} />
                  </div>

                  <AnimatePresence initial={false}>
                    {notesOpen && familyId ? (
                      <DeliveryNotesThreadInline key={`notes-${d.id}`} familyId={familyId} deliveryId={d.id} />
                    ) : null}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
