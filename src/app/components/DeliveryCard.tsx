'use client'

import React, { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import {
  markOrderAsDelivered,
  markDeliveryAsReceived,
  subscribeToItems,
  markChildItemAsReceived,
} from '@/lib/deliveries'
import { doc, updateDoc, getDoc } from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Check, Trash2 } from 'lucide-react'

type Props = {
  familyId: string
  order?: any
  delivery?: any
  /** optional trash icon trigger (parent handles confirm) */
  onDelete?: () => void
}

type Status = 'pending' | 'in_transit' | 'delivered' | 'cancelled'

/* ---------- name lookup cache ---------- */
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
        const data = snap.data() as any
        const displayName = data?.displayName || data?.name || userId
        userNameCache[userId] = displayName
        setName(displayName)
      })
      .catch(() => {
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

/* ---------- date helpers (unchanged) ---------- */
function toDate(input: any): Date | null {
  if (!input) return null
  if (typeof input?.toDate === 'function') return input.toDate()
  if (input?.seconds) return new Date(input.seconds * 1000)
  if (typeof input === 'string' || typeof input === 'number') {
    const d = new Date(input)
    return isNaN(d.getTime()) ? null : d
  }
  return null
}
function daysDiff(a: Date, b = new Date()) {
  const _a = new Date(a.getFullYear(), a.getMonth(), a.getDate())
  const _b = new Date(b.getFullYear(), b.getMonth(), b.getDate())
  const msPerDay = 1000 * 60 * 60 * 24
  return Math.round((_a.getTime() - _b.getTime()) / msPerDay)
}
function monthsDiff(a: Date, b = new Date()) {
  return (a.getFullYear() - b.getFullYear()) * 12 + (a.getMonth() - b.getMonth())
}
function formatTimeShort(d: Date) {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
function shortDate(d: Date) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
function friendlyExpectedLabel(raw: any) {
  const d = raw instanceof Date ? raw : toDate(raw)
  if (!d) return ''
  const dd = daysDiff(d)
  if (dd === 0) return `Today, ${formatTimeShort(d)}`
  if (dd === 1) return `Tomorrow, ${formatTimeShort(d)}`
  if (dd === -1) return `Yesterday, ${formatTimeShort(d)}`
  if (Math.abs(dd) <= 7) {
    return dd > 0 ? `In ${dd} day${dd !== 1 ? 's' : ''}` : `${Math.abs(dd)} day${Math.abs(dd) !== 1 ? 's' : ''} ago`
  }
  const md = monthsDiff(d)
  if (Math.abs(md) >= 1) {
    return md > 0 ? `In ${md} month${md !== 1 ? 's' : ''}` : `${Math.abs(md)} month${Math.abs(md) !== 1 ? 's' : ''} ago`
  }
  return `${shortDate(d)} at ${formatTimeShort(d)}`
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
  return `${shortDate(d)} at ${formatTimeShort(d)}`
}

/* ---------- small helper exported elsewhere ---------- */
export function deliveryIsLocked(parent: any, childItems?: any[]): boolean {
  const delivered = parent?.status === 'delivered'
  const cancelled = parent?.status === 'cancelled'
  const pEta = toDate(parent?.expectedDate)
  let eta: Date | null = pEta
  if (!eta && Array.isArray(childItems) && childItems.length) {
    const dates = childItems.map((it) => toDate(it?.expectedDate)).filter(Boolean) as Date[]
    if (dates.length) eta = new Date(Math.max(...dates.map((d) => d.getTime())))
  }
  const pastETA = !!eta && eta.getTime() < Date.now()
  return delivered || cancelled || pastETA
}

/* ===================================================== */

export default function DeliveryCard({ familyId, order, delivery, onDelete }: Props) {
  const parent = order ?? delivery
  const parentType: 'order' | 'delivery' = order ? 'order' : 'delivery'
  const parentCollection = parentType === 'order' ? 'orders' : 'deliveries'

  const [expanded, setExpanded] = useState(false)
  const [items, setItems] = useState<any[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [processing, setProcessing] = useState(false)

  // confirmation dialog state for mark-delivered
  const [confirmOpen, setConfirmOpen] = useState(false)

  // subscribe to items (unchanged)
  useEffect(() => {
    if (!parent?.id) return
    const isSingle = parentType === 'delivery' && (parent.type === 'single' || !parent.type)
    if (isSingle) {
      setItems([])
      setLoadingItems(false)
      return
    }
    setLoadingItems(true)
    const unsub = subscribeToItems(
      familyId,
      parentCollection,
      parent.id,
      (rows) => { setItems(rows); setLoadingItems(false) },
      () => { setLoadingItems(false) },
      'expectedDate'
    )
    return () => { try { unsub && unsub() } catch {} }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId, parent?.id, parentCollection])

  const pEta = toDate(parent?.expectedDate)
  const eta: Date | null = (() => {
    if (pEta) return pEta
    if (!items?.length) return null
    const dates = (items.map((it) => toDate(it.expectedDate)).filter(Boolean) as Date[])
    return dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null
  })()
  const isPastETA = !!eta && eta.getTime() < Date.now()
  const delivered = parent?.status === 'delivered'
  const cancelled = parent?.status === 'cancelled'

  const onMarkItem = async (itemId: string) => {
    setProcessing(true)
    try {
      const res = await markChildItemAsReceived(familyId, parentCollection, parent.id, itemId)
      if (!res || res.success === false) alert(res?.message ?? 'Failed')
    } finally {
      setProcessing(false)
    }
  }

  const onMarkParent = async () => {
    if (delivered || cancelled) return
    setProcessing(true)
    try {
      if (parentType === 'order') {
        await markOrderAsDelivered(familyId, parent.id)
        const ref = doc(firestore, 'families', familyId, 'orders', parent.id)
        await updateDoc(ref, {
          status: 'delivered',
          deliveredAt: new Date(),
          archived: true,
          archivedAt: new Date(),
          archivedReason: 'delivered',
        })
      } else {
        const isSingle = parent.type === 'single' || !parent.type
        const ref = doc(firestore, 'families', familyId, 'deliveries', parent.id)

        if (isSingle) {
          await updateDoc(ref, {
            status: 'delivered',
            deliveredAt: new Date(),
            archived: true,
            archivedAt: new Date(),
            archivedReason: 'delivered',
          })
        } else {
          const res = await markDeliveryAsReceived(familyId, parent.id, '')
          if (!res || res.success === false) {
            alert(res?.message ?? 'Failed')
            setProcessing(false)
            setConfirmOpen(false)
            return
          }
          await updateDoc(ref, {
            archived: true,
            archivedAt: new Date(),
            archivedReason: 'delivered',
          })
        }
      }
    } catch (err) {
      alert('Failed to mark as delivered')
    } finally {
      setProcessing(false)
      setConfirmOpen(false)
    }
  }

  if (!parent) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No delivery/order provided</CardTitle>
        </CardHeader>
        <CardContent />
      </Card>
    )
  }

  const title =
    parent.title ?? parent.platform ?? parent.name ?? (parentType === 'order' ? 'Order' : 'Delivery')
  const isSingle = parentType === 'delivery' && (parent.type === 'single' || !parent.type)
  const pendingCount = items.filter((it) => it.status === 'pending' || it.status === 'in_transit').length

  function StatusBadge({ status }: { status: Status }) {
    const map: Record<Status, { label: string; className: string }> = {
      pending: { label: 'Pending', className: 'bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-xs' },
      in_transit: { label: 'In Transit', className: 'bg-sky-100 text-sky-800 px-2 py-0.5 rounded text-xs' },
      delivered: { label: 'Delivered', className: 'bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-xs' },
      cancelled: { label: 'Cancelled', className: 'bg-gray-100 text-gray-800 px-2 py-0.5 rounded text-xs' },
    }
    const info = map[status] ?? map.pending
    return <span className={info.className}>{info.label}</span>
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 sm:gap-0">
          <div className="w-full">
            <div className="font-medium flex flex-wrap items-center gap-2">
              <span className="truncate">{title}</span>
              {parent.status && <StatusBadge status={parent.status as Status} />}
            </div>
            <div className="text-xs text-muted-foreground flex flex-wrap gap-x-2">
              {parent.platform && <span>{parent.platform}</span>}
              {typeof parent.totalAmount === 'number' && <span>₱{Number(parent.totalAmount).toFixed(2)}</span>}
              {!isSingle && <span>{items.length} item{items.length !== 1 ? 's' : ''}</span>}
              {eta && (
                <span>
                  ETA: {friendlyExpectedLabel(eta)}
                  {isPastETA ? ' (past due)' : ''}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 justify-end w-full sm:w-auto">
            {/* optional trash icon (parent handles confirm) */}
            {onDelete ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onDelete}
                title="Delete"
              >
                <Trash2 className="h-4 w-4" />
                <span className="sr-only">Delete</span>
              </Button>
            ) : null}

            {/* minimal icon for marking delivered (kept same logic via dialog) */}
            {isPastETA && !delivered && !cancelled && (
              <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={processing}
                    title="Mark as delivered (archives)"
                  >
                    <Check className="h-4 w-4" />
                    <span className="sr-only">Mark as delivered</span>
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent aria-describedby={undefined}>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Mark as delivered?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will set the status to <strong>Delivered</strong> and archive this {parentType}.
                      This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={processing}>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={onMarkParent} disabled={processing}>
                      Confirm
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            {/* expand/collapse – unchanged */}
            {!isPastETA && !delivered && !cancelled && !isSingle && (
              <Button type="button" variant="ghost" onClick={() => setExpanded((s) => !s)}>
                {expanded ? 'Collapse' : `Items (${pendingCount})`}
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>

      {isSingle ? (
        <CardContent className="space-y-2 text-sm">
          {parent.expectedDate && (
            <div className="flex flex-wrap items-center gap-2">
              <strong>Expected:</strong>
              <span className="text-muted-foreground">
                {friendlyExpectedLabel(parent.expectedDate)}
                {isPastETA ? ' (past due)' : ''}
              </span>
            </div>
          )}
          {parent.recipient && <div><strong>Recipient:</strong> {parent.recipient}</div>}
          {parent.address && <div><strong>Address:</strong> {parent.address}</div>}
          {parent.location && <div><strong>Location:</strong> {parent.location}</div>}
          {typeof parent.codAmount === 'number' && <div><strong>COD:</strong> ₱{parent.codAmount.toFixed(2)}</div>}
          {typeof parent.totalAmount === 'number' && <div><strong>Total:</strong> ₱{parent.totalAmount.toFixed(2)}</div>}
          {parent.notes && <div><strong>Notes:</strong> <span className="italic">{parent.notes}</span></div>}
          {parent.trackingNumber && <div><strong>Tracking #:</strong> {parent.trackingNumber}</div>}

          {parent.status === 'delivered' && parent.receivedBy && (
            <div className="text-sm flex flex-wrap items-center gap-2">
              <StatusBadge status="delivered" />
              <span className="text-muted-foreground">
                <UserName userId={parent.receivedBy} />
                {parent.receivedAt ? ` · ${friendlyDeliveredLabel(parent.receivedAt)}` : ''}
              </span>
            </div>
          )}
        </CardContent>
      ) : (
        expanded && (
          <CardContent className="space-y-3">
            {loadingItems ? (
              <div>Loading items…</div>
            ) : (
              <>
                {items.length === 0 && (
                  <div className="text-sm text-muted-foreground">No items for this {parentType}.</div>
                )}
                {items.map((it) => {
                  const expectedLabel = it.expectedDate ? friendlyExpectedLabel(it.expectedDate) : ''
                  return (
                    <div key={it.id} className="flex flex-col sm:flex-row justify-between gap-3 border-b pb-2">
                      <div className="flex-1">
                        <div className="font-medium">{it.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {expectedLabel}
                          {typeof it.price === 'number' ? ` · ₱${it.price.toFixed(2)}` : ''}
                        </div>
                        {it.status === 'delivered' && it.receivedBy && it.receivedAt && (
                          <div className="text-xs text-muted-foreground mt-1">
                            <UserName userId={it.receivedBy} /> · {friendlyDeliveredLabel(it.receivedAt)}
                          </div>
                        )}
                      </div>

                      {it.status !== 'delivered' && (
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => onMarkItem(it.id)}
                            disabled={processing}
                          >
                            {processing ? 'Please wait…' : 'Mark item received'}
                          </Button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </>
            )}
          </CardContent>
        )
      )}
    </Card>
  )
}

