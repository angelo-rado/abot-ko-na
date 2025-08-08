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

type Props = {
  familyId: string
  order?: any
  delivery?: any
}

type Status = 'pending' | 'in_transit' | 'delivered' | 'cancelled'

/**
 * Simple module-level cache to avoid repeated reads for the same user.
 * This persists for the life of the page.
 */
const userNameCache: Record<string, string> = {}

/**
 * Hook to fetch a user's display name from Firestore (users collection).
 * Returns empty string while loading, and the ID as fallback if no name found.
 */
function useUserName(userId?: string) {
  const [name, setName] = useState<string>('')

  useEffect(() => {
    if (!userId) {
      setName('')
      return
    }

    // If in cache, return immediately
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
          // fallback to id
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

/**
 * Small component to render a user's display name (resolves ID -> name).
 * Use inside lists safely.
 */
function UserName({ userId }: { userId?: string }) {
  const name = useUserName(userId)
  // show nothing if no id; otherwise show name or id while loading
  if (!userId) return null
  return <>{name || userId}</>
}

export default function DeliveryCard({ familyId, order, delivery }: Props) {
  const parent = order ?? delivery
  const parentType: 'order' | 'delivery' = order ? 'order' : 'delivery'
  const parentCollection = parentType === 'order' ? 'orders' : 'deliveries'

  const [expanded, setExpanded] = useState(false)
  const [items, setItems] = useState<any[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [processing, setProcessing] = useState(false)

  // Only subscribe to items for non-single (bulk/order) parents.
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
      (rows) => {
        setItems(rows)
        setLoadingItems(false)
      },
      (err) => {
        console.error('subscribeToItems error', err)
        setLoadingItems(false)
      },
      'expectedDate'
    )

    return () => {
      try {
        unsub && unsub()
      } catch (e) {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId, parent?.id, parentCollection])

  const onMarkItem = async (itemId: string) => {
    setProcessing(true)
    try {
      const res = await markChildItemAsReceived(familyId, parentCollection, parent.id, itemId)
      if (!res || res.success === false) alert(res?.message ?? 'Failed')
    } catch (err) {
      console.error(err)
      alert('Failed to mark item')
    } finally {
      setProcessing(false)
    }
  }

  const onMarkParent = async () => {
    const confirmMsg = parentType === 'order' ? 'Mark entire order as delivered?' : 'Mark entire delivery as received?'
    if (!confirm(confirmMsg)) return

    setProcessing(true)
    try {
      if (parentType === 'order') {
        await markOrderAsDelivered(familyId, parent.id)
      } else {
        const isSingle = parentType === 'delivery' && (parent.type === 'single' || !parent.type)
        if (isSingle) {
          try {
            const ref = doc(firestore, 'families', familyId, 'deliveries', parent.id)
            await updateDoc(ref, {
              status: 'delivered',
              deliveredAt: new Date(),
            })
          } catch (err) {
            console.error('updateDoc failed for single delivery', err)
            throw err
          }
        } else {
          const res = await markDeliveryAsReceived(familyId, parent.id, '')
          if (!res || res.success === false) alert(res?.message ?? 'Failed')
        }
      }
    } catch (err) {
      console.error(err)
      alert('Failed to mark parent as delivered')
    } finally {
      setProcessing(false)
    }
  }

  if (!parent) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No delivery/order provided</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            Component expects either an <code>order</code> (legacy) or <code>delivery</code> prop.
          </div>
        </CardContent>
      </Card>
    )
  }

  const title = parent.title ?? parent.platform ?? parent.name ?? (parentType === 'order' ? 'Order' : 'Delivery')
  const isSingle = parentType === 'delivery' && (parent.type === 'single' || !parent.type)
  const pendingCount = items.filter((it) => it.status === 'pending' || it.status === 'in_transit').length

  /* --------------------------
     Helpers: relative date & time
     -------------------------- */
  function toDate(input: any): Date | null {
    if (!input) return null
    if (input.toDate) return input.toDate()
    if (input.seconds) return new Date(input.seconds * 1000)
    if (typeof input === 'string' || typeof input === 'number') return new Date(input)
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
    const d = toDate(raw)
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

  /* --------------------------
     Status badge component
     -------------------------- */
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
    // Only the JSX return block has been adjusted for responsiveness

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
            </div>
          </div>

          <div className="flex flex-wrap gap-2 justify-end w-full sm:w-auto">
            {!isSingle && (
              <Button size="sm" variant="ghost" onClick={() => setExpanded((s) => !s)}>
                {expanded ? 'Collapse' : `Items (${pendingCount})`}
              </Button>
            )}
            
          </div>
        </CardTitle>
      </CardHeader>

      {isSingle ? (
        <CardContent className="space-y-2 text-sm">
          {/* Content remains unchanged for now except spacing */}
          {parent.expectedDate && (
            <div className="flex flex-wrap items-center gap-2">
              <strong>Expected:</strong>
              <span className="text-muted-foreground">{friendlyExpectedLabel(parent.expectedDate)}</span>
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

          {items.length > 0 && (
            <div className="pt-2 border-t space-y-2">
              <div className="font-medium">Items</div>
              {items.map((it) => (
                <div key={it.id} className="text-xs text-muted-foreground">
                  <div className="flex flex-col sm:flex-row justify-between gap-y-1">
                    <div>
                      {it.name} {typeof it.price === 'number' ? `· ₱${it.price.toFixed(2)}` : ''}
                      {it.expectedDate && (
                        <div className="text-muted-foreground">{friendlyExpectedLabel(it.expectedDate)}</div>
                      )}
                    </div>
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1 sm:gap-2">
                      <StatusBadge status={(it.status ?? 'pending') as Status} />
                      {it.status === 'delivered' && it.receivedBy && it.receivedAt && (
                        <div>
                          <UserName userId={it.receivedBy} /> · {friendlyDeliveredLabel(it.receivedAt)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
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
                {items.length === 0 && <div className="text-sm text-muted-foreground">No items for this {parentType}.</div>}
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
