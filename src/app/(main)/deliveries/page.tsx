/* eslint-disable */
'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'
import {
  collection, query as fsQuery, orderBy, onSnapshot, doc,
  deleteDoc, where, updateDoc, serverTimestamp, // ⬅️ added updateDoc + serverTimestamp
} from 'firebase/firestore'

import { firestore } from '@/lib/firebase'
import { useAuth } from '@/lib/useAuth'
import { useSelectedFamily } from '@/lib/selected-family'
import { useAutoPresence } from '@/lib/useAutoPresence'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, Loader2, MessageSquareText, Package } from 'lucide-react'
import DeliveryFormDialog from '@/app/components/DeliveryFormDialog'
import DeliveryCard from '@/app/components/DeliveryCard'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import { useRouter } from 'next/navigation'
import DeliveryNotesThread from '@/app/components/delivery-notes/DeliveryNotesThread'
import BulkEditBar from './BulkEditBar'
import Link from 'next/link'

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

export const dynamic = 'force-dynamic'

// ✅ Helpers
function isMultiple(d: any) {
  if (!d) return false
  if (d.type === 'single') return false
  if (typeof d.itemCount === 'number') return d.itemCount > 1
  if (Array.isArray(d.items)) return d.items.length > 1
  if (d.type === 'order') return true
  return false
}
function isSingle(d: any) { return !isMultiple(d) }
function currency(n?: number | null) { if (typeof n !== 'number') return '—'; return `₱${n.toFixed(2)}` }
function itemsTotal(items?: any[]) {
  if (!Array.isArray(items)) return 0
  return items.reduce((s, it) => s + (typeof it?.price === 'number' ? it.price : 0), 0)
}
function etaLabel(raw: any) {
  if (!raw) return ''
  try {
    if (raw?.toDate) return raw.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    if (typeof raw?.seconds === 'number') return new Date(raw.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const d = new Date(raw)
    if (!isNaN(d.getTime())) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch { }
  return ''
}

/* ---------- NEW helpers for auto-archive by date ---------- */
function toMillis(v: any): number | null {
  try {
    if (!v) return null
    if (typeof v?.toDate === 'function') return v.toDate().getTime()
    if (typeof v?.seconds === 'number') return v.seconds * 1000
    if (v instanceof Date) return v.getTime()
    if (typeof v === 'number') return Number.isFinite(v) ? v : null
    if (typeof v === 'string') {
      const t = Date.parse(v)
      return Number.isNaN(t) ? null : t
    }
    return null
  } catch {
    return null
  }
}

function startOfTodayMs(): number {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
  return start.getTime()
}

/** Use delivery.expectedDate, or if items exist, the max of items[*].expectedDate */
function getEffectiveExpectedMs(d: any): number | null {
  const top = toMillis(d?.expectedDate)

  let itemsMax: number | null = null
  if (Array.isArray(d?.items) && d.items.length > 0) {
    for (const it of d.items) {
      const t = toMillis(it?.expectedDate)
      if (t != null) itemsMax = itemsMax == null ? t : Math.max(itemsMax, t)
    }
  }

  if (top != null && itemsMax != null) return Math.max(top, itemsMax)
  return top ?? itemsMax ?? null
}

/**
 * Guard wrapper — only mounts heavy content when user is ready.
 * Also auto-falls back to first family if default isn't set.
 * (Avoids React #310 by keeping hooks outside branches.)
 */
export default function DeliveriesPageGuard() {
  const { user, loading: authLoading } = useAuth()
  const { families = [], familyId, loadingFamilies } = useSelectedFamily()

  // Persist a soft default family when none is set (unconditional hook)
  useEffect(() => {
    if (!familyId && families.length > 0 && typeof window !== 'undefined') {
      try { window.localStorage.setItem('abot:selectedFamily', families[0].id) } catch {}
    }
  }, [familyId, families])

  if (authLoading || loadingFamilies || !user) {
    return (
      <main className="flex items-center justify-center h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </main>
    )
  }

  const effectiveId = familyId || (families[0]?.id ?? null)

  if (!effectiveId) {
    return (
      <main className="flex items-center justify-center h-screen px-4">
        <div className="text-center space-y-4 max-w-md">
          <h2 className="text-lg font-semibold">No family yet</h2>
          <p className="text-sm text-muted-foreground">
            You haven&apos;t joined or created a family. Deliveries require a family group.
          </p>
          <div className="flex items-center justify-center gap-2">
            <Link href="/family">
              <Button>Create or Join a Family</Button>
            </Link>
          </div>
        </div>
      </main>
    )
  }

  // ✅ pass myUid so we can filter “MyDeliveries”
  return <DeliveriesPageContent familyId={effectiveId} families={families} myUid={user.uid} />
}

/** The original page content, now safely mounted with stable props */
function DeliveriesPageContent({ familyId, families, myUid }: { familyId: string; families: Array<{ id: string; name?: string }>; myUid: string }) {
  // presence
  useAutoPresence(familyId)

  const [deliveries, setDeliveries] = useState<any[]>([])
  const [loadingDeliveries, setLoadingDeliveries] = useState(true)
  const [tab, setTab] = useState<'upcoming' | 'archived'>('upcoming')

  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({})

  const [openForm, setOpenForm] = useState(false)
  const [editingDelivery, setEditingDelivery] = useState<any | null>(null)

  const confirmResolveRef = useRef<((v: boolean) => void) | null>(null)
  const [confirmTitle, setConfirmTitle] = useState<string>('')
  const [confirmMessage, setConfirmMessage] = useState<string>('')
  const [confirmDanger, setConfirmDanger] = useState<boolean>(false)
  const [confirmConfirmLabel, setConfirmConfirmLabel] = useState<string>('Proceed')
  const [confirmCancelLabel, setConfirmCancelLabel] = useState<string>('Cancel')
  const [confirmOpen, setConfirmOpen] = useState(false)

  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const toastTimerRef = useRef<number | null>(null)

  const [notesOpen, setNotesOpen] = useState<Record<string, boolean>>({})

  const router = useRouter()

  const handleConfirmResult = (ok: boolean) => {
    const cb = confirmResolveRef.current
    confirmResolveRef.current = null
    setConfirmOpen(false)
    cb?.(ok)
  }

  const showToast = (msg: string) => {
    setToastMessage(msg)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current as any)
    toastTimerRef.current = window.setTimeout(() => setToastMessage(null), 3500)
  }

  const showConfirm = useCallback((title: string, message: string, opts?: {
    danger?: boolean
    confirmLabel?: string
    cancelLabel?: string
  }) => new Promise<boolean>((resolve) => {
    confirmResolveRef.current = resolve
    setConfirmTitle(title)
    setConfirmMessage(message)
    setConfirmDanger(!!opts?.danger)
    setConfirmConfirmLabel(opts?.confirmLabel || 'Proceed')
    setConfirmCancelLabel(opts?.cancelLabel || 'Cancel')
    setConfirmOpen(true)
  }), [])

  /* ---------- AUTO-ARCHIVE logic ---------- */
  const isArchived = useCallback((d: any) => {
    if (!d) return false

    // explicit archive/done states
    if (d.archived === true) return true
    const st = (d.status ? String(d.status) : '').toLowerCase()
    if (st.includes('delivered') || st === 'cancelled' || st.includes('cancel')) return true
    if (d.delivered === true) return true
    if (d.deliveredAt || d.receivedAt) return true

    // date-based auto-archive (anything scheduled before today)
    const expMs = getEffectiveExpectedMs(d)
    if (expMs != null && expMs < startOfTodayMs()) return true

    // item-level “all done” fallback
    if (Array.isArray(d.items) && d.items.length > 0) {
      const allDone = d.items.every((it: any) => {
        const s = (it?.status ? String(it.status) : '').toLowerCase()
        return s.includes('delivered') || s.includes('cancel')
      })
      if (allDone) return true
    }

    return false
  }, [])

  // Persist auto-archived flag to Firestore (only for my deliveries; matches query)
  const persistInFlightRef = useRef(false)
  const persistAutoArchived = useCallback(async (list: any[]) => {
    if (persistInFlightRef.current) return
    const toFlag = list.filter((d) => isArchived(d) && d.archived !== true)
    if (!toFlag.length) return

    persistInFlightRef.current = true
    try {
      // cap to avoid huge fan-out (adjust as needed)
      const chunk = toFlag.slice(0, 25)
      await Promise.allSettled(
        chunk.map((d) =>
          updateDoc(doc(firestore, 'families', familyId, 'deliveries', d.id), {
            archived: true,
            archivedAt: serverTimestamp(),
            archivedReason: d.receivedAt || d.deliveredAt ? 'delivered' : 'auto_expectedDate_past',
          })
        )
      )
    } catch (e) {
      // non-fatal — UI still treats them as archived
      console.warn('[DeliveriesPage] auto-archive persist failed', e)
    } finally {
      persistInFlightRef.current = false
    }
  }, [familyId, isArchived])

  // Live deliveries listener — limited to *my* deliveries at the query level
  useEffect(() => {
    setLoadingDeliveries(true)
    const qy = fsQuery(
      collection(firestore, 'families', familyId, 'deliveries'),
      where('createdBy', '==', myUid),             // ⬅️ only my deliveries
      orderBy('createdAt', 'desc')
    )
    const unsub = onSnapshot(qy, (snapshot) => {
      const list = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
      setDeliveries(list)
      setLoadingDeliveries(false)
      // ⬇️ write back archived flag for any past-date deliveries
      void persistAutoArchived(list)
    }, (err) => {
      console.error('[DeliveriesPage] snapshot error', err)
      setLoadingDeliveries(false)
    })
    return () => { try { unsub() } catch { } }
  }, [familyId, myUid, persistAutoArchived])

  /* ---------------- Partition & filtering ---------------- */
  const upcoming = deliveries.filter((d) => !isArchived(d))
  const archived = deliveries.filter((d) => isArchived(d))

  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'in_transit' | 'delivered' | 'cancelled'>('all')
  const [queryText, setQueryText] = useState('')

  const matchesQuery = useCallback((d: any) => {
    const q = queryText.trim().toLowerCase()
    if (!q) return true
    return (
      (d.name && String(d.name).toLowerCase().includes(q)) ||
      (d.notes && String(d.notes).toLowerCase().includes(q)) ||
      (d.items && Array.isArray(d.items) && d.items.some((it: any) => String(it?.name || '').toLowerCase().includes(q)))
    )
  }, [queryText])

  // Always show only my deliveries (the query is already scoped; this is a safety net)
  const applyFilters = useCallback((list: any[]) => {
    return list
      .filter((d) => (filterStatus === 'all' ? true : d.status === filterStatus))
      .filter((d) => d?.createdBy === myUid)
      .filter(matchesQuery)
  }, [filterStatus, matchesQuery, myUid])

  const clearSelection = () => setSelectedIds({})
  const toggleSelect = (id: string) => setSelectedIds((m) => ({ ...m, [id]: !m[id] }))

  async function handleDelete(id: string) {
    const ok = await showConfirm('Delete delivery', 'This cannot be undone.', { danger: true, confirmLabel: 'Delete' })
    if (!ok) return
    try { await deleteDoc(doc(firestore, 'families', familyId, 'deliveries', id)); showToast('Deleted') }
    catch (err) { console.error('delete failed', err); showToast('Delete failed') }
  }

  // Derived selected count
  const selectedCount = Object.values(selectedIds).filter(Boolean).length

  const handleBulkDelete = useCallback(async () => {
    const ids = Object.keys(selectedIds).filter((k) => selectedIds[k])
    if (ids.length === 0) return
    const ok = await showConfirm(
      `Delete ${ids.length} delivery${ids.length > 1 ? 'ies' : ''}?`,
      'This cannot be undone.',
      { danger: true, confirmLabel: 'Delete' }
    )
    if (!ok) return
    try {
      await Promise.allSettled(
        ids.map((id) => deleteDoc(doc(firestore, 'families', familyId, 'deliveries', id)))
      )
      showToast('Deleted')
      clearSelection()
      setSelectionMode(false)
    } catch (e) {
      console.error('bulk delete failed', e)
      showToast('Some deletions may have failed')
    }
  }, [selectedIds, familyId, showConfirm])

  const handleBulkEdit = useCallback(() => {
    const ids = Object.keys(selectedIds).filter((k) => selectedIds[k])
    if (ids.length !== 1) {
      showToast('Select exactly one delivery to edit.')
      return
    }
    const d = deliveries.find((x) => x.id === ids[0])
    if (!d) return
    setEditingDelivery(d)
    setOpenForm(true)
  }, [selectedIds, deliveries])

  const handleCancel = useCallback(() => {
    setSelectionMode(false)
    clearSelection()
  }, [])

  const keyFor = (d: any) => `${d.id}-${d.updatedAt?.seconds || d.createdAt?.seconds || ''}`

  /* ---------------- Derived groups for current tab ---------------- */
  const sourceList = tab === 'upcoming' ? upcoming : archived
  const filtered = applyFilters(sourceList)
  const singles = filtered.filter(isSingle)
  const multiples = filtered.filter(isMultiple)

  return (
    <div className="px-4 py-6 pb-24 max-w-4xl mx-auto space-y-6 bg-background text-foreground">
      {/* Top controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1">
          {/* Settings-driven default family (no inline picker here) */}
          <div className="rounded-lg border p-3 bg-muted/30 flex items-center justify-between">
            <div className="text-sm">
              <span className="font-medium">Default family:</span>{' '}
              <span>{families.find((f) => f.id === familyId)?.name ?? familyId ?? 'None set'}</span>
            </div>
            <Link href="/settings" className="text-sm underline">Change</Link>
          </div>
        </div>

        {/* top-right controls */}
        <div className="flex gap-2 flex-wrap sm:flex-nowrap">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setSelectionMode((s) => !s)
              if (selectionMode) clearSelection()
            }}
          >
            {selectionMode ? 'Exit edit' : 'Edit / Delete'}
          </Button>
          <Button
            type="button"
            onClick={() => {
              setEditingDelivery(null)
              setOpenForm(true)
            }}
          >
            <Plus className="w-4 h-4" />
            <span className="ml-2 hidden sm:inline">Add Delivery</span>
          </Button>
        </div>
      </div>

      {/* Filters and Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-2 bg-muted rounded-md p-1">
          {(['upcoming', 'archived'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 rounded text-sm ${tab === t ? 'bg-background shadow border' : 'text-muted-foreground'}`}
            >
              {t === 'upcoming' ? 'Upcoming' : 'Archived'}
            </button>
          ))}
        </div>

        {/* Search + status filter */}
        <input
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
          placeholder="Search deliveries..."
          className="border border-input bg-background text-foreground placeholder:text-muted-foreground px-3 py-1 rounded w-full sm:w-64"
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as any)}
          className="border border-input bg-background text-foreground px-3 py-1 rounded text-sm"
        >
          <option value="all">All</option>
          <option value="pending">Pending</option>
          <option value="in_transit">In Transit</option>
          <option value="delivered">Delivered</option>
          <option value="cancelled">Cancelled</option>
        </select>
        {/* ⬅️ removed Mine-only toggle */}
      </div>

      {/* Content */}
      {loadingDeliveries ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded" />
          ))}
        </div>
      ) : families.length === 0 ? (
        <div className="text-center py-10 space-y-4">
          <p className="text-muted-foreground text-sm">
            You haven&apos;t joined or created a family yet. Deliveries require a family group.
          </p>
          <div className="flex justify-center">
            <Button onClick={() => router.push('/family')}>Go to Family</Button>
          </div>
        </div>
      ) : (
        <>
          {/* ---------------- Single Deliveries ---------------- */}
          <section>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-lg font-semibold">Single Deliveries</h3>
              <Badge variant="secondary">{singles.length}</Badge>
            </div>

            {singles.length === 0 ? (
              <p className="text-muted-foreground text-sm">No single deliveries</p>
            ) : (
              <div className="space-y-4">
                {singles.map((d) => {
                  const props = d.type === 'order' ? { order: d } : { delivery: d }
                  const locked = ['delivered', 'cancelled'].includes(d.status)
                  const openNotes = !!notesOpen[d.id]
                  return (
                    <div key={keyFor(d)} className="relative group rounded border bg-card text-card-foreground p-3 shadow-sm">
                      {selectionMode && (
                        <div className="absolute left-2 top-2 z-10">
                          <Checkbox checked={!!selectedIds[d.id]} onCheckedChange={() => toggleSelect(d.id)} />
                        </div>
                      )}
                      <div className={`${selectionMode ? 'pl-8' : ''}`}>
                        <div className="flex items-center justify-between mb-1">
                          <Badge variant="outline" className="text-xs">Single</Badge>
                          {d.codAmount != null && (
                            <div className="text-xs text-muted-foreground">
                              COD <span className="font-medium">{currency(Number(d.codAmount))}</span>
                            </div>
                          )}
                        </div>

                        <DeliveryCard familyId={familyId} {...props} />

                        {!selectionMode && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setNotesOpen((m) => ({ ...m, [d.id]: !m[d.id] }))
                              }
                            >
                              <MessageSquareText className="h-4 w-4 mr-1" />
                              {openNotes ? 'Hide Notes' : 'Notes'}
                            </Button>
                            {!locked && (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                  setEditingDelivery(d)
                                  setOpenForm(true)
                                }}
                              >
                                Edit
                              </Button>
                            )}
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleDelete(d.id)}
                            >
                              Delete
                            </Button>
                          </div>
                        )}

                        {openNotes && (
                          <div className="mt-3">
                            <DeliveryNotesThread familyId={familyId} deliveryId={d.id} />
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* ---------------- Multiple Deliveries ---------------- */}
          <section className="mt-8">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-lg font-semibold">Multiple Deliveries</h3>
              <Badge variant="secondary">{multiples.length}</Badge>
            </div>

            {multiples.length === 0 ? (
              <p className="text-muted-foreground text-sm">No multiple deliveries</p>
            ) : (
              <div className="space-y-4">
                {multiples.map((d) => {
                  const props = d.type === 'order' ? { order: d } : { delivery: d }
                  const locked = ['delivered', 'cancelled'].includes(d.status)
                  const openNotes = !!notesOpen[d.id]
                  const items = Array.isArray(d.items) ? d.items : []
                  const total = itemsTotal(items) || (typeof d.codAmount === 'number' ? d.codAmount : 0)

                  return (
                    <div key={keyFor(d)} className="relative group rounded border bg-card text-card-foreground p-3 shadow-sm">
                      {selectionMode && (
                        <div className="absolute left-2 top-2 z-10">
                          <Checkbox checked={!!selectedIds[d.id]} onCheckedChange={() => toggleSelect(d.id)} />
                        </div>
                      )}
                      <div className={`${selectionMode ? 'pl-8' : ''}`}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">Multiple</Badge>
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Package className="h-3.5 w-3.5" />
                              {items.length || d.itemCount || 0} item{(items.length || d.itemCount || 0) === 1 ? '' : 's'}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Total <span className="font-medium">{currency(total)}</span>
                          </div>
                        </div>

                        {/* ✅ Keep DeliveryCard only — no extra "View items" toggle here */}
                        <DeliveryCard familyId={familyId} {...props} />

                        {!selectionMode && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setNotesOpen((m) => ({ ...m, [d.id]: !m[d.id] }))
                              }
                            >
                              <MessageSquareText className="h-4 w-4 mr-1" />
                              {openNotes ? 'Hide Notes' : 'Notes'}
                            </Button>
                            {!locked && (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                  setEditingDelivery(d)
                                  setOpenForm(true)
                                }}
                              >
                                Edit
                              </Button>
                            )}
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleDelete(d.id)}
                            >
                              Delete
                            </Button>
                          </div>
                        )}

                        {openNotes && (
                          <div className="mt-3">
                            <DeliveryNotesThread familyId={familyId} deliveryId={d.id} />
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </>
      )}

      {/* Sticky bulk actions */}
      <BulkEditBar
        visible={selectionMode}
        selectedCount={selectedCount}
        onEdit={handleBulkEdit}
        onDelete={handleBulkDelete}
        onCancel={handleCancel}
      />

      {/* Form Dialog */}
      <DeliveryFormDialog
        {...({ open: openForm, onOpenChange: setOpenForm, familyId, delivery: editingDelivery } as any)}
      />

      {/* Simple toast */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 bg-foreground text-background px-4 py-2 rounded shadow z-50">
          {toastMessage}
        </div>
      )}

      {/* ✅ Confirm dialog */}
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open) {
            if (confirmResolveRef.current) {
              const cb = confirmResolveRef.current
              confirmResolveRef.current = null
              cb(false)
            }
            setConfirmOpen(false)
          } else {
            setConfirmOpen(true)
          }
        }}
      >
        <AlertDialogContent aria-describedby={undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTitle || 'Are you sure?'}</AlertDialogTitle>
            {confirmMessage ? (
              <AlertDialogDescription>{confirmMessage}</AlertDialogDescription>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => handleConfirmResult(false)}>
              {confirmCancelLabel}
            </AlertDialogCancel>
            <AlertDialogAction
              className={confirmDanger ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}
              onClick={() => handleConfirmResult(true)}
            >
              {confirmConfirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
