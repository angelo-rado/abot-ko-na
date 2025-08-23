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

type DeliveryStatus = 'pending' | 'in_transit' | 'delivered' | 'cancelled'

type DeliveryFormValues = {
  title: string
  expectedDate: string
  codAmount: number | null
  status: DeliveryStatus
  note?: string
  receiverNote?: string
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
function getLocalISOStringForTime(hour: number, minute: number) {
  const date = new Date()
  date.setHours(hour, minute, 0, 0)
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`)
  const y = date.getFullYear()
  const m = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  const hh = pad(date.getHours())
  const mm = pad(date.getMinutes())
  return `${y}-${m}-${d}T${hh}:${mm}` // for <input type="datetime-local">
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
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`)
  const y = dt.getFullYear()
  const m = pad(dt.getMonth() + 1)
  const day = pad(dt.getDate())
  const hh = pad(dt.getHours())
  const mm = pad(dt.getMinutes())
  return `${y}-${m}-${day}T${hh}:${mm}`
}

export default function DeliveryFormDialog({ open, onOpenChange, familyId, delivery }: Props) {
  const isEdit = !!delivery

  const draftItemsRef = useRef<ItemRow[] | null>(null)
  const modifiedItemsRef = useRef<Set<string>>(new Set())

  const initialExpectedRef = useRef<string | null>(null)

  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  const [values, setValues] = useState<DeliveryFormValues>({
    title: delivery?.title ?? '',
    expectedDate: delivery?.expectedDate
      ? parseExpectedDate(delivery.expectedDate)
      : getLocalISOStringForTime(23, 59),
    codAmount: delivery?.codAmount ?? null,
    status: (delivery?.status as DeliveryStatus) ?? 'pending',
    note: delivery?.note ?? '',
  })

  const [itemMode, setItemMode] = useState<'single' | 'multiple'>(
    delivery?.type === 'bulk' ? 'multiple' : 'single'
  )

  const [items, setItems] = useState<ItemRow[]>([])
  const [confirmSinglePromptOpen, setConfirmSinglePromptOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [confirmContext, setConfirmContext] = useState<'switch' | 'close' | null>(null)

  const addItemDisabled = itemMode === 'single' && (!isEdit || items.length >= 1)

  useEffect(() => {
    if (formErrors.items && items.length > 0) {
      setFormErrors((prev) => {
        const { items, ...rest } = prev
        return rest
      })
    }
  }, [items.length, formErrors.items])

  // Reset values on open (CREATE only), default 23:59 local
  useEffect(() => {
    if (!open || isEdit) return

    const defaultDate = getLocalISOStringForTime(23, 59)
    setValues({
      title: '',
      expectedDate: defaultDate,
      codAmount: null,
      status: 'pending',
      note: '',
    })
    initialExpectedRef.current = null

    if (draftItemsRef.current) {
      setItems(draftItemsRef.current)
      setItemMode('multiple')
    } else {
      setItems([])
      setItemMode('single')
    }

    setConfirmSinglePromptOpen(false)
  }, [open, isEdit])

  // Load values for EDIT mode (preserve exact times from Firestore)
  useEffect(() => {
    if (!delivery || !isEdit) return

    const expected = parseExpectedDate(delivery.expectedDate)
    setValues({
      title: delivery.title ?? '',
      expectedDate: expected,
      codAmount: delivery.codAmount ?? null,
      status: (delivery.status as DeliveryStatus) ?? 'pending',
      note: delivery.note ?? '',
    })
    initialExpectedRef.current = expected

    if (delivery.type !== 'bulk') setItems([])

    setItemMode(delivery.type === 'bulk' ? 'multiple' : 'single')
    draftItemsRef.current = null
    setConfirmSinglePromptOpen(false)
  }, [delivery, isEdit])

  // Fetch bulk items on edit (preserve each item's time)
  useEffect(() => {
    async function fetchItems() {
      if (!delivery || !delivery.id || delivery.type !== 'bulk') return
      const itemsCol = collection(firestore, 'families', familyId, 'deliveries', delivery.id, 'items')
      const snap = await getDocs(itemsCol)
      const rows: ItemRow[] = snap.docs.map((doc) => {
        const data = doc.data()
        return {
          id: doc.id,
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

  useEffect(() => {
    if ((items.length > 1 || itemMode === 'multiple') && values.codAmount != null) {
      setValues((v) => ({ ...v, codAmount: null }))
    }
  }, [items.length, itemMode, values.codAmount])

  useEffect(() => {
    if (itemMode === 'single' && items.length > 1) {
      setItems((prev) => prev.slice(0, 1))
    }
  }, [itemMode])

  const updateField = (k: keyof DeliveryFormValues, v: any) =>
    setValues((s) => ({ ...s, [k]: v }))

  function addItemRow() {
    if (itemMode === 'single' && items.length >= 1) return
    setItems((prev) => [
      ...prev,
      {
        id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: '',
        price: null,
        expectedDate: delivery?.expectedDate
          ? parseExpectedDate(delivery.expectedDate)
          : getLocalISOStringForTime(23, 59),
      },
    ])
  }

  function updateItemRow(id: string, patch: Partial<ItemRow>) {
    modifiedItemsRef.current.add(id)
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  function removeItemRow(id: string) {
    setItems((prev) => prev.filter((r) => r.id !== id))
  }

  function handleSetSingleMode() {
    if (itemMode === 'multiple' && items.length > 0) {
      draftItemsRef.current = items
      setConfirmContext('switch')
      requestAnimationFrame(() => setConfirmSinglePromptOpen(true))
      return
    }
    setItemMode('single')
  }

  function handleSetMultipleMode() {
    setItemMode('multiple')
    if (draftItemsRef.current) setItems(draftItemsRef.current)
  }

  function confirmSwitchToSingleProceed() {
    setItems([])
    setItemMode('single')
    setConfirmSinglePromptOpen(false)
  }

  function confirmSwitchToSingleCancel() {
    if (draftItemsRef.current) setItems(draftItemsRef.current)
    setConfirmSinglePromptOpen(false)
    setItemMode('multiple')
  }

  function handleDialogClose() {
    if (!isEdit && itemMode === 'multiple' && items.length > 0) {
      draftItemsRef.current = items
      setConfirmContext('close')
      requestAnimationFrame(() => setConfirmSinglePromptOpen(true))
      return
    }
    onOpenChange(false)
  }

  const onSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    // OFFLINE PATH: enqueue write & mirror locally
    if (!isOnline()) {
      try {
        const now = Date.now()
        const tempId = `offline-${'${'}now${'}'}`
        const fam = familyId
        // Basic single delivery optimistic mirror
        await db.deliveries.put({ id: tempId, familyId: fam!, title: values.title?.trim() || 'Untitled', type: itemMode === 'single' ? 'single' : 'multiple', amount: values.codAmount ?? null, note: values.note ?? '', eta: values.expectedDate ? Date.parse(values.expectedDate) : null, createdAt: now, updatedAt: now, itemCount: itemMode === 'single' ? 1 : items.length })
        await enqueue({ op: 'addDelivery', familyId: fam, payload: { familyId: fam, id: tempId, payload: { title: values.title?.trim() || 'Untitled', type: itemMode === 'single' ? 'single' : 'multiple', amount: values.codAmount ?? null, note: values.note ?? '', expectedDate: values.expectedDate ? Date.parse(values.expectedDate) : null, createdAt: now, updatedAt: now, itemCount: itemMode === 'single' ? 1 : items.length } } })
        toast('Saved offline — will sync when online', { icon: '📶' })
        onOpenChange(false)
        return
      } catch (err) {
        toast.error('Failed to save offline draft')
      }
    }
    e?.preventDefault()
    setFormErrors({})
    const errors: Record<string, string> = {}

    if (!values.title.trim()) errors.title = 'Title is required'
    if (!values.expectedDate?.trim()) {
      errors.expectedDate = 'Expected date is required'
    } else {
      const now = new Date()
      const expected = new Date(values.expectedDate)
      if (expected < now) errors.expectedDate = 'Expected date cannot be in the past'
    }

    if (itemMode === 'multiple') {
      if (items.length < 2) errors.items = 'Please add at least two items for bulk deliveries'
      const headerExpected = values.expectedDate ? new Date(values.expectedDate) : null
      items.forEach((item, index) => {
        if (!item.name.trim()) errors[`item-${item.id}-name`] = `Item ${index + 1}: Name required`
        if (item.price === null || isNaN(item.price)) errors[`item-${item.id}-price`] = `Item ${index + 1}: Price required`
        if (!item.expectedDate?.trim()) {
          errors[`item-${item.id}-date`] = `Item ${index + 1}: Date required`
        } else {
          const itemDate = new Date(item.expectedDate)
          const now = new Date()
          if (itemDate < now) errors[`item-${item.id}-date`] = `Item ${index + 1}: Date cannot be in the past`
          if (headerExpected && itemDate < headerExpected) errors[`item-${item.id}-date`] = `Item ${index + 1}: Date must be on or after the delivery ETA`
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
        // EDIT MODE — keep times; don't overwrite expectedDate unless changed
        const deliveryRef = doc(firestore, 'families', familyId, 'deliveries', delivery.id)
        const itemsCol = collection(deliveryRef, 'items')

        const existingItemsSnap = await getDocs(itemsCol)
        const deletePromises = existingItemsSnap.docs.map((doc) => deleteDoc(doc.ref))
        await Promise.all(deletePromises)

        const batch = writeBatch(firestore)
        items.forEach((it) => {
          const itemRef = doc(itemsCol)
          batch.set(itemRef, {
            name: it.name.trim(),
            price: it.price,
            status: 'pending',
            createdAt: Timestamp.now(),
            ...(it.expectedDate ? { expectedDate: Timestamp.fromDate(new Date(it.expectedDate)) } : {}),
            ...(it.note ? { note: it.note.trim() } : {}),
          })
        })

        const updatePayload: any = {
          title: values.title.trim(),
          codAmount: values.codAmount ?? null,
          status: values.status,
          note: values.note?.trim() || '',
          itemCount: items.length,
          type: items.length > 1 ? 'bulk' : 'single',
          updatedAt: Timestamp.now(),
        }
        if (values.expectedDate !== initialExpectedRef.current) {
          updatePayload.expectedDate = values.expectedDate
            ? Timestamp.fromDate(new Date(values.expectedDate))
            : null
        }

        batch.update(deliveryRef, updatePayload)
        await batch.commit()

        draftItemsRef.current = null
        modifiedItemsRef.current.clear()
        setItems([])
        onOpenChange(false)
        return
      } else {
        // CREATE MODE — clamp ALL times to 23:59 local
        const headerDate = values.expectedDate ? endOfDayFromLocalISO(values.expectedDate) : undefined

        const determinedType = itemMode === 'multiple' || items.length > 1 ? 'bulk' : 'single'
        const created = await createDelivery(familyId, {
          title: values.title.trim(),
          status: values.status,
          itemCount: 0,
          type: determinedType,
          codAmount: values.codAmount ?? undefined,
          expectedDate: headerDate ?? undefined,  // 23:59 local
          note: values.note?.trim() || '',
          receiverNote: '',
        })

        const newId = created.id
        const itemsCol = collection(firestore, 'families', familyId, 'deliveries', newId, 'items')

        if (items.length > 0) {
          for (const it of items) {
            const itemDate = it.expectedDate?.trim()
              ? endOfDayFromLocalISO(it.expectedDate)
              : headerDate
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

        draftItemsRef.current = null
        modifiedItemsRef.current.clear()
        setItems([])
        onOpenChange(false)
      }
    } catch (err) {
      console.error('DeliveryFormDialog submit err', err)
      alert('Failed to save delivery')
    } finally {
      setIsSaving(false)
    }
  }

  const previewNames = (draftItemsRef.current ?? items).slice(0, 5).map((it) => it.name?.trim() || '(unnamed item)')

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => {
        if (!v) { handleDialogClose() } else { onOpenChange(true) }
      }}>
        <AnimatePresence>
          {open && (
            <motion.div
              key="dialog"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
            >
              <DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{isEdit ? 'Edit Delivery' : 'Add Delivery'}</DialogTitle>
                </DialogHeader>

                {isSaving && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center backdrop-blur-sm bg-background/70 rounded-md">
                    <div className="animate-spin h-6 w-6 border-2 border-muted-foreground border-t-transparent rounded-full" />
                  </div>
                )}

                <form onSubmit={onSubmit}
                  className={`space-y-4 transition-opacity duration-200 ${isSaving ? 'opacity-50 pointer-events-none' : ''}`}>
                  <div>
                    <Label>Title</Label>
                    <Input
                      value={values.title}
                      onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))}
                      required
                      autoFocus
                    />
                    {formErrors.title && <p className="text-sm text-red-500 mt-1">{formErrors.title}</p>}
                  </div>

                  <div>
                    <Label>Expected date &amp; time</Label>
                    <input
                      type="datetime-local"
                      className="mt-1 block w-full rounded border px-2 py-1"
                      value={values.expectedDate}
                      onChange={(e) => setValues((v) => ({ ...v, expectedDate: e.target.value }))}
                    />
                    {formErrors.expectedDate && (
                      <p className="text-sm text-red-500 mt-1">{formErrors.expectedDate}</p>
                    )}
                    {!isEdit && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Time is auto-set to <strong>11:59 PM</strong> on create.
                      </p>
                    )}
                  </div>

                  <div>
                    <Label>Item mode</Label>
                    <div className="mt-1 flex gap-2 items-center">
                      <Button type="button" variant={itemMode === 'single' ? 'default' : 'outline'} onClick={handleSetSingleMode} size="sm">
                        Single
                      </Button>
                      <Button type="button" variant={itemMode === 'multiple' ? 'default' : 'outline'} onClick={handleSetMultipleMode} size="sm">
                        Multiple
                      </Button>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {itemMode === 'single'
                        ? 'Single delivery — only one item allowed. COD enabled.'
                        : 'Multiple items (bulk) — COD is disabled and handled per item.'}
                    </p>
                  </div>

                  <div>
                    <Label>COD Amount (optional)</Label>
                    <Input
                      type="number"
                      value={values.codAmount ?? ''}
                      onChange={(e) => setValues((v) => ({ ...v, codAmount: e.target.value ? Number(e.target.value) : null }))}
                      min={0}
                      disabled={itemMode === 'multiple' || items.length > 1}
                      title={itemMode === 'multiple' || items.length > 1 ? 'COD is calculated per item in bulk deliveries' : ''}
                    />
                    {(itemMode === 'multiple' || items.length > 1) && (
                      <p className="text-sm text-muted-foreground mt-1">
                        COD is automatically calculated per item in bulk deliveries.
                      </p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="status">Status</Label>
                    <Select
                      value={values.status}
                      onValueChange={(val) =>
                        setValues((v) => ({ ...v, status: val as DeliveryStatus }))
                      }
                    >
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

                  <div>
                    <Label>Notes</Label>
                    <Textarea
                      id="note"
                      value={values.note}
                      onChange={(e) => setValues((v) => ({ ...v, note: e.target.value }))}
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <Label>Items</Label>
                      {formErrors.items && (
                        <p className="text-sm text-red-500 mt-1">{formErrors.items}</p>
                      )}
                      <div className="flex items-center gap-3">
                        <Button
                          type="button"
                          size="sm"
                          onClick={addItemRow}
                          disabled={addItemDisabled}
                          title={addItemDisabled ? 'Switch to Multiple to add items' : 'Add item'}
                        >
                          Add item
                        </Button>
                        {addItemDisabled && !isEdit && (
                          <span className="text-sm text-muted-foreground max-w-[200px]">
                            Switch to <strong>Multiple</strong> mode to add more items.
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2 mt-2">
                      <AnimatePresence>
                        {items.map((it) => (
                          <motion.div
                            key={it.id}
                            initial={{ opacity: 0, y: -5 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -5 }}
                            transition={{ duration: 0.2 }}
                            className="flex flex-wrap items-start sm:items-center gap-3 border rounded-md p-3"
                          >
                            <div className="flex-1 min-w-0">
                              <Input
                                placeholder="Name"
                                value={it.name}
                                onChange={(e) => updateItemRow(it.id, { name: e.target.value })}
                              />
                              {formErrors[`item-${it.id}-name`] && (
                                <p className="text-xs text-red-500 mt-1">
                                  {formErrors[`item-${it.id}-name`]}
                                </p>
                              )}
                            </div>

                            <div className="w-28">
                              <Input
                                placeholder="Price"
                                type="number"
                                value={it.price ?? ''}
                                min={0}
                                onChange={(e) =>
                                  updateItemRow(it.id, {
                                    price: e.target.value ? Number(e.target.value) : null,
                                  })
                                }
                              />
                              {formErrors[`item-${it.id}-price`] && (
                                <p className="text-xs text-red-500 mt-1">
                                  {formErrors[`item-${it.id}-price`]}
                                </p>
                              )}
                            </div>

                            <div className="w-full sm:w-56">
                              <Input
                                type="datetime-local"
                                value={it.expectedDate}
                                onChange={(e) => updateItemRow(it.id, { expectedDate: e.target.value })}
                              />
                              {formErrors[`item-${it.id}-date`] && (
                                <p className="text-xs text-red-500 mt-1">
                                  {formErrors[`item-${it.id}-date`]}
                                </p>
                              )}
                            </div>

                            <div className="flex-shrink-0">
                              <Button
                                type="button"
                                variant="ghost"
                                onClick={() => removeItemRow(it.id)}
                                className="text-sm"
                              >
                                Remove
                              </Button>
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>

                      {items.length === 0 && (
                        <motion.p
                          className="text-sm text-muted-foreground italic mt-2"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                        >
                          No items added yet.
                        </motion.p>
                      )}
                    </div>
                  </div>

                  <DialogFooter className="sticky bottom-0 bg-background pt-4 pb-2 border-t mt-6">
                    <div className="flex gap-2 justify-end w-full">
                      <Button type="button" variant="ghost" onClick={handleDialogClose} disabled={isSaving}>
                        Cancel
                      </Button>
                      <Button type="submit" disabled={isSaving}>
                        {isEdit ? 'Save' : 'Create'}
                      </Button>
                    </div>
                  </DialogFooter>
                </form>
              </DialogContent>
            </motion.div>
          )}
        </AnimatePresence>
      </Dialog>

      <AnimatePresence mode="wait">
        {confirmSinglePromptOpen && (
          <Dialog open={true} onOpenChange={setConfirmSinglePromptOpen}>
            <motion.div
              key="confirm-dialog"
              initial={{ opacity: 0, y: -8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.98 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              <DialogContent aria-describedby={undefined}>
                <DialogHeader>
                  <DialogTitle>
                    {confirmContext === 'switch' ? 'Switch to Single delivery?' : 'Discard this delivery?'}
                  </DialogTitle>
                </DialogHeader>

                <div className="py-2">
                  <p className="mb-3">
                    You currently have <strong>{(draftItemsRef.current ?? items).length}</strong>{' '}
                    item{(draftItemsRef.current ?? items).length > 1 ? 's' : ''} in this delivery.
                  </p>

                  <div className="mb-3">
                    <p className="text-sm font-medium">
                      Preview (first {Math.min(5, (draftItemsRef.current ?? items).length)}):
                    </p>
                    <ul className="list-disc ml-5 text-sm">
                      {(draftItemsRef.current ?? items).slice(0, 5).map((it, idx) => (
                        <li key={idx}>{it.name?.trim() || '(unnamed item)'}</li>
                      ))}
                    </ul>
                    {(draftItemsRef.current ?? items).length > 5 && (
                      <p className="text-sm text-muted-foreground mt-1">
                        ...and {(draftItemsRef.current ?? items).length - 5} more.
                      </p>
                    )}
                  </div>

                  <p className="mb-1 text-sm text-muted-foreground">
                    If you proceed, <strong>all items will be removed</strong> and the delivery will become a single-item delivery.
                  </p>
                </div>

                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ delay: 0.15, duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                >
                  <DialogFooter className="pt-4">
                    <div className="flex gap-2 justify-end w-full">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setConfirmSinglePromptOpen(false)
                          setConfirmContext(null)
                        }}
                      >
                        Cancel
                      </Button>

                      {confirmContext === 'switch' ? (
                        <Button type="button" onClick={confirmSwitchToSingleProceed}>
                          Proceed — remove all items
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          onClick={() => {
                            draftItemsRef.current = null
                            setConfirmSinglePromptOpen(false)
                            setConfirmContext(null)
                            onOpenChange(false)
                          }}
                        >
                          Discard and Close
                        </Button>
                      )}
                    </div>
                  </DialogFooter>
                </motion.div>
              </DialogContent>
            </motion.div>
          </Dialog>
        )}
      </AnimatePresence>
    </>
  )
}

