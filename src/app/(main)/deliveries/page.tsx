/* eslint-disable */
'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { useAuth } from '@/lib/useAuth'
import { useSelectedFamily } from '@/lib/useSelectedFamily'
import { useAutoPresence } from '@/lib/useAutoPresence'
import DeliveryCard from '@/app/components/DeliveryCard'
import BulkEditBar from './BulkEditBar'
import { Button } from '@/components/ui/button'
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { deleteDelivery as deleteDeliveryApi } from '@/lib/deliveries'

type Delivery = {
  id: string
  title: string
  status: 'pending' | 'in_transit' | 'delivered' | 'cancelled'
  expectedDate?: any
  createdAt?: any
  updatedAt?: any
  note?: string | null
  receiverNote?: string | null
  codAmount?: number | null
  totalAmount?: number | null
  itemCount?: number
  type?: string | null
  archived?: boolean
}

function formatDate(ts?: any) {
  try {
    if (!ts) return ''
    if (ts.toDate) return ts.toDate().toLocaleDateString()
    if (ts.seconds) return new Date(ts.seconds * 1000).toLocaleDateString()
    if (typeof ts === 'number') return new Date(ts).toLocaleDateString()
  } catch {}
  return ''
}

function DeliveriesPageInner({ familyId }: { familyId: string }) {
  useAutoPresence(familyId || undefined)

  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [selectedTab, setSelectedTab] = useState<'upcoming' | 'archived'>('upcoming')
  const [queryText, setQueryText] = useState('')
  const [loading, setLoading] = useState(false)

  // selection
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({})

  // toast (simple)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | null>(null)
  function showToast(msg: string) {
    setToast(msg)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 1800)
  }

  // confirm modal state
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmTitle, setConfirmTitle] = useState<string | null>(null)
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null)
  const [confirmDanger, setConfirmDanger] = useState(false)
  const [confirmConfirmLabel, setConfirmConfirmLabel] = useState<string | null>(null)
  const confirmResolveRef = useRef<((v: boolean) => void) | null>(null)

  const showConfirm = useCallback(
    (title: string, message?: string, opts?: { danger?: boolean; confirmLabel?: string } | boolean) => {
      const danger = typeof opts === 'boolean' ? !!opts : !!opts?.danger
      const label = typeof opts === 'object' ? opts?.confirmLabel : undefined
      setConfirmTitle(title || 'Are you sure?')
      setConfirmMessage(message || null)
      setConfirmDanger(danger)
      setConfirmConfirmLabel(label || null)
      setConfirmOpen(true)
      return new Promise<boolean>((resolve) => {
        confirmResolveRef.current = resolve
      })
    },
    []
  )

  function handleConfirmResult(ok: boolean) {
    setConfirmOpen(false)
    confirmResolveRef.current?.(ok)
    confirmResolveRef.current = null
  }

  // live subscribe
  useEffect(() => {
    if (!familyId) return
    const col = collection(firestore, 'families', familyId, 'deliveries')
    const q = query(col, orderBy('createdAt', 'desc'))
    const unsub = onSnapshot(q, (snap) => {
      const arr = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
      setDeliveries(arr as Delivery[])
    })
    return () => unsub()
  }, [familyId])

  const filtered = deliveries.filter((r) => {
    // Tabs are Upcoming vs Archived (not status)
    if (selectedTab === 'upcoming') {
      // upcoming: not archived and not explicitly cancelled
      if (r.archived) return false
      if (r.status === 'cancelled') return false
    } else {
      // archived: archived flag true
      if (!r.archived) return false
    }

    if (queryText) {
      const q = queryText.toLowerCase()
      const s = [r.title, r.note, r.receiverNote].filter(Boolean).join(' ').toLowerCase()
      if (!s.includes(q)) return false
    }
    return true
  })

  function toggleSelectAll(on: boolean) {
    if (!on) {
      setSelectedIds({})
      return
    }
    const next: Record<string, boolean> = {}
    for (const d of filtered) next[d.id] = true
    setSelectedIds(next)
  }

  const selectedCount = Object.values(selectedIds).filter(Boolean).length

  // Single delete (offline-aware lib helper)
  async function handleDelete(deliveryId: string) {
    if (!familyId) { showToast('No family selected'); return }
    const ok = await showConfirm('Delete delivery', 'This cannot be undone.', { danger: true, confirmLabel: 'Delete' })
    if (!ok) return
    try {
      setLoading(true)
      const res = await deleteDeliveryApi(familyId, deliveryId)
      if (res?.offline) {
        showToast('Queued delete (offline)')
      } else {
        showToast('Deleted')
      }
    } catch (err) {
      console.error('delete failed', err)
      showToast('Delete failed')
    } finally {
      setLoading(false)
    }
  }

  const handleBulkDelete = useCallback(async () => {
    if (!familyId) { showToast('No family selected'); return }
    const ids = Object.keys(selectedIds).filter((k) => selectedIds[k])
    if (ids.length === 0) return
    const ok = await showConfirm(`Delete ${ids.length} deliveries?`, 'This cannot be undone.', {
      danger: true,
      confirmLabel: 'Delete',
    })
    if (!ok) return
    try {
      setLoading(true)
      await Promise.all(ids.map((id) => deleteDeliveryApi(familyId, id)))
      showToast('Deleted selected')
      setSelectedIds({})
      setSelectionMode(false)
    } catch (e) {
      console.error('bulk delete failed', e)
      showToast('Some deletions may have failed')
    } finally {
      setLoading(false)
    }
  }, [selectedIds, familyId, showConfirm])

  return (
    <div className="mx-auto max-w-5xl px-4 py-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">Deliveries</h1>
          <Badge variant="outline">{deliveries.length}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder="Search title or notes"
            className="h-9 w-56"
          />
          <Separator orientation="vertical" className="h-6" />
          <div className="flex items-center gap-2">
            <Checkbox
              id="selectMode"
              checked={selectionMode}
              onCheckedChange={(v) => setSelectionMode(Boolean(v))}
            />
            <Label htmlFor="selectMode" className="cursor-pointer select-none">Select</Label>
          </div>
        </div>
      </div>

      <Tabs value={selectedTab} onValueChange={(v) => setSelectedTab(v as any)} className="w-full">
        <TabsList>
          <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
          <TabsTrigger value="archived">Archived</TabsTrigger>
        </TabsList>

        <TabsContent value={selectedTab} className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            {selectionMode ? (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="selectAll"
                    checked={selectedCount > 0 && selectedCount === filtered.length}
                    onCheckedChange={(v) => toggleSelectAll(Boolean(v))}
                  />
                  <Label htmlFor="selectAll" className="cursor-pointer select-none">Select all</Label>
                </div>
                <Badge variant="secondary">{selectedCount} selected</Badge>
              </div>
            ) : (
              <div />
            )}

            {selectionMode ? (
              <BulkEditBar
                visible={selectionMode}
                selectedCount={selectedCount}
                onEdit={() => showToast('Bulk edit coming soon')}
                onDelete={handleBulkDelete}
                onCancel={() => { setSelectionMode(false); setSelectedIds({}); }}
              />
            ) : null}
          </div>

          <div className={cn('grid gap-3', selectionMode ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2')}>
            {filtered.map((d) => {
              const checked = !!selectedIds[d.id]
              const onCheck = (v: boolean) => {
                setSelectedIds((prev) => ({ ...prev, [d.id]: v }))
              }
              return (
                <div key={d.id} className={cn(selectionMode && checked ? 'ring-2 ring-primary rounded-lg' : '')}>
                  {selectionMode ? (
                    <div className="mb-2 flex items-center gap-2">
                      <Checkbox id={`cb-${d.id}`} checked={checked} onCheckedChange={(v) => onCheck(Boolean(v))} />
                      <Label htmlFor={`cb-${d.id}`} className="select-none">{d.title}</Label>
                    </div>
                  ) : null}

                  {/* keep original layout: the top-right Delete button */}
                  <div className="flex justify-end mb-2">
                    {!selectionMode && (
                      <Button variant="destructive" size="sm" onClick={() => handleDelete(d.id)}>
                        Delete
                      </Button>
                    )}
                  </div>

                  {/* Pass onDelete so the card can show a trash icon (minimal addition) */}
                  <DeliveryCard
                    familyId={familyId}
                    delivery={d}
                    onDelete={() => handleDelete(d.id)}
                  />
                </div>
              )
            })}
          </div>
        </TabsContent>
      </Tabs>

      {/* Simple toast */}
      {toast ? (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-3 py-2 text-sm text-background shadow">
          {toast}
        </div>
      ) : null}

      {/* Confirm Dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!open) handleConfirmResult(false) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTitle || 'Are you sure?'}</AlertDialogTitle>
            {confirmMessage && <AlertDialogDescription>{confirmMessage}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => handleConfirmResult(false)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleConfirmResult(true)}>
              {confirmDanger ? 'Delete' : 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function DeliveriesPage() {
  const { user } = useAuth()
  const { familyId } = useSelectedFamily(user?.familyId ?? null)
  if (!user || !familyId) return null
  return <DeliveriesPageInner familyId={familyId || ''} />
}

export default function DeliveriesPageGuard() {
  const { user } = useAuth()
  if (!user) return null
  return <DeliveriesPage />
}
