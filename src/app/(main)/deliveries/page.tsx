'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import {
  collection, query, where, orderBy, onSnapshot, doc,
  getDoc, updateDoc, setDoc, deleteDoc, Timestamp,
} from 'firebase/firestore'

import { firestore } from '@/lib/firebase'
import { useAuth } from '@/lib/useAuth'
import FamilyPicker from '@/app/components/FamilyPicker'
import { Button } from '@/components/ui/button'
import { Plus, Loader2 } from 'lucide-react'
import DeliveryFormDialog from '@/app/components/DeliveryFormDialog'
import DeliveryCard from '@/app/components/DeliveryCard'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import ConfirmDialog from '@/app/components/ConfirmDialog'
import { useOnlineStatus } from '@/lib/hooks/useOnlinestatus'
import { useRouter } from 'next/navigation'

// Types
type Family = { id: string; name?: string }

const LOCAL_FAMILY_KEY = 'abot:selectedFamily'
const ARCHIVE_OLDER_THAN_DAYS = 30

export default function DeliveriesPage() {
  const { user, loading: authLoading } = useAuth()
  const [familyId, setFamilyId] = useState<string | null>(null)
  const [families, setFamilies] = useState<Family[]>([])
  const [familiesLoading, setFamiliesLoading] = useState(true)

  const [deliveries, setDeliveries] = useState<any[]>([])
  const [loadingDeliveries, setLoadingDeliveries] = useState(true)
  const [openForm, setOpenForm] = useState(false)
  const [unsubDeliveries, setUnsubDeliveries] = useState<(() => void) | null>(null)

  const [tab, setTab] = useState<'upcoming' | 'archived'>('upcoming')
  const [queryText, setQueryText] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'in_transit' | 'delivered' | 'cancelled'>('all')

  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({})
  const [processingBulk, setProcessingBulk] = useState(false)

  const [editingDelivery, setEditingDelivery] = useState<any | null>(null)
  const [editDialogOpen, setEditDialogOpen] = useState(false)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const confirmResolveRef = useRef<(v: boolean) => void | null>(null)
  const [confirmTitle, setConfirmTitle] = useState<string>('')
  const [confirmMessage, setConfirmMessage] = useState<string>('')
  const [confirmDanger, setConfirmDanger] = useState<boolean>(false)
  const [confirmConfirmLabel, setConfirmConfirmLabel] = useState<string>('Proceed')
  const [confirmCancelLabel, setConfirmCancelLabel] = useState<string>('Cancel')

  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const toastTimerRef = useRef<number | null>(null)

  const router = useRouter()

  const isOnline = useOnlineStatus()
  if (!isOnline) {
    return <p className="text-center text-destructive">You're offline — cached content only.</p>
  }

  const showToast = (msg: string) => {
    setToastMessage(msg)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToastMessage(null), 3500)
  }

  const showConfirm = useCallback((title: string, message: string, opts?: {
    danger?: boolean
    confirmLabel?: string
    cancelLabel?: string
  }) => {
    return new Promise<boolean>((resolve) => {
      setConfirmTitle(title)
      setConfirmMessage(message)
      setConfirmDanger(!!opts?.danger)
      setConfirmConfirmLabel(opts?.confirmLabel ?? 'Proceed')
      setConfirmCancelLabel(opts?.cancelLabel ?? 'Cancel')
      confirmResolveRef.current = resolve
      setConfirmOpen(true)
    })
  }, [])

  function handleConfirmResult(result: boolean) {
    setConfirmOpen(false)
    if (confirmResolveRef.current) {
      confirmResolveRef.current(result)
      confirmResolveRef.current = null
    }
  }

  // Auth gate
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login')
    }
  }, [user, authLoading, router])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (familyId) return
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem(LOCAL_FAMILY_KEY) : null
      if (stored) {
        setFamilyId(stored)
        return
      }
    } catch { }
    if (user?.uid) {
      ; (async () => {
        const snap = await getDoc(doc(firestore, 'users', user.uid))
        if (snap.exists()) {
          const data = snap.data() as any
          if (data?.preferredFamily) {
            setFamilyId(data.preferredFamily)
            try { localStorage.setItem(LOCAL_FAMILY_KEY, data.preferredFamily) } catch { }
          }
        }
      })()
    }
  }, [user?.uid, familyId])

  useEffect(() => {
    if (!user?.uid) {
      setFamilies([]); setFamilyId(null); setFamiliesLoading(false)
      return
    }

    setFamiliesLoading(true)
    const q = query(collection(firestore, 'families'), where('members', 'array-contains', user.uid))
    const unsub = onSnapshot(q, async (snapshot) => {
      const list = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
      setFamilies(list)

      if (familyId && !list.some((f) => f.id === familyId)) {
        try { localStorage.removeItem(LOCAL_FAMILY_KEY) } catch { }
        const userRef = doc(firestore, 'users', user.uid)
        await updateDoc(userRef, { preferredFamily: null }).catch(() => {
          return setDoc(userRef, { preferredFamily: null }, { merge: true })
        })

        if (list.length > 0) {
          setFamilyId(list[0].id)
          try { localStorage.setItem(LOCAL_FAMILY_KEY, list[0].id) } catch { }
        } else setFamilyId(null)
      } else if (!familyId && list.length > 0) {
        let preferred: string | null = null
        try { preferred = localStorage.getItem(LOCAL_FAMILY_KEY) } catch { }
        if (!preferred) {
          const snap = await getDoc(doc(firestore, 'users', user.uid))
          if (snap.exists()) {
            const data = snap.data() as any
            preferred = data?.preferredFamily
            if (preferred) localStorage.setItem(LOCAL_FAMILY_KEY, preferred)
          }
        }
        setFamilyId(preferred && list.some((f) => f.id === preferred) ? preferred : list[0].id)
      }

      setFamiliesLoading(false)
    }, (err) => {
      console.warn('[DeliveriesPage] families error', err)
      setFamiliesLoading(false)
    })

    return () => unsub()
  }, [user?.uid, familyId])

  const selectFamily = useCallback(async (id: string | null) => {
    setFamilyId(id)
    try {
      id ? localStorage.setItem(LOCAL_FAMILY_KEY, id) : localStorage.removeItem(LOCAL_FAMILY_KEY)
    } catch { }
    if (!user?.uid) return
    const userRef = doc(firestore, 'users', user.uid)
    await updateDoc(userRef, { preferredFamily: id }).catch(() => {
      return setDoc(userRef, { preferredFamily: id }, { merge: true })
    })
  }, [user?.uid])

  useEffect(() => {
    if (unsubDeliveries) try { unsubDeliveries() } catch { }
    if (!familyId || !user?.uid) {
      setDeliveries([]); setLoadingDeliveries(false)
      return
    }

    setLoadingDeliveries(true)
    const q = query(
      collection(firestore, 'families', familyId, 'deliveries'),
      where('createdBy', '==', user.uid),
      orderBy('expectedDate', 'asc')
    )

    const unsub = onSnapshot(q, (snap) => {
      setDeliveries(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))
      setLoadingDeliveries(false)
    }, (err) => {
      console.error('[DeliveriesPage] snapshot error', err)
      setLoadingDeliveries(false)
    })

    setUnsubDeliveries(() => unsub)
    return () => { try { unsub() } catch { } }
  }, [familyId, user?.uid])

  const { singleDeliveries, bulkDeliveries } = useMemo(() => {
    const single: any[] = [], bulk: any[] = []
    for (const d of deliveries) {
      const count = typeof d.itemCount === 'number' ? d.itemCount : 1
      if (d.type === 'bulk' || d.type === 'order' || count > 1) bulk.push(d)
      else single.push(d)
    }
    return { singleDeliveries: single, bulkDeliveries: bulk }
  }, [deliveries])

  const isArchived = useCallback((d: any) => {
    if (!d) return false
    if (['delivered', 'cancelled'].includes(d.status)) return true
    const raw = d.expectedDate
    const expected = raw?.toDate?.() || (raw?.seconds && new Date(raw.seconds * 1000)) || new Date(raw)
    if (!expected) return false
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - ARCHIVE_OLDER_THAN_DAYS)
    return expected < cutoff
  }, [])

  const singlesToRender = useMemo(() => (tab === 'upcoming' ? singleDeliveries : singleDeliveries.filter(isArchived)), [tab, singleDeliveries, isArchived])
  const bulksToRender = useMemo(() => (tab === 'upcoming' ? bulkDeliveries : bulkDeliveries.filter(isArchived)), [tab, bulkDeliveries, isArchived])

  const applyFilters = (list: any[]) =>
    list.filter((d) => {
      if (filterStatus !== 'all' && (d.status ?? 'pending') !== filterStatus) return false
      return !queryText || (d.title ?? d.platform ?? d.name ?? '').toLowerCase().includes(queryText.toLowerCase())
    })

  const toggleSelect = (id: string) => setSelectedIds((s) => ({ ...s, [id]: !s[id] }))
  const clearSelection = () => setSelectedIds({ })
  const selectedCount = Object.values(selectedIds).filter(Boolean).length

  const bulkDelete = async () => {
    if (selectedCount === 0) return showToast('No deliveries selected')
    const ok = await showConfirm('Delete deliveries?', `Delete ${selectedCount} delivery(ies)?`, { danger: true, confirmLabel: 'Delete' })
    if (!ok) return
    setProcessingBulk(true)
    try {
      const ids = Object.keys(selectedIds).filter((k) => selectedIds[k])
      await Promise.all(ids.map((id) =>
        deleteDoc(doc(firestore, 'families', familyId!, 'deliveries', id)).catch((err) => console.error('delete failed', id, err))
      ))
      clearSelection(); setSelectionMode(false); showToast('Deleted selected deliveries')
    } catch (err) {
      console.error(err); showToast('Bulk delete failed')
    } finally {
      setProcessingBulk(false)
    }
  }

  const bulkArchive = async () => {
    if (selectedCount === 0) return showToast('No deliveries selected')
    const ok = await showConfirm('Archive deliveries?', `Mark ${selectedCount} delivery(ies) as delivered?`)
    if (!ok) return
    setProcessingBulk(true)
    try {
      const ids = Object.keys(selectedIds).filter((k) => selectedIds[k])
      await Promise.all(ids.map((id) =>
        updateDoc(doc(firestore, 'families', familyId!, 'deliveries', id), {
          status: 'delivered', deliveredAt: Timestamp.now()
        }).catch((err) => console.error('archive failed', id, err))
      ))
      clearSelection(); setSelectionMode(false); showToast('Archived selected deliveries')
    } catch (err) {
      console.error(err); showToast('Bulk archive failed')
    } finally {
      setProcessingBulk(false)
    }
  }

  const onEditDelivery = (d: any) => { setEditingDelivery(d); setEditDialogOpen(true) }
  const onDeleteDelivery = async (id: string) => {
    const ok = await showConfirm('Delete delivery?', 'This cannot be undone.', { danger: true, confirmLabel: 'Delete' })
    if (!ok) return
    try { await deleteDoc(doc(firestore, 'families', familyId!, 'deliveries', id)); showToast('Deleted') }
    catch (err) { console.error('delete failed', err); showToast('Delete failed') }
  }

  const keyFor = (d: any) => `${d.id}-${d.updatedAt?.seconds || d.createdAt?.seconds || ''}`

  if (authLoading) {
    return (
      <main className="flex items-center justify-center h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </main>
    )
  }

  return (
    <div className="px-4 py-6 max-w-4xl mx-auto space-y-6 bg-background text-foreground">
      {/* Top controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1">
          {familiesLoading || authLoading ? (
            <div>
              <label className="text-sm text-muted-foreground">Viewing Dashboard for:</label>
              <Skeleton className="h-10 w-full mt-2" />
            </div>
          ) : (
            <FamilyPicker
              familyId={familyId}
              onFamilyChange={(id) => selectFamily(id)}
              families={families}
              loading={familiesLoading}
            />
          )}
        </div>

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
            disabled={!familyId}
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
              type="button"
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 rounded text-sm font-medium ${
                tab === t ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground'
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        <input
          type="text"
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
            You haven't joined or created a family yet. Deliveries require a family group.
          </p>
          <div className="flex justify-center gap-4">
            <Button type="button" onClick={() => router.push('/family')}>Go to Families</Button>
          </div>
        </div>
      ) : deliveries.length === 0 ? (
        <p className="text-muted-foreground text-sm">No deliveries yet.</p>
      ) : (
        <>
          {/* Single Deliveries */}
          <section>
            <h3 className="text-lg font-semibold mb-2">Single Deliveries</h3>
            {applyFilters(singlesToRender).length === 0 ? (
              <p className="text-muted-foreground mb-4 text-sm">No single deliveries</p>
            ) : (
              <div className="space-y-4">
                {applyFilters(singlesToRender).map((d) => {
                  const props = d.type === 'order' ? { order: d } : { delivery: d }
                  return (
                    <div key={keyFor(d)} className="relative group w-full rounded border bg-card text-card-foreground p-3 shadow-sm">
                      {selectionMode && (
                        <div className="absolute left-2 top-2 z-10">
                          <Checkbox checked={!!selectedIds[d.id]} onCheckedChange={() => toggleSelect(d.id)} />
                        </div>
                      )}
                      <div className={`${selectionMode ? 'pl-8' : ''}`}>
                        <DeliveryCard familyId={familyId!} {...props} />
                        {!selectionMode && (
                          <div className="flex justify-end gap-2 mt-2">
                            <Button type="button" size="sm" variant="ghost" onClick={() => onEditDelivery(d)}>Edit</Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => onDeleteDelivery(d.id)}>Delete</Button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* Bulk Deliveries */}
          <section className="mt-8">
            <h3 className="text-lg font-semibold mb-2">Bulk Deliveries</h3>
            {applyFilters(bulksToRender).length === 0 ? (
              <p className="text-muted-foreground text-sm">No bulk deliveries</p>
            ) : (
              <div className="space-y-4">
                {applyFilters(bulksToRender).map((d) => {
                  const props = d.type === 'order' ? { order: d } : { delivery: d }
                  return (
                    <div key={keyFor(d)} className="relative group w-full rounded border bg-card text-card-foreground p-3 shadow-sm">
                      {selectionMode && (
                        <div className="absolute left-2 top-2 z-10">
                          <Checkbox checked={!!selectedIds[d.id]} onCheckedChange={() => toggleSelect(d.id)} />
                        </div>
                      )}
                      <div className={`${selectionMode ? 'pl-8' : ''}`}>
                        <DeliveryCard familyId={familyId!} {...props} />
                        {!selectionMode && (
                          <div className="flex justify-end gap-2 mt-2">
                            <Button type="button" size="sm" variant="ghost" onClick={() => onEditDelivery(d)}>Edit</Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => onDeleteDelivery(d.id)}>Delete</Button>
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

      {/* Bulk actions toolbar */}
      {selectionMode && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-card text-card-foreground border rounded shadow-md px-6 py-3 flex items-center gap-4 z-50">
          <span className="text-sm">{selectedCount} selected</span>
          <Button type="button" onClick={bulkArchive} disabled={processingBulk || selectedCount === 0}>Archive</Button>
          <Button type="button" variant="destructive" onClick={bulkDelete} disabled={processingBulk || selectedCount === 0}>Delete</Button>
          <Button type="button" variant="ghost" onClick={() => { setSelectionMode(false); clearSelection() }}>Cancel</Button>
        </div>
      )}

      {/* Dialogs */}
      <DeliveryFormDialog
        open={openForm || editDialogOpen}
        onOpenChange={(v) => { setOpenForm(v); if (!v) setEditDialogOpen(false) }}
        familyId={familyId ?? ''}
        delivery={editingDelivery ?? undefined}
      />

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(v) => { setConfirmOpen(v); if (!v) handleConfirmResult(false) }}
        title={confirmTitle}
        description={confirmMessage}
        danger={confirmDanger}
        confirmLabel={confirmConfirmLabel}
        cancelLabel={confirmCancelLabel}
        onConfirm={() => handleConfirmResult(true)}
        onCancel={() => handleConfirmResult(false)}
      />

      {/* Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 bg-foreground text-background px-4 py-2 rounded shadow z-50">
          {toastMessage}
        </div>
      )}
    </div>
  )
}
