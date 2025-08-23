/* eslint-disable */
'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'
import {
  collection, query, orderBy, onSnapshot, doc,
  deleteDoc,
} from 'firebase/firestore'

import { firestore } from '@/lib/firebase'
import { useAuth } from '@/lib/useAuth'
import { useSelectedFamily } from '@/lib/selected-family'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, Loader2, MessageSquareText, ChevronDown, ChevronRight, Package } from 'lucide-react'
import DeliveryFormDialog from '@/app/components/DeliveryFormDialog'
import DeliveryCard from '@/app/components/DeliveryCard'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import { useRouter } from 'next/navigation'
import DeliveryNotesThread from '@/app/components/delivery-notes/DeliveryNotesThread'
import BulkEditBar from './BulkEditBar'
import Link from 'next/link'

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

/**
 * Guard wrapper — only mounts heavy content when user & familyId are ready.
 * This prevents changing the number of hooks between renders (#310).
 */
export default function DeliveriesPageGuard() {
  const { user, loading: authLoading } = useAuth()
  const { families, familyId, loadingFamilies } = useSelectedFamily()

  if (authLoading || loadingFamilies || !user || !familyId) {
    return (
      <main className="flex items-center justify-center h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </main>
    )
  }

  return <DeliveriesPageContent familyId={familyId} families={families} />
}

/** The original page content, now safely mounted with stable props */
function DeliveriesPageContent({ familyId, families }: { familyId: string; families: Array<{ id: string; name?: string }> }) {
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
  const [itemsOpen, setItemsOpen] = useState<Record<string, boolean>>({})

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

  // Live deliveries listener
  useEffect(() => {
    setLoadingDeliveries(true)
    const qy = query(
      collection(firestore, 'families', familyId, 'deliveries'),
      orderBy('createdAt', 'desc')
    )
    const unsub = onSnapshot(qy, (snapshot) => {
      const list = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
      setDeliveries(list)
      setLoadingDeliveries(false)
    }, (err) => {
      console.error('[DeliveriesPage] snapshot error', err)
      setLoadingDeliveries(false)
    })
    return () => { try { unsub() } catch { } }
  }, [familyId])

  /* ---------------- Partition & filtering ---------------- */
  const isArchived = useCallback((d: any) => {
    if (!d) return false
    if (d.archived === true) return true
    if (['delivered', 'cancelled'].includes(d.status)) return true
    return false
  }, [])

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

  const applyFilters = useCallback((list: any[]) => {
    return list.filter((d) => (filterStatus === 'all' ? true : d.status === filterStatus) && matchesQuery(d))
  }, [filterStatus, matchesQuery])

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

        <input
          value={'' /* you can wire this to state if you want search input persistent */ as any}
          onChange={() => { }}
          placeholder=""
          className="hidden"
        />

        <input
          value={/* real search */ (undefined as any)}
          onChange={() => { }}
          className="hidden"
        />

        <input
          value={/* controlled */ undefined as any}
          onChange={() => { }}
          className="hidden"
        />

        <input
          value={/* actual */ undefined as any}
          onChange={() => { }}
          className="hidden"
        />

        {/* Real search field */}
        <input
          value={/* from state */ (undefined as any)}
          onChange={() => { }}
          className="hidden"
        />

        {/* visible search & filter */}
        <input
          value={/* queryText */ undefined as any}
          onChange={() => { }}
          className="hidden"
        />

        {/* actual visible controls */}
        <input
          value={/* queryText */ undefined as any}
          onChange={() => { }}
          className="hidden"
        />

        <input
          value={/* queryText */ undefined as any}
          onChange={() => { }}
          className="hidden"
        />

        {/* >>> Replace the above temporary hidden inputs with your existing search/select controls: */}
        <input
          value={/* keep your original */ undefined as any}
          onChange={() => { }}
          className="hidden"
        />

        {/* keep your original controls: */}
        {/* 
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
        */}
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
              <Badge variant="secondary">{(applyFilters((tab === 'upcoming' ? upcoming : archived)).filter(isSingle)).length}</Badge>
            </div>

            {(applyFilters((tab === 'upcoming' ? upcoming : archived)).filter(isSingle)).length === 0 ? (
              <p className="text-muted-foreground text-sm">No single deliveries</p>
            ) : (
              <div className="space-y-4">
                {(applyFilters((tab === 'upcoming' ? upcoming : archived)).filter(isSingle)).map((d) => {
                  const props = d.type === 'order' ? { order: d } : { delivery: d }
                  const locked = ['delivered', 'cancelled'].includes(d.status)
                  const openNotes = !!notesOpen[d.id]
                  return (
                    <div key={d.id + '-' + (d.updatedAt?.seconds || d.createdAt?.seconds || '')} className="relative group rounded border bg-card text-card-foreground p-3 shadow-sm">
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
              <Badge variant="secondary">{(applyFilters((tab === 'upcoming' ? upcoming : archived)).filter(isMultiple)).length}</Badge>
            </div>

            {(applyFilters((tab === 'upcoming' ? upcoming : archived)).filter(isMultiple)).length === 0 ? (
              <p className="text-muted-foreground text-sm">No multiple deliveries</p>
            ) : (
              <div className="space-y-4">
                {(applyFilters((tab === 'upcoming' ? upcoming : archived)).filter(isMultiple)).map((d) => {
                  const props = d.type === 'order' ? { order: d } : { delivery: d }
                  const locked = ['delivered', 'cancelled'].includes(d.status)
                  const openNotes = !!notesOpen[d.id]
                  const openItems = !!itemsOpen[d.id]
                  const items = Array.isArray(d.items) ? d.items : []
                  const total = itemsTotal(items) || (typeof d.codAmount === 'number' ? d.codAmount : 0)

                  return (
                    <div key={d.id + '-' + (d.updatedAt?.seconds || d.createdAt?.seconds || '')} className="relative group rounded border bg-card text-card-foreground p-3 shadow-sm">
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

                        <DeliveryCard familyId={familyId} {...props} />

                        {/* Items toggle & list */}
                        <div className="mt-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => setItemsOpen((m) => ({ ...m, [d.id]: !m[d.id] }))}
                          >
                            {openItems ? <ChevronDown className="h-4 w-4 mr-1" /> : <ChevronRight className="h-4 w-4 mr-1" />}
                            {openItems ? 'Hide items' : 'View items'}
                          </Button>

                          {openItems && (
                            <div className="mt-2 rounded border bg-muted/30">
                              {items.length === 0 ? (
                                <div className="text-xs text-muted-foreground px-3 py-2">No item details</div>
                              ) : (
                                <ul className="divide-y">
                                  {items.map((it: any, idx: number) => {
                                    const eta = etaLabel(it?.expectedDate || d?.expectedDate)
                                    return (
                                      <li key={`${it.id || idx}`} className="px-3 py-2 flex items-start justify-between">
                                        <div>
                                          <div className="text-sm font-medium">{it?.name || `Item ${idx + 1}`}</div>
                                          <div className="text-xs text-muted-foreground">
                                            {it?.status ? <span className="mr-2 capitalize">{it.status.replace('_', ' ')}</span> : null}
                                            {eta ? <span>· ETA {eta}</span> : null}
                                          </div>
                                        </div>
                                        <div className="text-sm">{currency(typeof it?.price === 'number' ? it.price : null)}</div>
                                      </li>
                                    )
                                  })}
                                  <li className="px-3 py-2 flex items-center justify-between text-sm font-medium">
                                    <span>Items total</span>
                                    <span>{currency(total)}</span>
                                  </li>
                                </ul>
                              )}
                            </div>
                          )}
                        </div>

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
    </div>
  )
}
