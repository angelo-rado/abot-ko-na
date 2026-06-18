'use client'

import React, { useEffect, useState, useRef } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { collection, addDoc, Timestamp, doc, updateDoc, getDocs, deleteDoc, writeBatch } from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { createDelivery } from '@/lib/deliveries'
import { motion, AnimatePresence } from 'framer-motion'
import { Textarea } from '@/components/ui/textarea'
import { enqueue, isOnline } from '@/lib/offline'
import { db } from '@/lib/db'
import { toast } from 'sonner'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'

type DeliveryStatus = 'pending' | 'in_transit' | 'delivered' | 'cancelled'

type DeliveryFormValues = {
  title: string
  expectedDate: string
  codAmount: number | null
  status: DeliveryStatus
  note?: string
  receiverNote?: string
  courier?: string
  trackingNumber?: string
}

type ItemRow = {
  id: string
  name: string
  price: number | null
  expectedDate: string
  note?: string
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  familyId: string
  delivery?: any | null
}

// ---- Time helpers (LOCAL) ----
const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`)

/** Local "YYYY-MM-DDTHH:mm" string at 23:59 for today + daysFromToday. */
function localEndOfDayISO(daysFromToday = 0) {
  const d = new Date()
  d.setDate(d.getDate() + daysFromToday)
  d.setHours(23, 59, 0, 0)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T23:59`
}

/** Clamp an input "YYYY-MM-DDTHH:mm" to end-of-day LOCAL (23:59) */
function endOfDayFromLocalISO(iso: string): Date {
  const d = new Date(iso) // parsed as local time
  d.setHours(23, 59, 0, 0)
  return d
}

/** Parse Firestore timestamp-like to LOCAL datetime-local string */
function parseExpectedDate(d: any) {
  if (!d) return ''
  let dt: Date
  if (typeof d?.toDate === 'function') dt = d.toDate()
  else if (typeof d?.seconds === 'number') dt = new Date(d.seconds * 1000)
  else if (d instanceof Date) dt = d
  else dt = new Date(d)
  if (isNaN(dt.getTime())) return ''
  const y = dt.getFullYear()
  const m = pad(dt.getMonth() + 1)
  const day = pad(dt.getDate())
  const hh = pad(dt.getHours())
  const mm = pad(dt.getMinutes())
  return `${y}-${m}-${day}T${hh}:${mm}`
}

export default function DeliveryFormDialog({ open, onOpenChange, familyId, delivery }: Props) {
  const lastAddedItemIdRef = useRef<string | null>(null)
  const isEdit = !!delivery
  const initialExpectedRef = useRef<string | null>(null)

  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  const [values, setValues] = useState<DeliveryFormValues>({
    title: delivery?.title ?? '',
    expectedDate: delivery?.expectedDate ? parseExpectedDate(delivery.expectedDate) : localEndOfDayISO(0),
    codAmount: delivery?.codAmount ?? null,
    status: (delivery?.status as DeliveryStatus) ?? 'pending',
    note: delivery?.note ?? '',
    courier: delivery?.courier ?? '',
    trackingNumber: delivery?.trackingNumber ?? '',
  })

  const [items, setItems] = useState<ItemRow[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [pickCustom, setPickCustom] = useState(false)

  // Derived: more than one item => bulk; COD only makes sense for a single item.
  const isBulk = items.length > 1
  const todayDP = localEndOfDayISO(0).slice(0, 10)
  const tomorrowDP = localEndOfDayISO(1).slice(0, 10)
  const dateDP = values.expectedDate?.slice(0, 10) || ''
  const isToday = dateDP === todayDP
  const isTomorrow = dateDP === tomorrowDP

  // Auto-focus the name field of a newly added item row.
  useEffect(() => {
    const id = lastAddedItemIdRef.current
    if (!id) return
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLInputElement>(`[data-name-for="${id}"]`)
      if (el) { el.focus(); lastAddedItemIdRef.current = null }
    })
    return () => cancelAnimationFrame(raf)
  }, [items])

  // Clear the items error once any item exists.
  useEffect(() => {
    if (formErrors.items && items.length > 0) {
      setFormErrors((prev) => { const { items: _omit, ...rest } = prev; return rest })
    }
  }, [items.length, formErrors.items])

  // COD is per-item for bulk — drop a header COD if it becomes bulk.
  useEffect(() => {
    if (isBulk && values.codAmount != null) setValues((v) => ({ ...v, codAmount: null }))
  }, [isBulk, values.codAmount])

  // Reset for CREATE on open.
  useEffect(() => {
    if (!open || isEdit) return
    setValues({
      title: '',
      expectedDate: localEndOfDayISO(0),
      codAmount: null,
      status: 'pending',
      note: '',
      courier: '',
      trackingNumber: '',
    })
    initialExpectedRef.current = null
    setItems([])
    setShowDetails(false)
    setPickCustom(false)
    setFormErrors({})
  }, [open, isEdit])

  // Load values for EDIT mode (preserve exact times from Firestore).
  useEffect(() => {
    if (!delivery || !isEdit) return
    const expected = parseExpectedDate(delivery.expectedDate)
    setValues({
      title: delivery.title ?? '',
      expectedDate: expected || localEndOfDayISO(0),
      codAmount: delivery.codAmount ?? null,
      status: (delivery.status as DeliveryStatus) ?? 'pending',
      note: delivery.note ?? '',
      courier: delivery.courier ?? '',
      trackingNumber: delivery.trackingNumber ?? '',
    })
    initialExpectedRef.current = expected
    if (delivery.type !== 'bulk') setItems([])
    const dp = (expected || '').slice(0, 10)
    setPickCustom(dp !== todayDP && dp !== tomorrowDP)
    setShowDetails(!!(delivery.courier || delivery.trackingNumber || delivery.codAmount != null || (delivery.note && delivery.note.trim())))
    setFormErrors({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delivery, isEdit])

  // Fetch bulk items on edit (preserve each item's time).
  useEffect(() => {
    async function fetchItems() {
      if (!delivery || !delivery.id || delivery.type !== 'bulk') return
      const itemsCol = collection(firestore, 'families', familyId, 'deliveries', delivery.id, 'items')
      const snap = await getDocs(itemsCol)
      const rows: ItemRow[] = snap.docs.map((d) => {
        const data = d.data()
        return {
          id: d.id,
          name: data.name ?? '',
          price: data.price ?? null,
          expectedDate: parseExpectedDate(data.expectedDate),
          note: data.note ?? '',
        }
      })
      setItems(rows)
    }
    if (open && isEdit && delivery?.type === 'bulk') fetchItems()
  }, [open, isEdit, delivery, familyId])

  function setDate(daysFromToday: number) {
    setPickCustom(false)
    setValues((v) => ({ ...v, expectedDate: localEndOfDayISO(daysFromToday) }))
  }

  function addItemRow() {
    const newId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    lastAddedItemIdRef.current = newId
    setItems((prev) => [
      ...prev,
      { id: newId, name: '', price: null, expectedDate: values.expectedDate || localEndOfDayISO(0) },
    ])
  }

  function updateItemRow(id: string, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  function removeItemRow(id: string) {
    setItems((prev) => prev.filter((r) => r.id !== id))
  }

  const onSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()

    // OFFLINE PATH: enqueue write & mirror locally
    if (!isOnline()) {
      try {
        const now = Date.now()
        const tempId = `offline-${now}`
        const type = isBulk ? 'multiple' : 'single'
        const itemCount = items.length > 0 ? items.length : 1
        await db.deliveries.put({
          id: tempId,
          familyId: familyId!,
          title: values.title?.trim() || 'Untitled',
          type,
          amount: values.codAmount ?? null,
          note: values.note ?? '',
          eta: values.expectedDate ? Date.parse(values.expectedDate) : null,
          createdAt: now,
          updatedAt: now,
          itemCount,
        })
        await enqueue({
          op: 'addDelivery',
          familyId,
          payload: {
            familyId,
            id: tempId,
            payload: {
              title: values.title?.trim() || 'Untitled',
              type,
              amount: values.codAmount ?? null,
              note: values.note ?? '',
              courier: values.courier?.trim() || null,
              trackingNumber: values.trackingNumber?.trim() || null,
              expectedDate: values.expectedDate ? Date.parse(values.expectedDate) : null,
              createdAt: now,
              updatedAt: now,
              itemCount,
            },
          },
        })
        toast('Saved offline — will sync when online', { icon: '📶' })
        onOpenChange(false)
        return
      } catch {
        toast.error('Failed to save offline draft')
      }
    }

    setFormErrors({})
    const errors: Record<string, string> = {}

    if (!values.title.trim()) errors.title = 'Title is required'
    if (!values.expectedDate?.trim()) {
      errors.expectedDate = 'Expected date is required'
    } else if (endOfDayFromLocalISO(values.expectedDate) < new Date()) {
      errors.expectedDate = 'Expected date cannot be in the past'
    }

    // Validate any itemized rows (items are optional; the common case has none).
    if (items.length > 0) {
      const headerExpected = values.expectedDate ? endOfDayFromLocalISO(values.expectedDate) : null
      items.forEach((item, index) => {
        if (!item.name.trim()) errors[`item-${item.id}-name`] = `Item ${index + 1}: Name required`
        if (item.price === null || isNaN(item.price)) errors[`item-${item.id}-price`] = `Item ${index + 1}: Price required`
        if (item.expectedDate?.trim()) {
          const itemDate = endOfDayFromLocalISO(item.expectedDate)
          if (headerExpected && itemDate < headerExpected) errors[`item-${item.id}-date`] = `Item ${index + 1}: Date must be on or after the delivery date`
        }
      })
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
      return
    }

    setIsSaving(true)
    try {
      if (isEdit && delivery?.id) {
        // EDIT MODE — replace items, keep header time unless changed.
        const deliveryRef = doc(firestore, 'families', familyId, 'deliveries', delivery.id)
        const itemsCol = collection(deliveryRef, 'items')

        const existingItemsSnap = await getDocs(itemsCol)
        await Promise.all(existingItemsSnap.docs.map((d) => deleteDoc(d.ref)))

        const batch = writeBatch(firestore)
        items.forEach((it) => {
          const itemRef = doc(itemsCol)
          batch.set(itemRef, {
            name: it.name.trim(),
            price: it.price,
            status: 'pending',
            createdAt: Timestamp.now(),
            ...(it.expectedDate ? { expectedDate: Timestamp.fromDate(endOfDayFromLocalISO(it.expectedDate)) } : {}),
            ...(it.note ? { note: it.note.trim() } : {}),
          })
        })

        const updatePayload: any = {
          title: values.title.trim(),
          codAmount: isBulk ? null : (values.codAmount ?? null),
          status: values.status,
          note: values.note?.trim() || '',
          courier: values.courier?.trim() || null,
          trackingNumber: values.trackingNumber?.trim() || null,
          itemCount: items.length,
          type: isBulk ? 'bulk' : 'single',
          updatedAt: Timestamp.now(),
        }
        if (values.expectedDate !== initialExpectedRef.current) {
          updatePayload.expectedDate = values.expectedDate
            ? Timestamp.fromDate(endOfDayFromLocalISO(values.expectedDate))
            : null
        }

        batch.update(deliveryRef, updatePayload)
        await batch.commit()

        setItems([])
        onOpenChange(false)
        return
      }

      // CREATE MODE — clamp all times to 23:59 local.
      const headerDate = values.expectedDate ? endOfDayFromLocalISO(values.expectedDate) : undefined
      const created = await createDelivery(familyId, {
        title: values.title.trim(),
        status: 'pending',
        itemCount: 0,
        type: isBulk ? 'bulk' : 'single',
        codAmount: isBulk ? undefined : (values.codAmount ?? undefined),
        expectedDate: headerDate ?? undefined,
        note: values.note?.trim() || '',
        receiverNote: '',
        courier: values.courier?.trim() || null,
        trackingNumber: values.trackingNumber?.trim() || null,
      })

      const newId = created.id
      const itemsCol = collection(firestore, 'families', familyId, 'deliveries', newId, 'items')

      if (items.length > 0) {
        for (const it of items) {
          const itemDate = it.expectedDate?.trim() ? endOfDayFromLocalISO(it.expectedDate) : headerDate
          await addDoc(itemsCol, {
            name: it.name.trim(),
            price: it.price,
            status: 'pending',
            createdAt: Timestamp.now(),
            ...(itemDate ? { expectedDate: Timestamp.fromDate(itemDate) } : {}),
            ...(it.note ? { note: it.note.trim() } : {}),
          })
        }
        await updateDoc(doc(firestore, 'families', familyId, 'deliveries', newId), {
          itemCount: items.length,
          type: items.length > 1 ? 'bulk' : 'single',
          updatedAt: Timestamp.now(),
        })
      } else {
        // No explicit items: create one implicit item from the title.
        await addDoc(itemsCol, {
          name: values.title.trim() || 'Delivery',
          price: null,
          status: 'pending',
          createdAt: Timestamp.now(),
          ...(headerDate ? { expectedDate: Timestamp.fromDate(headerDate) } : {}),
        })
        await updateDoc(doc(firestore, 'families', familyId, 'deliveries', newId), {
          itemCount: 1,
          type: 'single',
          note: values.note?.trim() || '',
          receiverNote: '',
          updatedAt: Timestamp.now(),
        })
      }

      setItems([])
      onOpenChange(false)
    } catch (err) {
      console.error('DeliveryFormDialog submit err', err)
      toast.error('Failed to save delivery')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit delivery' : 'Add delivery'}</DialogTitle>
        </DialogHeader>

        <AnimatePresence>
          {isSaving && (
            <motion.div
              key="saving-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-10 flex items-center justify-center backdrop-blur-sm bg-background/70 rounded-md"
            >
              <div className="animate-spin h-6 w-6 border-2 border-muted-foreground border-t-transparent rounded-full" />
            </motion.div>
          )}
        </AnimatePresence>

        <form
          onSubmit={onSubmit}
          className={`space-y-4 transition-all duration-200 ${isSaving ? 'opacity-50 pointer-events-none blur-[1px]' : ''}`}
        >
          {/* Title */}
          <div>
            <Label htmlFor="title">What's arriving?</Label>
            <Input
              id="title"
              placeholder="e.g. Shopee order, groceries"
              value={values.title}
              onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))}
              required
              autoFocus
              className="mt-1"
            />
            {formErrors.title && <p className="text-sm text-red-500 mt-1">{formErrors.title}</p>}
          </div>

          {/* Expected date — friendly chips */}
          <div>
            <Label>Expected by</Label>
            <div className="mt-1 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant={isToday && !pickCustom ? 'default' : 'outline'} onClick={() => setDate(0)}>
                Today
              </Button>
              <Button type="button" size="sm" variant={isTomorrow && !pickCustom ? 'default' : 'outline'} onClick={() => setDate(1)}>
                Tomorrow
              </Button>
              <Button type="button" size="sm" variant={pickCustom ? 'default' : 'outline'} onClick={() => setPickCustom(true)}>
                Pick a date
              </Button>
            </div>
            {(pickCustom || (!isToday && !isTomorrow)) && (
              <input
                type="date"
                className="mt-2 block h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                value={dateDP}
                onChange={(e) => setValues((v) => ({ ...v, expectedDate: e.target.value ? `${e.target.value}T23:59` : '' }))}
              />
            )}
            {formErrors.expectedDate && <p className="text-sm text-red-500 mt-1">{formErrors.expectedDate}</p>}
          </div>

          {/* Status — edit only */}
          {isEdit && (
            <div>
              <Label htmlFor="status">Status</Label>
              <Select value={values.status} onValueChange={(val) => setValues((v) => ({ ...v, status: val as DeliveryStatus }))}>
                <SelectTrigger id="status" className="mt-1 w-full">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="in_transit">In Transit</SelectItem>
                  <SelectItem value="delivered">Delivered</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Optional details */}
          <div className="rounded-md border">
            <button
              type="button"
              onClick={() => setShowDetails((s) => !s)}
              className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium"
            >
              Add details {isBulk ? '' : '(courier, tracking, COD, notes)'}
              {showDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {showDetails && (
              <div className="space-y-3 border-t px-3 py-3">
                {!isBulk && (
                  <div>
                    <Label htmlFor="cod">COD amount</Label>
                    <Input
                      id="cod"
                      type="number"
                      min={0}
                      placeholder="₱ optional"
                      value={values.codAmount ?? ''}
                      onChange={(e) => setValues((v) => ({ ...v, codAmount: e.target.value ? Number(e.target.value) : null }))}
                      className="mt-1"
                    />
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="courier">Courier</Label>
                    <Input id="courier" placeholder="e.g. J&T, LBC, Lalamove" value={values.courier ?? ''} onChange={(e) => setValues((v) => ({ ...v, courier: e.target.value }))} className="mt-1" />
                  </div>
                  <div>
                    <Label htmlFor="trackingNumber">Tracking number</Label>
                    <Input id="trackingNumber" placeholder="e.g. 1234567890" value={values.trackingNumber ?? ''} onChange={(e) => setValues((v) => ({ ...v, trackingNumber: e.target.value }))} className="mt-1" />
                  </div>
                </div>
                <div>
                  <Label htmlFor="note">Notes</Label>
                  <Textarea id="note" value={values.note} onChange={(e) => setValues((v) => ({ ...v, note: e.target.value }))} className="mt-1" />
                </div>
              </div>
            )}
          </div>

          {/* Items (optional itemization) */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <Label>Items <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Button type="button" size="sm" variant="outline" onClick={addItemRow}>
                <Plus className="h-4 w-4 mr-1" /> Add item
              </Button>
            </div>
            {items.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {isBulk ? 'Multiple items — COD is tracked per item.' : 'Add another item to split this into a multi-item delivery.'}
              </p>
            )}

            <div className="space-y-2 mt-2">
              <AnimatePresence>
                {items.map((it, idx) => (
                  <motion.div
                    key={it.id}
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    transition={{ duration: 0.2 }}
                    className="rounded-md border p-3 space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <Input
                        data-name-for={it.id}
                        placeholder={`Item ${idx + 1} name`}
                        value={it.name}
                        onChange={(e) => updateItemRow(it.id, { name: e.target.value })}
                        className="flex-1"
                      />
                      <Button type="button" variant="ghost" size="icon" aria-label="Remove item" onClick={() => removeItemRow(it.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    {formErrors[`item-${it.id}-name`] && <p className="text-xs text-red-500">{formErrors[`item-${it.id}-name`]}</p>}
                    <div className="flex flex-wrap gap-2">
                      <div className="w-28">
                        <Input
                          placeholder="Price"
                          type="number"
                          min={0}
                          value={it.price ?? ''}
                          onChange={(e) => updateItemRow(it.id, { price: e.target.value ? Number(e.target.value) : null })}
                        />
                        {formErrors[`item-${it.id}-price`] && <p className="text-xs text-red-500 mt-1">{formErrors[`item-${it.id}-price`]}</p>}
                      </div>
                      <div className="flex-1 min-w-[10rem]">
                        <input
                          type="date"
                          className="block h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                          value={it.expectedDate?.slice(0, 10) || ''}
                          onChange={(e) => updateItemRow(it.id, { expectedDate: e.target.value ? `${e.target.value}T23:59` : '' })}
                        />
                        {formErrors[`item-${it.id}-date`] && <p className="text-xs text-red-500 mt-1">{formErrors[`item-${it.id}-date`]}</p>}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>

          <DialogFooter className="sticky bottom-0 bg-background pt-4 pb-2 border-t mt-6">
            <div className="flex gap-2 justify-end w-full">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isEdit ? 'Save' : 'Create'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
