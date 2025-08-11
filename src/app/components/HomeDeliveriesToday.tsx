// src/app/(whatever)/components/HomeDeliveriesToday.tsx
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
  QuerySnapshot,
  DocumentData,
  doc,
  getDoc,
} from 'firebase/firestore'
import { firestore, auth } from '@/lib/firebase'
import {
  markDeliveryAsReceived,
  markChildItemAsReceived,
} from '@/lib/deliveries'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DeliveryNotesDialog } from './DialogBasedNotesViewer'
import { MarkDeliveryButton } from './MarkDeliveryButton'
import { MarkDeliveryItemButton } from './MarkDeliveryItemButton'
import { ReceiverNoteDialog } from './ReceiverNoteDialog'

type Props = {
  familyId: string | null
  presenceLoading: boolean
  familiesLoading: boolean
  /** If true, show deliveries for ALL users in the family. If false, show only current user's deliveries. */
  showAllUsers?: boolean
}

/* ----------------------------
   User name lookup (cached)
   ---------------------------- */
const userNameCache: Record<string, string> = {}


function useUserName(userId?: string) {
  const [name, setName] = useState<string>('')

  useEffect(() => {
    if (!userId) {
      setName('')
      return
    }
    if (userNameCache[userId]) {
      setName(userNameCache[userId])
      return
    }

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

    return () => {
      mounted = false
    }
  }, [userId])

  return name
}

function UserName({ userId }: { userId?: string }) {
  const name = useUserName(userId)
  if (!userId) return null
  return <>{name || userId}</>
}

/* ----------------------------
   Friendly date helpers
   ---------------------------- */
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

/* ----------------------------
   Helpers for delivery meta
   ---------------------------- */
function deliveryTypeLabel(d: any) {
  // return 'Multiple' or 'Single'
  const isSingle = d.type === 'single' || (typeof d.itemCount === 'number' && d.itemCount <= 1)
  return isSingle ? 'Single' : 'Multiple'
}

function deliveryCodTotal(d: any, items: any[]) {
  // For single deliveries prefer d.codAmount
  console.log('Type', d.type)
  const isSingle = d.type === 'single' || (typeof d.itemCount === 'number' && d.itemCount <= 1)
  if (isSingle) {
    if (typeof d.codAmount === 'number') return d.codAmount
    return null
  }

  // For multiple: sum item prices if available
  console.log('items', items)
  if (items && items.length > 0) {
    const sum = items.reduce((s: number, it: any) => s + (typeof it.price === 'number' ? it.price : 0), 0)
    return sum
  }

  // Fallback to delivery-level codAmount if set
  if (typeof d.codAmount === 'number') return d.codAmount
  return null
}

/* ----------------------------
   Component
   ---------------------------- */
export default function HomeDeliveriesToday({
  familyId,
  presenceLoading,
  familiesLoading,
  showAllUsers = false,
}: Props) {
  // console.log for debugging
  console.log('[HomeDeliveriesToday] mounted', { familyId, presenceLoading, familiesLoading, showAllUsers })

  const [deliveries, setDeliveries] = useState<any[]>([]) // pending + in_transit
  const [deliveryItemsMap, setDeliveryItemsMap] = useState<Map<string, any[]>>(new Map())
  const [deliveredToday, setDeliveredToday] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [dialogOpenId, setDialogOpenId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

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
    const end = new Date(start)
    end.setDate(start.getDate() + 1)
    return { start, end }
  }, [])

  useEffect(() => {
    // cleanup previous listeners
    unsubsRef.current.forEach((u) => u && u())
    unsubsRef.current = []
    Object.values(itemUnsubsRef.current).forEach((u) => u && u())
    itemUnsubsRef.current = {}
    setDeliveryItemsMap(new Map())
    setDeliveries([])
    setDeliveredToday([])
    setLoading(true)

    if (!familyId) {
      setLoading(false)
      console.log('[HomeDeliveriesToday] no familyId — exiting effect early')
      return
    }

    const uid = auth.currentUser?.uid ?? null
    if (!showAllUsers && !uid) {
      // not authenticated and we are requested to show only current user's deliveries:
      setDeliveries([])
      setDeliveryItemsMap(new Map())
      setDeliveredToday([])
      setLoading(false)
      console.log('[HomeDeliveriesToday] no uid and showAllUsers=false — exiting effect early')
      return
    }

    const { start, end } = todayRange()
    const startTs = Timestamp.fromDate(start)
    const endTs = Timestamp.fromDate(end)

    const deliveriesCol = collection(firestore, 'families', familyId, 'deliveries')

    // base constraints for pending/in_transit deliveries
    const baseConstraints: any[] = [
      where('expectedDate', '>=', startTs),
      where('expectedDate', '<', endTs),
      where('status', 'in', ['pending', 'in_transit']),
    ]

    if (!showAllUsers && uid) {
      baseConstraints.push(where('createdBy', '==', uid))
    }

    const deliveriesQ = query(deliveriesCol, ...baseConstraints, orderBy('expectedDate', 'asc'))

      // diagnostic fetch (non-blocking)
      ; (async () => {
        try {
          console.log('[HomeDeliveriesToday] diagnostic getDocs: fetching deliveries once (pending/in_transit)')
          const snap: QuerySnapshot<DocumentData> = await getDocs(deliveriesQ)
          const docs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
          console.log('[HomeDeliveriesToday] diagnostic getDocs result', { count: docs.length, ids: docs.map(x => x.id), docs })
        } catch (err) {
          console.error('[HomeDeliveriesToday] diagnostic getDocs error', err)
        }
      })()

    // subscribe to pending/in_transit deliveries
    const deliveriesUnsub = onSnapshot(
      deliveriesQ,
      (snap) => {
        const docs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
        console.log('[HomeDeliveriesToday] deliveries snapshot', { count: docs.length, ids: docs.map((x) => x.id) })
        setDeliveries(docs)
        setLoading(false)

        // tear down item listeners for deliveries we no longer track
        const keepIds = new Set(docs.map(d => d.id))

        // remove item listeners that are not in keepIds
        Object.keys(itemUnsubsRef.current).forEach((delId) => {
          if (!keepIds.has(delId)) {
            try { itemUnsubsRef.current[delId]() } catch (e) { /* ignore */ }
            delete itemUnsubsRef.current[delId]
            console.log('[HomeDeliveriesToday] removed item listener for delivery', delId)
          }
        })

        // attach listeners for current deliveries (subscribe to full items and filter client-side)
        docs.forEach((d) => {
          // Determine single vs grouped using delivery doc's fields first
          const isSingleByDoc = d.type === 'single'
          //const isSingleByDoc = d.type === 'single' || (typeof d.itemCount === 'number' && d.itemCount <= 1)

          // For single deliveries we do not subscribe to items (UI will show delivery-level fields)
          if (isSingleByDoc) {
            // ensure there's no existing items listener
            if (itemUnsubsRef.current[d.id]) {
              try { itemUnsubsRef.current[d.id]() } catch { /* ignore */ }
              delete itemUnsubsRef.current[d.id]
            }
            // set empty array so UI treats it as single
            setDeliveryItemsMap((prev) => {
              const copy = new Map(prev)
              copy.set(d.id, [])
              return copy
            })
            console.log('[HomeDeliveriesToday] treating delivery as single (no items subscription)', d.id)
            return
          }

          if (itemUnsubsRef.current[d.id]) {
            // already listening (grouped)
            return
          }

          const itemsCol = collection(firestore, 'families', familyId, 'deliveries', d.id, 'items')
          const allItemsQ = query(itemsCol) // subscribe to all items then filter client-side

          const itemsUnsub = onSnapshot(
            allItemsQ,
            (itemsSnap) => {
              const rawRows = itemsSnap.docs.map((it) => ({ id: it.id, ...(it.data() as any) }))
              console.log('[HomeDeliveriesToday] raw items for delivery', d.id, {
                count: rawRows.length,
                sample: rawRows.slice(0, 10).map(r => ({ id: r.id, name: r.name, expectedDate: r.expectedDate, status: r.status })),
              })

              // client-side filtering: include items with no/invalid expectedDate (don't silently hide)
              const filtered = rawRows.filter((it) => {
                if (!['pending', 'in_transit'].includes(it.status)) return false

                if (it.expectedDate) {
                  let millis = 0
                  if (it.expectedDate?.toDate) millis = it.expectedDate.toDate().getTime()
                  else if (typeof it.expectedDate?.seconds === 'number') millis = it.expectedDate.seconds * 1000
                  else if (typeof it.expectedDate === 'number') millis = it.expectedDate
                  else if (typeof it.expectedDate === 'string') {
                    const parsed = Date.parse(it.expectedDate)
                    if (!Number.isNaN(parsed)) millis = parsed
                  }

                  // if expectedDate present & parseable, keep only if in range
                  if (millis) {
                    if (millis < startTs.toMillis() || millis >= endTs.toMillis()) return false
                  } else {
                    // expectedDate present but unparseable -> include (we changed behavior to include)
                    return true
                  }
                } else {
                  // no expectedDate -> include
                }
                return true
              })

              // sort filtered: expectedDate then createdAt
              filtered.sort((a, b) => {
                const toMillis = (x: any) => {
                  if (x.expectedDate?.toDate) return x.expectedDate.toDate().getTime()
                  if (typeof x.expectedDate?.seconds === 'number') return x.expectedDate.seconds * 1000
                  if (typeof x.expectedDate === 'string') {
                    const p = Date.parse(x.expectedDate)
                    if (!Number.isNaN(p)) return p
                  }
                  if (x.createdAt?.toDate) return x.createdAt.toDate().getTime()
                  if (typeof x.createdAt?.seconds === 'number') return x.createdAt.seconds * 1000
                  return 0
                }
                return toMillis(a) - toMillis(b)
              })

              setDeliveryItemsMap((prev) => {
                const copy = new Map(prev)
                copy.set(d.id, filtered)
                return copy
              })

              console.log('[HomeDeliveriesToday] filtered items for delivery', d.id, { count: filtered.length, ids: filtered.map(f => f.id) })
            },
            (err) => {
              console.error('[HomeDeliveriesToday] (items) snapshot error', d.id, err)
            }
          )

          itemUnsubsRef.current[d.id] = itemsUnsub
          console.log('[HomeDeliveriesToday] attached items listener for delivery', d.id)
        })
      },
      (err) => {
        console.error('[HomeDeliveriesToday] (deliveries) snapshot error', err)
        setLoading(false)
      }
    )

    unsubsRef.current.push(deliveriesUnsub)
    console.log('[HomeDeliveriesToday] attached deliveries listener for family', familyId)

    // --- delivered today listener (separate) ---
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
          // ✅ Wrap async logic in an inner function
          const loadItems = async () => {
            const enriched = await Promise.all(
              snap.docs.map(async (doc) => {
                const data = doc.data()
                const itemsSnap = await getDocs(
                  collection(firestore, 'families', familyId, 'deliveries', doc.id, 'items')
                )
                const items = itemsSnap.docs.map((itemDoc) => ({
                  id: itemDoc.id,
                  ...(itemDoc.data() as any),
                }))
                return {
                  id: doc.id,
                  ...(data as any),
                  items,
                }
              })
            )
            setDeliveredToday(enriched)
            console.log('[HomeDeliveriesToday] deliveredToday snapshot', {
              count: enriched.length,
              ids: enriched.map((x) => x.id),
            })
          }

          // ✅ Call the async function
          loadItems().catch((err) => {
            console.error('[HomeDeliveriesToday] failed to load items', err)
          })
        },
        (err) => {
          console.error('[HomeDeliveriesToday] deliveredToday snapshot error', err)
        }
      )

      deliveredUnsubRef.current = dUnsub
      console.log('[HomeDeliveriesToday] attached deliveredToday listener for family', familyId)
    } catch (err) {
      console.error('[HomeDeliveriesToday] failed to attach deliveredToday listener', err)
    }

    return () => {
      console.log('[HomeDeliveriesToday] cleaning up listeners')
      unsubsRef.current.forEach((u) => u && u())
      unsubsRef.current = []
      if (deliveredUnsubRef.current) {
        try { deliveredUnsubRef.current() } catch (e) { }
        deliveredUnsubRef.current = null
      }
      Object.keys(itemUnsubsRef.current).forEach((k) => {
        try { itemUnsubsRef.current[k]() } catch (e) { }
      })
      itemUnsubsRef.current = {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId, todayRange, showAllUsers])

  const handleMarkDelivery = async (deliveryId: string, receiverNote: string) => {
    if (!familyId) return
    setProcessingId(deliveryId)
    try {
      const res = await markDeliveryAsReceived(familyId, deliveryId, receiverNote)
      if (!res || res.success === false) {
        alert(res?.message ?? 'Failed to mark delivery')
      }
    } catch (err) {
      console.error('handleMarkDelivery', err)
      alert('Failed to mark delivery')
    } finally {
      setProcessingId(null)
      setDialogOpenId(null)
    }
  }

  const handleMarkDeliveryItem = async (deliveryId: string, itemId: string) => {
    if (!familyId) return
    setProcessingId(itemId)
    try {
      const res = await markChildItemAsReceived(familyId, 'deliveries', deliveryId, itemId)
      if (!res || res.success === false) {
        alert(res?.message ?? 'Failed to mark item')
      }
    } catch (err) {
      console.error('handleMarkDeliveryItem', err)
      alert('Failed to mark item')
    } finally {
      setProcessingId(null)
    }
  }



  // Derived metrics
  const totalDeliveries = deliveries.length
  // totalItems & totals kept for internal totals, but we don't show item counts in the summary as requested
  const totalItems = Array.from(deliveryItemsMap.values()).reduce((s, arr) => s + arr.length, 0)
  const itemsTotalPrice = Array.from(deliveryItemsMap.values()).flat().reduce((s, it) => s + (typeof it.price === 'number' ? it.price : 0), 0)

  const pendingDeliveries = deliveries.filter(d => d.status === 'pending')
  const inTransitDeliveries = deliveries.filter(d => d.status === 'in_transit')

  // skeleton / early returns
  if (presenceLoading || familiesLoading) return null

  if (loading) {
    return (
      <>
        <div className="h-4 w-full mb-2 bg-gray-100 animate-pulse rounded" />
        <div className="h-4 w-5/6 bg-gray-100 animate-pulse rounded" />
      </>
    )
  }

  if (!deliveries.length && !deliveredToday.length) {
    return <p className="text-muted-foreground text-sm">No deliveries scheduled for today.</p>
  }

  // Determine header COD display: only show if exactly 1 delivery and that delivery is single
  const showHeaderCod = totalDeliveries === 1 && (deliveries[0].type === 'single' || (typeof deliveries[0].itemCount === 'number' && deliveries[0].itemCount <= 1))

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div className="flex items-center justify-between p-3 bg-muted/5 rounded">
        <div>
          <div className="text-sm font-medium">Today — Deliveries</div>
          <div className="text-xs text-muted-foreground">
            {totalDeliveries} deliver{totalDeliveries !== 1 ? 'ies' : 'y'}
            {/* intentionally removed item counts as requested */}
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

      {/* Pending section */}
      <section>
        <h4 className="font-semibold">Pending</h4>
        {pendingDeliveries.length === 0 ? (
          <div className="text-muted-foreground text-sm">No pending deliveries</div>
        ) : (
          <div className="space-y-3">
            {pendingDeliveries.map((d) => {
              const isSingleByDoc = d.type === 'single' || (typeof d.itemCount === 'number' && d.itemCount <= 1)
              const items = deliveryItemsMap.get(d.id) ?? []
              const etaStr = d.expectedDate?.toDate
                ? d.expectedDate.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : d.expectedDate?.seconds
                  ? new Date(d.expectedDate.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : ''

              const typeLabel = deliveryTypeLabel(d)
              const codTotal = deliveryCodTotal(d, items)

              console.log('P cod total', codTotal)
              console.log('DeliveryItemsMap', items)

              console.log('Rendering delivery', d.id, {
                hasItems: deliveryItemsMap.has(d.id),
                items: deliveryItemsMap.get(d.id),
              })

              // Grouped deliveries (show items)
              if (!isSingleByDoc && items.length > 0) {
                return (
                  <div key={d.id} className="border rounded p-3 bg-white">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <div className="font-semibold text-sm">{d.title ?? d.platform ?? 'Delivery'}</div>
                        </div>

                        {/* Ordered by */}
                        <div className="text-xs text-muted-foreground mt-1">
                          Ordered by: <UserName userId={d.createdBy} />
                        </div>

                        {/* Notes */}
                        <DeliveryNotesDialog note={d.note} receiverNote={d.receiverNote} />

                        {/* Badges: Type + COD */}
                        <div className="flex gap-2 mt-2">
                          <Badge variant="secondary" className="text-xs">{typeLabel}</Badge>
                          {codTotal != null && codTotal > 0 ? (
                            <Badge className="text-xs border-green-200 bg-emerald-50 text-emerald-800">{`COD ₱${Number(codTotal).toFixed(2)}`}</Badge>
                          ) : (
                            <Badge className="text-xs border-gray-200 text-muted-foreground">COD —</Badge>
                          )}
                        </div>
                      </div>
                      <div>
                        <MarkDeliveryButton
                          id={d.id}
                          isProcessing={processingId === d.id}
                          onClick={() => setDialogOpenId(d.id)}
                        />
                      </div>
                      <ReceiverNoteDialog
                        open={!!dialogOpenId}
                        onClose={() => setDialogOpenId(null)}
                        onSubmit={handleReceiverNoteSubmit}
                        loading={saving}
                      />
                    </div>

                    <div className="mt-3 space-y-2">
                      {items.map((it) => {
                        const itemEta = it.expectedDate?.toDate
                          ? it.expectedDate.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                          : it.expectedDate?.seconds
                            ? new Date(it.expectedDate.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : etaStr

                        return (
                          <div key={it.id} className="flex items-center justify-between">
                            <div>
                              <div className="font-medium text-sm">{it.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {it.price != null ? `₱${Number(it.price).toFixed(2)}` : '—'}
                                {itemEta ? ` · ETA ${itemEta}` : ''}
                              </div>
                            </div>
                            <div>
                              {it.status !== 'delivered' ? (
                                <MarkDeliveryItemButton
                                  deliveryId={d.id}
                                  itemId={it.id}
                                  isProcessing={processingId === it.id}
                                  onClick={() => handleMarkDeliveryItem(d.id, it.id)}
                                />
                              ) : (
                                <div className="text-sm text-muted-foreground">{/* delivered - intentionally minimal */}</div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              }

              // flat delivery rendering (single delivery or no items to show)
              return (
                <div key={d.id} className="flex items-center justify-between bg-white border rounded p-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="font-medium text-sm">{d.title ?? d.name ?? 'Delivery'}</div>
                    </div>

                    {/* Ordered by */}
                    <div className="text-xs text-muted-foreground mt-1">
                      Ordered by: <UserName userId={d.createdBy} />
                    </div>

                    {/* Notes */}
                    <DeliveryNotesDialog note={d.note} receiverNote={d.receiverNote} />

                    {/* Badges: Type + COD */}
                    <div className="flex gap-2 mt-2">
                      <Badge variant="secondary" className="text-xs">{typeLabel}</Badge>
                      {codTotal != null && codTotal > 0 ? (
                        <Badge className="text-xs border-green-200 bg-emerald-50 text-emerald-800">{`COD ₱${Number(codTotal).toFixed(2)}`}</Badge>
                      ) : (
                        <Badge className="text-xs border-gray-200 text-muted-foreground">COD —</Badge>
                      )}
                      {etaStr ? <span className="text-xs text-muted-foreground self-center">· ETA {etaStr}</span> : null}
                    </div>
                  </div>

                  <div>
                    <MarkDeliveryButton
                      id={d.id}
                      isProcessing={processingId === d.id}
                      onClick={() => setDialogOpenId(d.id)}
                    />
                  </div>
                  <ReceiverNoteDialog
                    open={!!dialogOpenId}
                    onClose={() => setDialogOpenId(null)}
                    onSubmit={handleReceiverNoteSubmit}
                    loading={saving}
                  />
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* In Transit section */}
      <section>
        <h4 className="font-semibold">In Transit</h4>
        {inTransitDeliveries.length === 0 ? (
          <div className="text-muted-foreground text-sm">No in-transit deliveries</div>
        ) : (
          <div className="space-y-3">
            {inTransitDeliveries.map((d) => {
              const isSingleByDoc = d.type === 'single' || (typeof d.itemCount === 'number' && d.itemCount <= 1)
              const items = deliveryItemsMap.get(d.id) ?? []
              const etaStr = d.expectedDate?.toDate
                ? d.expectedDate.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : d.expectedDate?.seconds
                  ? new Date(d.expectedDate.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : ''

              const typeLabel = deliveryTypeLabel(d)
              const codTotal = deliveryCodTotal(d, items)

              if (!isSingleByDoc && items.length > 0) {
                return (
                  <div key={d.id} className="border rounded p-3 bg-white">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <div className="font-semibold text-sm">{d.title ?? d.platform ?? 'Delivery'}</div>
                        </div>

                        <div className="text-xs text-muted-foreground mt-1">
                          Ordered by: <UserName userId={d.createdBy} />
                        </div>

                        <div className="flex gap-2 mt-2">
                          <Badge variant="secondary" className="text-xs">{typeLabel}</Badge>
                          {codTotal != null && codTotal > 0 ? (
                            <Badge className="text-xs border-green-200 bg-emerald-50 text-emerald-800">{`COD ₱${Number(codTotal).toFixed(2)}`}</Badge>
                          ) : (
                            <Badge className="text-xs border-gray-200 text-muted-foreground">COD —</Badge>
                          )}
                        </div>
                      </div>
                      <div>
                        <Button type="button" size="sm" onClick={() => handleMarkDelivery(d.id, d.note)} disabled={processingId === d.id}>
                          {processingId === d.id ? 'Saving…' : 'Mark delivery received'}
                        </Button>
                      </div>
                    </div>

                    <div className="mt-3 space-y-2">
                      {items.map((it) => {
                        const itemEta = it.expectedDate?.toDate
                          ? it.expectedDate.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                          : it.expectedDate?.seconds
                            ? new Date(it.expectedDate.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : etaStr

                        return (
                          <div key={it.id} className="flex items-center justify-between">
                            <div>
                              <div className="font-medium text-sm">{it.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {it.price != null ? `₱${Number(it.price).toFixed(2)}` : '—'}
                                {itemEta ? ` · ETA ${itemEta}` : ''}
                              </div>
                            </div>
                            <div>
                              {it.status !== 'delivered' ? (
                                <Button type="button" size="sm" onClick={() => handleMarkDeliveryItem(d.id, it.id)} disabled={processingId === it.id}>
                                  {processingId === it.id ? 'Saving…' : 'Mark as Received'}
                                </Button>
                              ) : (
                                <div className="text-sm text-muted-foreground">{/* delivered minimal */}</div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              }

              return (
                <div key={d.id} className="flex items-center justify-between bg-white border rounded p-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="font-medium text-sm">{d.title ?? d.name ?? 'Delivery'}</div>
                    </div>

                    <div className="text-xs text-muted-foreground mt-1">
                      Ordered by: <UserName userId={d.createdBy} />
                    </div>

                    <DeliveryNotesDialog note={d.note} receiverNote={d.receiverNote} />

                    <div className="flex gap-2 mt-2">
                      <Badge variant="secondary" className="text-xs">{typeLabel}</Badge>
                      {codTotal != null && codTotal > 0 ? (
                        <Badge className="text-xs border-green-200 bg-emerald-50 text-emerald-800">{`COD ₱${Number(codTotal).toFixed(2)}`}</Badge>
                      ) : (
                        <Badge className="text-xs border-gray-200 text-muted-foreground">COD —</Badge>
                      )}
                      {etaStr ? <span className="text-xs text-muted-foreground self-center">· ETA {etaStr}</span> : null}
                    </div>
                  </div>

                  <div>
                    <MarkDeliveryButton
                      id={d.id}
                      isProcessing={processingId === d.id}
                      onClick={() => setDialogOpenId(d.id)}
                    />
                  </div>
                  <ReceiverNoteDialog
                    open={!!dialogOpenId}
                    onClose={() => setDialogOpenId(null)}
                    onSubmit={handleReceiverNoteSubmit}
                    loading={saving}
                  />
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Delivered Today section */}
      <section>
        <h4 className="font-semibold">Delivered Today</h4>
        {deliveredToday.length === 0 ? (
          <div className="text-muted-foreground text-sm">No deliveries marked delivered today</div>
        ) : (
          <div className="space-y-2">
            {deliveredToday.map((d) => {
              const receivedAtStr = d.receivedAt ? friendlyDeliveredLabel(d.receivedAt) : ''
              const typeLabel = deliveryTypeLabel(d)
              const codTotal = deliveryCodTotal(d, d.items)

              console.log('Delivered Today', d)

              return (
                <div key={d.id} className="flex items-center justify-between bg-white border rounded p-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="font-medium text-sm">{d.title ?? d.name ?? 'Delivery'}</div>
                    </div>

                    {/* Ordered by */}
                    <div className="text-xs text-muted-foreground mt-1">
                      Ordered by: <UserName userId={d.createdBy} />
                    </div>

                    {/* Notes */}
                    <DeliveryNotesDialog note={d.note} receiverNote={d.receiverNote} />

                    {/* Badges */}
                    <div className="flex gap-2 mt-2">
                      <Badge variant="secondary" className="text-xs">{typeLabel}</Badge>

                      {codTotal != null && codTotal > 0 ? (
                        <Badge className="text-xs border-green-200 bg-emerald-50 text-emerald-800">{`COD ₱${Number(codTotal).toFixed(2)}`}</Badge>
                      ) : (
                        <Badge className="text-xs border-gray-200 text-muted-foreground">COD —</Badge>
                      )}
                    </div>

                    {/* Received by line below */}
                    <div className="text-xs text-muted-foreground mt-2">
                      {d.receivedBy
                        ? <>Received by <UserName userId={d.receivedBy} />{receivedAtStr ? ` · ${receivedAtStr}` : ''}</>
                        : (receivedAtStr ? receivedAtStr : 'Received')}
                    </div>
                  </div>

                  {/* keep minimal trailing info */}
                  <div className="text-xs text-muted-foreground">{/* intentionally blank to be minimal */}</div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
