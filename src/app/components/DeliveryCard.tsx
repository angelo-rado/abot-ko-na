'use client'

import React, { useEffect, useState, type ReactNode } from 'react'
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
import { Check, Trash2, ChevronDown } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

type MetaChipProps = {
  tone?: 'muted' | 'info' | 'warn'
  children: ReactNode
}

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

/* ---------- date helpers ---------- */
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
  return `${shortDate(d)} · ${formatTimeShort(d)}`
}
function friendlyDeliveredLabel(raw: any) {
  const d = toDate(raw)
  if (!d) return ''
  const dd = daysDiff(d)
  if (dd === 0) return `Today · ${formatTimeShort(d)}`
  if (dd === -1) return `Yesterday · ${formatTimeShort(d)}`
  if (Math.abs(dd) <= 7) return `${d.toLocaleDateString(undefined, { weekday: 'long' })} · ${formatTimeShort(d)}`
  return `${shortDate(d)} · ${formatTimeShort(d)}`
}

/* ---------- tiny UI helpers ---------- */
const MetaChip = ({ children, tone = 'muted' }: MetaChipProps) => {
  const toneCls =
    tone === 'info'
      ? 'bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:border-sky-800/50'
      : tone === 'warn'
      ? 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800/50'
      : 'bg-muted text-muted-foreground border border-muted-foreground/10'

  return (
    <span className={`text-[11px] px-2 py-0.5 rounded ${toneCls}`}>
      {children}
    </span>
  )
}
const Dot = () => <span className="mx-1.5 text-muted-foreground/60">•</span>

/* ---------- lock helper (kept for parity) ---------- */
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
  const [confirmOpen, setConfirmOpen] = useState(false)

  const MetaChip = ({ children, tone = 'muted' }: MetaChipProps) => {
  const toneCls =
    tone === 'info'
      ? 'bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:border-sky-800/50'
      : tone === 'warn'
      ? 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800/50'
      : 'bg-muted text-muted-foreground border border-muted-foreground/10'

  return (
    <span className={`text-[11px] px-2 py-0.5 rounded ${toneCls}`}>
      {children}
    </span>
  )
}

  useEffect(() => {
    if (!parent?.id) return
    const isSingle = parentType === 'delivery' && (parent.type === 'single' || !parent.type)
    if (isSingle) {
      setItems([]); setLoadingItems(false); return
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
  const isSingle = parentType === 'delivery' && (parent.type === 'single' || !parent.type)
  const itemsCount = items.length || parent?.itemCount || 0

  /* ---------- actions ---------- */
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
          if (!res || res.success === false) { alert(res?.message ?? 'Failed'); setProcessing(false); setConfirmOpen(false); return }
          await updateDoc(ref, {
            archived: true,
            archivedAt: new Date(),
            archivedReason: 'delivered',
          })
        }
      }
    } catch {
      alert('Failed to mark as delivered')
    } finally {
      setProcessing(false)
      setConfirmOpen(false)
    }
  }

  if (!parent) {
    return (
      <Card>
        <CardHeader><CardTitle>No delivery/order provided</CardTitle></CardHeader>
        <CardContent />
      </Card>
    )
  }

  const title = parent.title ?? parent.platform ?? parent.name ?? (parentType === 'order' ? 'Order' : 'Delivery')
  const status: Status | undefined = parent.status

  /* ---------- status badge (subtle, not shouty) ---------- */
  const StatusBadge = ({ status }: { status: Status }) => {
    const map: Record<Status, string> = {
      pending: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800/40',
      in_transit: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:border-sky-800/40',
      delivered: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800/40',
      cancelled: 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-900/40 dark:text-gray-300 dark:border-gray-800',
    }
    return <span className={`text-[11px] px-2 py-0.5 rounded border ${map[status]}`}>{status.replace('_', ' ')}</span>
  }

  const showItemsToggle = !isSingle && !cancelled // always available for multiples; still allow after ETA
  const receivedVariant: 'default' | 'secondary' = isPastETA ? 'default' : 'secondary'

  return (
    <Card className="border-muted">
      <CardHeader className="pb-2">
        {/* TOP ROW — Title + primary actions */}
        <CardTitle className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold truncate">{title}</span>
              {status && <StatusBadge status={status} />}
            </div>

            {/* META ROW — compact, single line */}
            <div className="mt-1 text-xs text-muted-foreground flex flex-wrap items-center gap-y-1">
              {eta && <MetaChip tone={isPastETA ? 'warn' : 'info'}>ETA {friendlyExpectedLabel(eta)}{isPastETA ? ' (past due)' : ''}</MetaChip>}
              {typeof parent.totalAmount === 'number' && <MetaChip>₱{Number(parent.totalAmount).toFixed(2)}</MetaChip>}
              {!isSingle && <MetaChip>{itemsCount} item{itemsCount !== 1 ? 's' : ''}</MetaChip>}
              {parent.platform && (<><Dot />{parent.platform}</>)}
            </div>

            {/* DELIVERED INFO — only when done */}
            {status === 'delivered' && (
              <div className="mt-1 text-[11px] text-muted-foreground">
                Received{parent.receivedBy ? <> by <UserName userId={parent.receivedBy} /></> : ''}{parent.receivedAt ? ` · ${friendlyDeliveredLabel(parent.receivedAt)}` : ''}
              </div>
            )}
          </div>

          {/* ACTIONS */}
          <div className="flex items-center gap-1 shrink-0">
            {onDelete ? (
              <Button type="button" variant="ghost" size="icon" onClick={onDelete} title="Delete">
                <Trash2 className="h-4 w-4" />
                <span className="sr-only">Delete</span>
              </Button>
            ) : null}

            {!delivered && !cancelled && (
              <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogTrigger asChild>
                  <Button type="button" size="sm" variant={receivedVariant} disabled={processing} className="whitespace-nowrap">
                    <Check className="h-4 w-4 mr-1" />
                    {processing ? 'Please wait…' : 'Received'}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent aria-describedby={undefined}>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Mark as delivered?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will set the status to <strong>Delivered</strong> and archive this {parentType}.
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

            {showItemsToggle && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setExpanded((s) => !s)}
                className="gap-1"
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                Items {itemsCount ? `(${itemsCount})` : ''}
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>

      {/* CONTENT — minimal by default; tidy items list when expanded */}
      {!isSingle && (
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
            >
              <CardContent className="pt-2">
                {loadingItems ? (
                  <div className="text-sm text-muted-foreground">Loading items…</div>
                ) : items.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No items for this {parentType}.</div>
                ) : (
                  <ul className="divide-y divide-border/60">
                    {items.map((it) => {
                      const expectedLabel = it.expectedDate ? friendlyExpectedLabel(it.expectedDate) : ''
                      const deliveredItem = it.status === 'delivered'
                      return (
                        <li key={it.id} className="py-2 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{it.name}</div>
                            <div className="text-[11px] text-muted-foreground truncate">
                              {expectedLabel || 'No ETA'}
                              {typeof it.price === 'number' ? ` · ₱${it.price.toFixed(2)}` : ''}
                              {deliveredItem && it.receivedBy && it.receivedAt ? (
                                <> · <UserName userId={it.receivedBy} /> · {friendlyDeliveredLabel(it.receivedAt)}</>
                              ) : null}
                            </div>
                          </div>
                          {!deliveredItem && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => onMarkItem(it.id)}
                              disabled={processing}
                              className="shrink-0"
                            >
                              {processing ? 'Saving…' : 'Received'}
                            </Button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </CardContent>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/* Single deliveries: keep ultra-minimal — details already in header chips */}
      {isSingle && parent.notes && (
        <CardContent className="pt-2">
          <div className="text-sm">
            <span className="text-muted-foreground">Notes: </span>
            <span className="italic">{parent.notes}</span>
          </div>
        </CardContent>
      )}
    </Card>
  )
}
