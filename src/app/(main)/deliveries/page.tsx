/* eslint-disable */
'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import {
  collection, query, where, orderBy, onSnapshot, doc,
  getDoc, updateDoc, setDoc, deleteDoc,
} from 'firebase/firestore'

import { firestore } from '@/lib/firebase'
import { useAuth } from '@/lib/useAuth'
import FamilyPicker from '@/app/components/FamilyPicker'
import { Button } from '@/components/ui/button'
import { Plus, Loader2, MessageSquareText } from 'lucide-react'
import DeliveryFormDialog from '@/app/components/DeliveryFormDialog'
import DeliveryCard from '@/app/components/DeliveryCard'
import { Skeleton } from '@/components/ui/skeleton'
import ConfirmDialog from '@/app/components/ConfirmDialog'
import { Checkbox } from '@/components/ui/checkbox'
import { useRouter } from 'next/navigation'
import { useOnlineStatus } from '@/lib/hooks/useOnlinestatus'
import DeliveryNotesThread from '@/app/components/delivery-notes/DeliveryNotesThread'

const LOCAL_FAMILY_KEY = 'abot:selectedFamily'

export default function DeliveriesPage() {
  const { user, loading: authLoading } = useAuth()

  const [families, setFamilies] = useState<any[]>([])
  const [familiesLoading, setFamiliesLoading] = useState(true)
  const [familyId, setFamilyId] = useState<string | null>(null)

  const [deliveries, setDeliveries] = useState<any[]>([])
  const [loadingDeliveries, setLoadingDeliveries] = useState(true)
  const [tab, setTab] = useState<'upcoming' | 'archived'>('upcoming')

  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({})

  const [openForm, setOpenForm] = useState(false)
  const [editingDelivery, setEditingDelivery] = useState<any | null>(null)

  const [unsubDeliveries, setUnsubDeliveries] = useState<() => void>(() => () => {})
  const confirmResolveRef = useRef<((v: boolean) => void) | null>(null)
  const [confirmTitle, setConfirmTitle] = useState<string>('')
  const [confirmMessage, setConfirmMessage] = useState<string>('') // ✅ fixed typo
  const [confirmDanger, setConfirmDanger] = useState<boolean>(false)
  const [confirmConfirmLabel, setConfirmConfirmLabel] = useState<string>('Proceed')
  const [confirmCancelLabel, setConfirmCancelLabel] = useState<string>('Cancel')
  const [confirmOpen, setConfirmOpen] = useState(false)

  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const toastTimerRef = useRef<number | null>(null)

  const [notesOpen, setNotesOpen] = useState<Record<string, boolean>>({}) // per-delivery notes toggles

  const router = useRouter()
  const isOnline = useOnlineStatus()

  const handleConfirmResult = (ok: boolean) => {
    const cb = confirmResolveRef.current
    confirmResolveRef.current = null
    setConfirmOpen(false)
    cb?.(ok)
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
  }) => new Promise<boolean>((resolve) => {
    confirmResolveRef.current = resolve
    setConfirmTitle(title)
    setConfirmMessage(message)
    setConfirmDanger(!!opts?.danger)
    setConfirmConfirmLabel(opts?.confirmLabel || 'Proceed')
    setConfirmCancelLabel(opts?.cancelLabel || 'Cancel')
    setConfirmOpen(true)
  }), [])

  // Families
  useEffect(() => {
    let unsub: (() => void) | null = null
    ;(async () => {
      if (!user?.uid) {
        setFamilies([]); setFamilyId(null); setFamiliesLoading(false)
        return
      }

      setFamiliesLoading(true)
      const q = query(collection(firestore, 'families'), where('members', 'array-contains', user.uid))
      const unsubFn = onSnapshot(q, async (snapshot) => {
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
            }
          }
          setFamilyId(preferred || list[0].id)
        }
        setFamiliesLoading(false)
      }, (err) => {
        console.error('[Families] snapshot error', err)
        setFamiliesLoading(false)
      })
      unsub = () => unsubFn()
    })()
    return () => { try { unsub?.() } catch {} }
  }, [user?.uid]) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist selection
  const selectFamily = async (id: string | null) => {
    setFamilyId(id)
    if (!user?.uid) return
    try { localStorage.setItem(LOCAL_FAMILY_KEY, id || '') } catch {}
    try { await updateDoc(doc(firestore, 'users', user.uid), { preferredFamily: id }) }
    catch { await setDoc(doc(firestore, 'users', user.uid), { preferredFamily: id }, { merge: true }) }
  }

  // deliveries listener
  useEffect(() => {
    if (!familyId) return

    setLoadingDeliveries(true)
    try { unsubDeliveries?.() } catch {}
    const q = query(
      collection(firestore, 'families', familyId, 'deliveries'),
      orderBy('createdAt', 'desc')
    )
    const unsub = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
      setDeliveries(list)
      setLoadingDeliveries(false)
    }, (err) => {
      console.error('[DeliveriesPage] snapshot error', err)
      setLoadingDeliveries(false)
    })

    setUnsubDeliveries(() => unsub)
    return () => { try { unsub() } catch { } }
  }, [familyId, user?.uid]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- Partition & filtering ---------------- */
  const isArchived = useCallback((d: any) => {
    if (!d) return false
    if (d.archived === true) return true
    if (['delivered', 'cancelled'].includes(d.status)) return true
    return false
  }, [])

  const upcoming = useMemo(() => deliveries.filter((d) => !isArchived(d)), [deliveries, isArchived])
  const archived = useMemo(() => deliveries.filter((d) => isArchived(d)), [deliveries, isArchived])

  const bulksToRender = useMemo(() => deliveries.filter((d) => d.type !== 'delivery'), [deliveries])

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
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 rounded text-sm ${tab === t ? 'bg-background shadow border' : 'text-muted-foreground'}`}
            >
              {t === 'upcoming' ? 'Upcoming' : 'Archived'}
            </button>
          ))}
        </div>

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
          <div className="flex justify-center">
            <Button onClick={() => router.push('/family')}>Go to Family</Button>
          </div>
        </div>
      ) : (
        <>
          {/* Upcoming / Archived lists */}
          <section>
            <h3 className="text-lg font-semibold mb-2">{tab === 'upcoming' ? 'Upcoming' : 'Archived'}</h3>
            {applyFilters((tab === 'upcoming' ? upcoming : archived)).length === 0 ? (
              <p className="text-muted-foreground text-sm">No deliveries</p>
            ) : (
              <div className="space-y-4">
                {applyFilters((tab === 'upcoming' ? upcoming : archived)).map((d) => {
                  const props = d.type === 'order' ? { order: d } : { delivery: d }
                  const locked = ['delivered', 'cancelled'].includes(d.status)
                  const isOpen = !!notesOpen[d.id]
                  return (
                    <div key={keyFor(d)} className="relative group rounded border bg-card text-card-foreground p-3 shadow-sm">
                      {selectionMode && (
                        <div className="absolute left-2 top-2 z-10">
                          <Checkbox checked={!!selectedIds[d.id]} onCheckedChange={() => toggleSelect(d.id)} />
                        </div>
                      )}
                      <div className={`${selectionMode ? 'pl-8' : ''}`}>
                        <DeliveryCard familyId={familyId!} {...props} />

                        {/* Row actions */}
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
                              {isOpen ? 'Hide Notes' : 'Notes'}
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

                        {/* Notes thread */}
                        {isOpen && (
                          <div className="mt-3">
                            <DeliveryNotesThread familyId={familyId!} deliveryId={d.id} />
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
                  const locked = ['delivered', 'cancelled'].includes(d.status)
                  const isOpen = !!notesOpen[d.id]
                  return (
                    <div key={keyFor(d)} className="relative group rounded border bg-card text-card-foreground p-3 shadow-sm">
                      {selectionMode && (
                        <div className="absolute left-2 top-2 z-10">
                          <Checkbox checked={!!selectedIds[d.id]} onCheckedChange={() => toggleSelect(d.id)} />
                        </div>
                      )}
                      <div className={`${selectionMode ? 'pl-8' : ''}`}>
                        <DeliveryCard familyId={familyId!} {...props} />

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
                              {isOpen ? 'Hide Notes' : 'Notes'}
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

                        {isOpen && (
                          <div className="mt-3">
                            <DeliveryNotesThread familyId={familyId!} deliveryId={d.id} />
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

      {/* Mobile FAB */}
      <Button
        type="button"
        onClick={() => {
          setEditingDelivery(null)
          setOpenForm(true)
        }}
        disabled={!familyId}
        className="sm:hidden fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 rounded-full h-14 w-14 shadow-lg"
      >
        <Plus className="w-5 h-5" />
      </Button>

      {/* Form Dialog (prop shape bridged) */}
      {familyId && (
        <DeliveryFormDialog
          {...({ open: openForm, onOpenChange: setOpenForm, familyId, delivery: editingDelivery } as any)}
        />
      )}
    </div>
  )
}
