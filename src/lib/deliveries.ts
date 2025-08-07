// lib/deliveries.ts
import { firestore, auth } from '@/lib/firebase'
import {
    collection,
    doc,
    writeBatch,
    serverTimestamp,
    Timestamp,
    query,
    orderBy,
    getDocs,
    getDoc,
    runTransaction,
    updateDoc,
    onSnapshot,
    deleteDoc,
    addDoc,
    orderBy as fbOrderBy,
    DocumentData,
    QuerySnapshot,
} from 'firebase/firestore'

/* ---------------------------
   ORDERS + ITEMS (existing)
   --------------------------- */

/**
 * Create an order + its items in a batched write.
 * orderPayload.items: [{ name, price?, expectedDate?: Date|null }]
 * returns orderId
 */
export async function createOrderWithItems(familyId: string, orderPayload: {
    title: string,
    platform?: string,
    note?: string,
    items: { name: string, price?: number | null, expectedDate?: Date | null }[]
}) {
    if (!familyId) throw new Error('familyId required')
    const ordersCol = collection(firestore, 'families', familyId, 'orders')

    // new order doc ref
    const orderRef = doc(ordersCol)
    const batch = writeBatch(firestore)

    const orderData: any = {
        title: orderPayload.title,
        platform: orderPayload.platform ?? null,
        note: orderPayload.note ?? null,
        createdBy: auth.currentUser?.uid ?? null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        status: 'pending',
    }

    const total = orderPayload.items.reduce((s, it) => s + (typeof it.price === 'number' ? it.price : 0), 0)
    if (total > 0) orderData.totalAmount = total

    batch.set(orderRef, orderData)

    const itemsColPath = (orderId: string) => collection(firestore, 'families', familyId, 'orders', orderId, 'items')

    for (const item of orderPayload.items) {
        const itemRef = doc(itemsColPath(orderRef.id))
        const itData: any = {
            name: item.name,
            price: (item.price != null) ? item.price : null,
            status: 'pending',
            createdAt: serverTimestamp(),
            createdBy: auth.currentUser?.uid ?? null,
        }
        if (item.expectedDate) itData.expectedDate = Timestamp.fromDate(item.expectedDate)
        batch.set(itemRef, itData)
    }

    await batch.commit()
    return orderRef.id
}

/**
 * Mark a single item as received (transactional).
 */
export async function markItemAsReceived(familyId: string, orderId: string, itemId: string) {
    if (!familyId || !orderId || !itemId) throw new Error('missing ids')
    const uid = auth.currentUser?.uid
    if (!uid) return { success: false, message: 'Not authenticated' }

    const itemRef = doc(firestore, 'families', familyId, 'orders', orderId, 'items', itemId)

    try {
        await runTransaction(firestore, async (tx) => {
            const snap = await tx.get(itemRef)
            if (!snap.exists()) throw new Error('Item not found')
            const data = snap.data() as any
            if (data.status === 'delivered') return // already done

            tx.update(itemRef, {
                status: 'delivered',
                receivedBy: uid,
                receivedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            })
        })
        return { success: true }
    } catch (err: any) {
        console.error('markItemAsReceived err', err)
        return { success: false, message: err?.message ?? 'Unknown' }
    }
}

/**
 * Mark entire order as delivered (batched update of items + order).
 */
export async function markOrderAsDelivered(familyId: string, orderId: string) {
    if (!familyId || !orderId) throw new Error('missing ids')
    const uid = auth.currentUser?.uid

    // fetch items then batch update them
    const itemsQ = query(collection(firestore, 'families', familyId, 'orders', orderId, 'items'), orderBy('createdAt', 'asc'))
    const itemsSnap = await getDocs(itemsQ)
    const batch = writeBatch(firestore)

    itemsSnap.forEach((docSnap) => {
        batch.update(docSnap.ref, {
            status: 'delivered',
            receivedBy: uid,
            receivedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        })
    })

    const orderRef = doc(firestore, 'families', familyId, 'orders', orderId)
    batch.update(orderRef, { status: 'delivered', updatedAt: serverTimestamp() })

    await batch.commit()
    return { message: true }
}

/**
 * Utility: subscribe to items subcollection for a given order.
 * Returns unsubscribe fn. callback receives array of item docs.
 */
export function subscribeToOrderItems(familyId: string, orderId: string, callback: (items: any[]) => void, onError?: (err: Error) => void) {
    try {
        const itemsCol = collection(firestore, 'families', familyId, 'orders', orderId, 'items')
        const q = query(itemsCol, orderBy('createdAt', 'asc'))
        const unsub = onSnapshot(
            q,
            (snap: QuerySnapshot<DocumentData>) => {
                const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
                callback(items)
            },
            (err) => {
                if (onError) onError(err)
                else console.error('subscribeToOrderItems error', err)
            }
        )
        return unsub
    } catch (err) {
        console.error('subscribeToOrderItems failed', err)
        return () => { }
    }
}

/* ---------------------------
   DELIVERIES (flat collection)
   --------------------------- */

/**
 * Create a single delivery under families/{familyId}/deliveries
 * payload can include { title, expectedDate: Date|null, codAmount?: number, status?, type?, totalAmount?, itemCount? }
 *
 * Returns: { id, ...docPayload }  (note: serverTimestamp fields are Firestore server timestamps and will be resolved by Firestore)
 */
export async function createDelivery(familyId: string, payload: {
    title: string,
    expectedDate?: Date | null,
    codAmount?: number | null,
    status?: 'pending' | 'in_transit' | 'delivered' | 'cancelled',
    type?: string | null, // 'single' | 'bulk' | 'order' etc
    totalAmount?: number | null,
    itemCount?: number
    note?: string
    receiverNote?: string
}) {
    if (!familyId) throw new Error('familyId required')
    const deliveriesRef = collection(firestore, 'families', familyId, 'deliveries')

    // Normalize and set defaults for type and itemCount
    const computedType = payload.type ?? 'single'
    const computedItemCount = typeof payload.itemCount === 'number' ? payload.itemCount : 0

    const docPayload: any = {
        title: payload.title,
        status: payload.status ?? 'pending',
        createdBy: auth.currentUser?.uid ?? null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        type: computedType,
        itemCount: computedItemCount,
        note: payload.note,
        receiverNote: payload.receiverNote
    }
    if (payload.expectedDate) docPayload.expectedDate = Timestamp.fromDate(payload.expectedDate)
    if (payload.codAmount != null) docPayload.codAmount = payload.codAmount
    if (payload.totalAmount != null) docPayload.totalAmount = payload.totalAmount
    if (payload.note != null) docPayload.note = payload.note
    if (payload.receiverNote != null) docPayload.receiverNote = payload.receiverNote

    const ref = await addDoc(deliveriesRef, docPayload)
    // return id + payload so caller has the values written (serverTimestamp unresolved)
    return { id: ref.id, ...docPayload }
}

/**
 * Mark a delivery as received using a transaction to reduce race conditions.
 * Returns { success: boolean, message?: string }
 */
export async function markDeliveryAsReceived(familyId: string, deliveryId: string, receiverNote: string) {
    if (!familyId || !deliveryId) throw new Error('familyId and deliveryId required')
    const uid = auth.currentUser?.uid
    if (!uid) return { success: false, message: 'User not authenticated' }

    const ref = doc(firestore, 'families', familyId, 'deliveries', deliveryId)

    try {
        await runTransaction(firestore, async (tx) => {
            const snap = await tx.get(ref)
            if (!snap.exists()) throw new Error('Delivery does not exist')

            const data = snap.data() as any
            if (data.status === 'delivered') {
                // already delivered
                return
            }

            tx.update(ref, {
                status: 'delivered',
                receivedBy: uid,
                receivedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                receiverNote: receiverNote ?? null,
            })
        })

        return { success: true }
    } catch (err: any) {
        console.error('markDeliveryAsReceived error', err)
        return { success: false, message: err?.message ?? 'Unknown error' }
    }
}

/**
 * Update arbitrary fields on a delivery document.
 */
export async function updateDelivery(familyId: string, deliveryId: string, data: Partial<Record<string, any>>) {
    if (!familyId || !deliveryId) throw new Error('familyId and deliveryId required')
    const ref = doc(firestore, 'families', familyId, 'deliveries', deliveryId)
    const patched: any = { ...data, updatedAt: serverTimestamp() }
    // convert expectedDate Date -> Timestamp if needed
    if (patched.expectedDate instanceof Date) patched.expectedDate = Timestamp.fromDate(patched.expectedDate)
    await updateDoc(ref, patched)
    return { success: true }
}

/**
 * Delete a delivery
 */
export async function deleteDelivery(familyId: string, deliveryId: string) {
    if (!familyId || !deliveryId) throw new Error('familyId and deliveryId required')
    const ref = doc(firestore, 'families', familyId, 'deliveries', deliveryId)
    await deleteDoc(ref)
    return { success: true }
}

export function subscribeToItems(
    familyId: string,
    parentCollection: string,
    parentId: string,
    callback: (items: any[]) => void,
    onError?: (err: Error) => void,
    orderByField: string = 'expectedDate'
) {
    try {
        const itemsCol = collection(firestore, 'families', familyId, parentCollection, parentId, 'items')

        // Subscribe to all items in the subcollection (no server-side orderBy)
        // We'll sort / filter client-side to avoid missing docs when fields are absent.
        const unsub = onSnapshot(
            itemsCol,
            (snap: QuerySnapshot<DocumentData>) => {
                const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))

                // Debug-friendly: ensure we can inspect what came back
                // (temporarily useful while debugging issues)
                // console.debug('subscribeToItems: raw items', parentCollection, parentId, items.map(i => ({ id: i.id, expectedDate: i.expectedDate, status: i.status })))

                // Client-side filter: if you want the same filtering as before (status + date range),
                // do it in the caller (HomeDeliveriesToday / DeliveryCard) because they know the date range.
                // Here we simply sort items so UI shows them in a predictable order.

                items.sort((a, b) => {
                    // prefer expectedDate if present, fall back to createdAt, else keep stable order
                    const aTs = (() => {
                        if (a.expectedDate?.toDate) return a.expectedDate.toDate().getTime()
                        if (a.expectedDate?.seconds) return a.expectedDate.seconds * 1000
                        if (a.createdAt?.toDate) return a.createdAt.toDate().getTime()
                        if (a.createdAt?.seconds) return a.createdAt.seconds * 1000
                        return 0
                    })()

                    const bTs = (() => {
                        if (b.expectedDate?.toDate) return b.expectedDate.toDate().getTime()
                        if (b.expectedDate?.seconds) return b.expectedDate.seconds * 1000
                        if (b.createdAt?.toDate) return b.createdAt.toDate().getTime()
                        if (b.createdAt?.seconds) return b.createdAt.seconds * 1000
                        return 0
                    })()

                    return aTs - bTs
                })

                callback(items)
            },
            (err) => {
                if (onError) onError(err)
                else console.error('subscribeToItems error (listening to all items)', err)
            }
        )

        return unsub
    } catch (err) {
        console.error('subscribeToItems failed', err)
        return () => { }
    }
}


/**
 * Mark an item under a parent collection (orders OR deliveries) as received.
 * parentCollection should be 'orders' or 'deliveries'.
 */
export async function markChildItemAsReceived(familyId: string, parentCollection: string, parentId: string, itemId: string) {
    if (!familyId || !parentCollection || !parentId || !itemId) throw new Error('missing ids')
    const uid = auth.currentUser?.uid
    if (!uid) return { success: false, message: 'Not authenticated' }

    const itemRef = doc(firestore, 'families', familyId, parentCollection, parentId, 'items', itemId)

    try {
        await runTransaction(firestore, async (tx) => {
            const snap = await tx.get(itemRef)
            if (!snap.exists()) throw new Error('Item not found')
            const data = snap.data() as any
            if (data.status === 'delivered') return // already done

            tx.update(itemRef, {
                status: 'delivered',
                receivedBy: uid,
                receivedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            })
        })
        return { success: true }
    } catch (err: any) {
        console.error('markChildItemAsReceived err', err)
        return { success: false, message: err?.message ?? 'Unknown' }
    }
}

/**
 * New: Create delivery + items in a single batched write.
 * items: [{ name, price?, expectedDate?: Date | null }]
 *
 * Returns: { id, ...docPayload } (same shape as createDelivery)
 */
export async function createDeliveryWithItems(
    familyId: string,
    deliveryPayload: {
        title: string,
        expectedDate?: Date | null,
        codAmount?: number | null,
        status?: 'pending' | 'in_transit' | 'delivered' | 'cancelled',
        type?: string | null,
        totalAmount?: number | null
        note?: string
    },
    items: { name: string, price?: number | null, expectedDate?: Date | null }[] = []
) {
    if (!familyId) throw new Error('familyId required')
    const deliveriesRef = collection(firestore, 'families', familyId, 'deliveries')
    const deliveryRef = doc(deliveriesRef) // generate an id

    const batch = writeBatch(firestore)

    const computedType = deliveryPayload.type ?? (items.length > 1 ? 'bulk' : 'single')
    const docPayload: any = {
        title: deliveryPayload.title,
        status: deliveryPayload.status ?? 'pending',
        createdBy: auth.currentUser?.uid ?? null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        type: computedType,
        itemCount: items.length,
        note: deliveryPayload.note,
    }
    if (deliveryPayload.expectedDate) docPayload.expectedDate = Timestamp.fromDate(deliveryPayload.expectedDate)
    if (deliveryPayload.codAmount != null) docPayload.codAmount = deliveryPayload.codAmount
    if (deliveryPayload.totalAmount != null) docPayload.totalAmount = deliveryPayload.totalAmount

    batch.set(deliveryRef, docPayload)

    const itemsCol = (deliveryId: string) => collection(firestore, 'families', familyId, 'deliveries', deliveryId, 'items')

    for (const it of items) {
        const itemRef = doc(itemsCol(deliveryRef.id))
        const itData: any = {
            name: it.name,
            price: (it.price != null) ? it.price : null,
            status: 'pending',
            createdAt: serverTimestamp(),
            createdBy: auth.currentUser?.uid ?? null,
        }
        if (it.expectedDate) itData.expectedDate = Timestamp.fromDate(it.expectedDate)
        batch.set(itemRef, itData)
    }

    await batch.commit()
    // return created id + payload (serverTimestamp unresolved)
    return { id: deliveryRef.id, ...docPayload }
}
