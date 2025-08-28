// functions/src/index.ts
import * as admin from 'firebase-admin'
import { LoggingWinston } from '@google-cloud/logging-winston'
import winston from 'winston'

// v2 functions imports
import { scheduler } from 'firebase-functions/v2'
import {
  onDocumentCreated,
  onDocumentUpdated,
} from 'firebase-functions/v2/firestore'
import { setGlobalOptions } from 'firebase-functions/v2/options'

admin.initializeApp()
setGlobalOptions({ region: 'asia-southeast1', memory: '256MiB', maxInstances: 10 })

const firestore = admin.firestore()
const messaging = admin.messaging()

const loggingWinston = new LoggingWinston()
const logger = winston.createLogger({
  level: 'info',
  transports: [new winston.transports.Console(), loggingWinston],
})

/* =============================================================================
   Timezone helpers (Asia/Manila)
   ============================================================================= */

const TZ_OFFSETS_HOURS: Record<string, number> = {
  'Asia/Manila': 8,
  UTC: 0,
}

function getTodayBoundsInTimeZone(timeZone: string): {
  startOfDay: Date
  endOfDay: Date
  dateKey: string // yyyy-mm-dd in the target time zone
} {
  const offsetH = TZ_OFFSETS_HOURS[timeZone] ?? 0

  const nowUtc = new Date()
  const zonedNow = new Date(nowUtc.getTime() + offsetH * 3600_000)

  const y = zonedNow.getUTCFullYear()
  const m = zonedNow.getUTCMonth()
  const d = zonedNow.getUTCDate()

  const startOfDayUtc = new Date(Date.UTC(y, m, d) - offsetH * 3600_000)
  const endOfDayUtc = new Date(startOfDayUtc.getTime() + 24 * 3600_000)

  const dateKey = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return { startOfDay: startOfDayUtc, endOfDay: endOfDayUtc, dateKey }
}

/* =============================================================================
   Utils
   ============================================================================= */

function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr]
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/* =============================================================================
   Idempotency helpers
   ============================================================================= */

// Daily sweep: once per family per day
async function markDailyNotifiedIfNeeded(familyId: string, dateKey: string): Promise<boolean> {
  const ref = firestore
    .collection('system')
    .doc('dailyDeliveryNotifications')
    .collection(dateKey)
    .doc('families')
    .collection('ids')
    .doc(familyId)

  const snap = await ref.get()
  if (snap.exists) return false

  await ref.set({ at: admin.firestore.FieldValue.serverTimestamp() })
  return true
}

// Per-delivery “in transit” notifier claim (race-safe)
async function claimInTransitNotification(familyId: string, deliveryId: string): Promise<boolean> {
  const ref = firestore
    .collection('system')
    .doc('inTransitNotified')
    .collection(familyId)
    .doc(deliveryId)

  try {
    await ref.create({ at: admin.firestore.FieldValue.serverTimestamp() }) // throws if exists
    return true
  } catch {
    return false
  }
}

/* =============================================================================
   Notification event recorder (for in-app Notifications tab)
   ============================================================================= */

type EventType =
  | 'delivery_created'
  | 'delivery_in_transit'
  | 'delivery_delivered'
  | 'delivery_today_summary'
  | 'presence_changed'
  | 'system'
  | string

async function getFamilyMemberUids(familyId: string): Promise<string[]> {
  const sub = await firestore.collection('families').doc(familyId).collection('members').select().get()
  if (!sub.empty) return sub.docs.map((d) => d.id)

  const fam = await firestore.doc(`families/${familyId}`).get()
  const arr = (fam.get('members') as string[] | undefined) ?? []
  return Array.isArray(arr) ? arr.filter(Boolean) : []
}

async function recordEvent(
  familyId: string,
  type: EventType,
  title: string,
  body: string | null,
  link: string | null,
  meta: Record<string, any> | null,
  opts?: { excludeUids?: string[] }
) {
  try {
    const all = await getFamilyMemberUids(familyId)
    const targets = (opts?.excludeUids?.length ? all.filter((u) => !opts!.excludeUids!.includes(u)) : all)
      .filter(Boolean)
    if (targets.length === 0) return

    const evRef = firestore.collection(`families/${familyId}/events`).doc()
    await evRef.set({
      familyId,
      type,
      title,
      body: body ?? null,
      link: link ?? null,
      meta: meta ?? null,
      targets,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  } catch (e) {
    logger.error('recordEvent failed', { familyId, type, error: e instanceof Error ? e.message : String(e) })
  }
}

/* =============================================================================
   Unified notifier for a family's members (multicast + Safari fallback)
   ============================================================================= */

async function sendNotificationToFamilyMembers(
  familyId: string,
  title: string,
  body: string,
  extraData: Record<string, string> = {},
  opts?: { excludeUids?: string[] }
): Promise<void> {
  try {
    const exclude = new Set(opts?.excludeUids ?? [])

    // Source of truth: subcollection
    const membersSnap = await firestore
      .collection('families')
      .doc(familyId)
      .collection('members')
      .get()

    const memberUids = membersSnap.docs.map((d) => d.id).filter((uid) => !exclude.has(uid))

    const fcmTokens: string[] = []
    const safariFallbackUids: string[] = []

    for (const uid of memberUids) {
      const userDoc = await firestore.collection('users').doc(uid).get()
      const u = userDoc.data() as any
      if (u && Array.isArray(u.fcmTokens) && u.fcmTokens.length > 0) {
        fcmTokens.push(...u.fcmTokens)
      } else if (u?.isSafari) {
        safariFallbackUids.push(uid)
      }
    }

    const tokens = Array.from(new Set(fcmTokens)) // dedupe

    const tag = String(extraData.tag ?? `abot:${familyId}`)
    const url = String(extraData.url ?? '/')

    if (tokens.length > 0) {
      const chunks = chunk(tokens, 500)
      for (const part of chunks) {
        try {
          const res = await messaging.sendEachForMulticast({
            tokens: part,
            notification: { title, body }, // For platforms that auto-display
            webpush: {
              headers: { TTL: '1800' },
              fcmOptions: { link: url },
              notification: {
                tag,
                renotify: false,
                badge: '/favicon-32x32.png',
                icon: '/android-chrome-192x192.png',
              },
            },
            data: { familyId, ...extraData, tag, url }, // keep strings
          })
          logger.info('Push multicast result', {
            familyId,
            successCount: res.successCount,
            failureCount: res.failureCount,
          })
          res.responses.forEach((r, i) => {
            if (!r.success) {
              logger.error('Push failed', { token: part[i], error: r.error?.message ?? 'unknown' })
            }
          })
        } catch (err) {
          logger.error('Push multicast exception', { error: err instanceof Error ? err.message : JSON.stringify(err) })
        }
      }
    }

    // Safari fallback
    for (const uid of safariFallbackUids) {
      try {
        await firestore.collection('users').doc(uid).update({
          pendingNotifications: admin.firestore.FieldValue.arrayUnion({
            title,
            body,
            familyId,
            ...extraData,
            tag,
            url,
            timestamp: Date.now(),
          }),
        })
      } catch (err) {
        logger.error('Safari fallback queue failed', {
          uid,
          error: err instanceof Error ? err.message : JSON.stringify(err),
        })
      }
    }
  } catch (err) {
    logger.error('sendNotificationToFamilyMembers error', {
      familyId,
      error: err instanceof Error ? err.message : JSON.stringify(err),
    })
  }
}

/* =============================================================================
   Delivery-specific notifier used by triggers below
   ============================================================================= */

async function sendDeliveryNotificationForFamily(
  familyId: string,
  expectedDate: Date | null,
  extra: Record<string, string> = {}
) {
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)

  logger.info('sendDeliveryNotificationForFamily called', { familyId, expectedDate })
  if (!expectedDate || expectedDate < now || expectedDate >= tomorrow) {
    logger.info('Expected date not within [now, +24h); skip', { familyId, expectedDate })
    return
  }
  await sendNotificationToFamilyMembers(
    familyId,
    'Delivery is on its way!',
    'Delivery expected today is now in transit.',
    extra
  )
}

/* =============================================================================
   Triggers
   ============================================================================= */

/**
 * 1) Status change -> in_transit
 */
export const notifyDeliveryInTransit = onDocumentUpdated(
  'families/{familyId}/deliveries/{deliveryId}',
  async (event) => {
    logger.info('notifyDeliveryInTransit triggered', { params: event.params })

    const before = event.data?.before?.data() as any
    const after = event.data?.after?.data() as any
    const familyId = event.params.familyId as string
    const deliveryId = event.params.deliveryId as string
    if (!before || !after || !familyId || !deliveryId) return

    const prevStatus = String(before.status ?? '').toLowerCase()
    const nextStatus = String(after.status ?? '').toLowerCase()

    if (prevStatus !== 'in_transit' && nextStatus === 'in_transit') {
      const actor = after.updatedBy ?? after.lastEditedBy ?? after.ownerUid ?? null

      // Fast race-safe claim (prevents duplicate sends during rapid writes)
      const claimed = await claimInTransitNotification(familyId, deliveryId)
      if (!claimed) {
        logger.info('inTransit already claimed; skip', { familyId, deliveryId })
        return
      }

      let expectedDate: Date | null = null
      if (after.expectedDate) {
        if (typeof after.expectedDate === 'object' && 'toDate' in after.expectedDate) {
          expectedDate = (after.expectedDate as admin.firestore.Timestamp).toDate()
        } else {
          const d = new Date(after.expectedDate)
          expectedDate = isNaN(d.getTime()) ? null : d
        }
      }

      await recordEvent(
        familyId,
        'delivery_in_transit',
        after.title || 'Delivery in transit',
        after.recipient ? `For ${after.recipient}` : null,
        `/deliveries?focus=${encodeURIComponent(deliveryId)}`,
        { deliveryId },
        actor ? { excludeUids: [actor] } : undefined
      )

      await sendDeliveryNotificationForFamily(familyId, expectedDate, {
        tag: `intransit:${familyId}:${deliveryId}`,
        url: `/deliveries`,
      })

      try {
        await firestore
          .collection('families').doc(familyId)
          .collection('deliveries').doc(deliveryId)
          .set({ inTransitNotifiedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
      } catch (e) {
        logger.error('Failed to set inTransitNotifiedAt', { e })
      }
    }
  }
)

/**
 * 2) Daily 8AM (Asia/Manila) sweep:
 *    Notify once per family if there exists any delivery for TODAY
 *    with status in ['pending','in_transit'].
 */
export const scheduledDailyDeliveryNotification = scheduler.onSchedule(
  {
    schedule: '0 8 * * *', // every day at 08:00
    timeZone: 'Asia/Manila',
  },
  async () => {
    logger.info('Daily 8AM delivery detection start')

    const { startOfDay, endOfDay, dateKey } = getTodayBoundsInTimeZone('Asia/Manila')

    try {
      const snap = await firestore
        .collectionGroup('deliveries')
        .where('expectedDate', '>=', startOfDay)
        .where('expectedDate', '<', endOfDay)
        .where('status', 'in', ['pending', 'in_transit'])
        .get()

      if (snap.empty) {
        logger.info('No deliveries found for today', { dateKey })
        return
      }

      const visited = new Set<string>()

      for (const docSnap of snap.docs) {
        const familyId = docSnap.ref.parent.parent?.id
        if (!familyId || visited.has(familyId)) continue

        const shouldNotify = await markDailyNotifiedIfNeeded(familyId, dateKey)
        if (!shouldNotify) {
          visited.add(familyId)
          continue
        }

        await recordEvent(
          familyId,
          'delivery_today_summary',
          'Today’s deliveries',
          'You have deliveries scheduled for today.',
          '/deliveries',
          { dateKey }
        )

        await sendNotificationToFamilyMembers(
          familyId,
          'Today’s deliveries',
          'You have deliveries scheduled for today.',
          { tag: `today:${familyId}`, url: '/deliveries' }
        )

        visited.add(familyId)
      }

      logger.info('Daily 8AM delivery detection complete', {
        dateKey,
        familiesNotified: visited.size,
      })
    } catch (error) {
      logger.error('Error during daily delivery detection', {
        error: error instanceof Error ? error.message : JSON.stringify(error),
      })
      console.error('Full error stack:', error)
    }
  }
)

/**
 * 3) Creation trigger:
 *    Notify when a delivery is CREATED for TODAY (Asia/Manila)
 *    with status in ['pending','in_transit'].
 */
export const notifyDeliveryCreatedToday = onDocumentCreated(
  'families/{familyId}/deliveries/{deliveryId}',
  async (event) => {
    const snap = event.data
    const { familyId, deliveryId } = event.params as { familyId: string; deliveryId: string }
    if (!snap || !familyId) return

    const d = snap.data() as any
    const status = String(d?.status ?? 'pending').toLowerCase()
    if (!['pending', 'in_transit'].includes(status)) return

    let expected: Date | null = null
    if (d?.expectedDate) {
      if (typeof d.expectedDate === 'object' && 'toDate' in d.expectedDate) {
        expected = (d.expectedDate as admin.firestore.Timestamp).toDate()
      } else {
        const dt = new Date(d.expectedDate)
        expected = isNaN(dt.getTime()) ? null : dt
      }
    }
    if (!expected) return

    const { startOfDay, endOfDay } = getTodayBoundsInTimeZone('Asia/Manila')
    if (expected >= startOfDay && expected < endOfDay) {
      const actor = d.createdBy ?? d.updatedBy ?? d.ownerUid ?? null

      await recordEvent(
        familyId,
        'delivery_created',
        d.title || 'New delivery for today',
        d.recipient ? `For ${d.recipient}` : null,
        `/deliveries?focus=${encodeURIComponent(deliveryId)}`,
        { deliveryId },
        actor ? { excludeUids: [actor] } : undefined
      )

      await sendNotificationToFamilyMembers(
        familyId,
        'New delivery for today',
        'A delivery scheduled for today was added.',
        { deliveryId, tag: `today:${familyId}`, url: '/deliveries' },
        actor ? { excludeUids: [actor] } : undefined
      )
    }
  }
)

/**
 * 4) Presence change trigger:
 *    families/{familyId}/presence/{userId}
 *    Notify the family (excluding the user) when status becomes 'home' or 'away'.
 */
export const notifyPresenceStatusChange = onDocumentUpdated(
  'families/{familyId}/presence/{userId}',
  async (event) => {
    const before = event.data?.before?.data() as any
    const after = event.data?.after?.data() as any
    const { familyId, userId } = event.params as { familyId: string; userId: string }

    if (!before || !after) return
    if (before.status === after.status) return

    const next = String(after.status ?? '').toLowerCase()
    if (!['home', 'away'].includes(next)) return

    // Try to get a display name
    let displayName = userId
    try {
      const uDoc = await firestore.collection('users').doc(userId).get()
      const u = uDoc.data() as any
      displayName = u?.displayName ?? u?.name ?? userId
    } catch {}

    const title = next === 'home' ? 'Arrived home' : 'Left home'
    const body = `${displayName} is now ${next}.`

    await recordEvent(
      familyId,
      'presence_changed',
      title,
      body,
      '/family',
      { uid: userId, status: next, auto: after.autoPresence === true || after.statusSource === 'geo' },
      { excludeUids: [userId] }
    )

    await sendNotificationToFamilyMembers(
      familyId,
      title,
      body,
      { changedUserId: userId, status: next, tag: `presence:${familyId}:${userId}` },
      { excludeUids: [userId] }
    )
  }
)
