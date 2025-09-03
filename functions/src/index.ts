// functions/src/index.ts
import * as admin from 'firebase-admin'
import { LoggingWinston } from '@google-cloud/logging-winston'
import winston from 'winston'

import { scheduler } from 'firebase-functions/v2'
import { onDocumentCreated, onDocumentUpdated, onDocumentWritten } from 'firebase-functions/v2/firestore'
import { setGlobalOptions } from 'firebase-functions/v2/options'

admin.initializeApp()
setGlobalOptions({ region: 'asia-southeast1', memory: '256MiB', maxInstances: 10 })

const firestore = admin.firestore()
const messaging = admin.messaging()

const loggingWinston = new LoggingWinston()
const logger = winston.createLogger({
  level: 'info',
  defaultMeta: { service: 'abot-functions' },
  transports: [new winston.transports.Console(), loggingWinston],
})

/* =============================================================================
   Timezone helpers (Asia/Manila)
   ============================================================================= */
const TZ_OFFSETS_HOURS: Record<string, number> = { 'Asia/Manila': 8, UTC: 0 }

function getTodayBoundsInTimeZone(timeZone: string): {
  startOfDay: Date
  endOfDay: Date
  dateKey: string
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
async function markDailyNotifiedIfNeeded(familyId: string, dateKey: string): Promise<boolean> {
  const ref = firestore
    .collection('system').doc('dailyDeliveryNotifications')
    .collection(dateKey).doc('families')
    .collection('ids').doc(familyId)

  const snap = await ref.get()
  if (snap.exists) return false
  await ref.set({ at: admin.firestore.FieldValue.serverTimestamp() })
  return true
}

async function claimInTransitNotification(familyId: string, deliveryId: string): Promise<boolean> {
  const ref = firestore
    .collection('system').doc('inTransitNotified')
    .collection(familyId).doc(deliveryId)
  try {
    await ref.create({ at: admin.firestore.FieldValue.serverTimestamp() })
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
    const targets = (opts?.excludeUids?.length ? all.filter((u) => !opts!.excludeUids!.includes(u)) : all).filter(Boolean)
    if (targets.length === 0) return

    const evRef = firestore.collection(`families/${familyId}/events`).doc()
    await evRef.set({
      familyId, type, title,
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

    // Members
    const membersSnap = await firestore.collection('families').doc(familyId).collection('members').get()
    const memberUids = membersSnap.docs.map((d) => d.id).filter((uid) => !exclude.has(uid))
    logger.info('sendNotificationToFamilyMembers: members fetched', { familyId, memberCount: memberUids.length })

    // Gather tokens
    const userTokens: Array<{ uid: string; token: string }> = []
    const safariFallbackUids: string[] = []
    for (const uid of memberUids) {
      const userDoc = await firestore.collection('users').doc(uid).get()
      const u = userDoc.data() as any
      const tCount = Array.isArray(u?.fcmTokens) ? u.fcmTokens.length : 0
      logger.info('member token presence', { familyId, uid, tokenCount: tCount, safariFallback: !!u?.isSafari })
      if (tCount > 0) {
        for (const t of u!.fcmTokens as string[]) userTokens.push({ uid, token: t })
      } else if (u?.isSafari) {
        safariFallbackUids.push(uid)
      }
    }

    const tokens = Array.from(new Set(userTokens.map(x => x.token))) // dedupe
    logger.info('push token summary', {
      familyId,
      memberCount: memberUids.length,
      distinctTokenCount: tokens.length,
      safariFallbackCount: safariFallbackUids.length,
    })

    const tag = String(extraData.tag ?? `abot:${familyId}`)
    const url = String(extraData.url ?? '/')

    // Multicast in chunks
    if (tokens.length > 0) {
      const chunks = chunk(tokens, 500)
      logger.info('multicast chunks', { familyId, chunks: chunks.length })
      for (const part of chunks) {
        try {
          const res = await messaging.sendEachForMulticast({
            tokens: part,
            notification: { title, body },
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
            data: { familyId, ...extraData, tag, url },
          })

          logger.info('multicast result', {
            familyId,
            successCount: res.successCount,
            failureCount: res.failureCount,
          })

          // prune invalid tokens
          const removals: Array<Promise<any>> = []
          res.responses.forEach((r, i) => {
            if (!r.success) {
              const token = part[i]
              const code = (r.error as any)?.code || ''
              if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token')) {
                const owners = userTokens.filter(ut => ut.token === token).map(ut => ut.uid)
                logger.warn('pruning invalid token', { familyId, ownersCount: owners.length })
                owners.forEach(uid => {
                  removals.push(
                    firestore.collection('users').doc(uid).update({
                      fcmTokens: admin.firestore.FieldValue.arrayRemove(token),
                    }).catch(() => { })
                  )
                })
              } else {
                logger.error('push failed', { familyId, errorCode: code, message: r.error?.message ?? 'unknown' })
              }
            }
          })
          await Promise.all(removals)
        } catch (err) {
          logger.error('multicast exception', { familyId, error: err instanceof Error ? err.message : JSON.stringify(err) })
        }
      }
    } else {
      logger.info('no webpush tokens to notify', { familyId })
    }

    // Safari fallback queue
    for (const uid of safariFallbackUids) {
      try {
        await firestore.collection('users').doc(uid).update({
          pendingNotifications: admin.firestore.FieldValue.arrayUnion({
            title, body, familyId, ...extraData, tag, url, timestamp: Date.now(),
          }),
        })
        logger.info('queued safari fallback', { familyId, uid })
      } catch (err) {
        logger.error('safari fallback queue failed', { familyId, uid, error: err instanceof Error ? err.message : JSON.stringify(err) })
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

  logger.info('sendDeliveryNotificationForFamily called', { familyId, hasExpectedDate: !!expectedDate })
  if (!expectedDate || expectedDate < now || expectedDate >= tomorrow) {
    logger.info('skip: expectedDate not within [now, +24h)', { familyId })
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
        logger.error('Failed to set inTransitNotifiedAt', { familyId, deliveryId, error: (e as Error).message })
      }
    }
  }
)

export const scheduledDailyDeliveryNotification = scheduler.onSchedule(
  {
    schedule: '0 8 * * *',
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

      logger.info('Daily 8AM delivery detection complete', { dateKey, familiesNotified: visited.size })
    } catch (error) {
      logger.error('Error during daily delivery detection', {
        error: error instanceof Error ? error.message : JSON.stringify(error),
      })
      console.error('Full error stack:', error)
    }
  }
)

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

export const notifyPresenceStatusChange = onDocumentWritten(
  'families/{familyId}/members/{userId}',
  async (event) => {
    const { familyId, userId } = event.params as { familyId: string; userId: string };

    const before = event.data?.before.exists ? (event.data?.before.data() as any) : null;
    const after  = event.data?.after.exists  ? (event.data?.after.data()  as any) : null;

    // Deleted doc → ignore
    if (!after) return;

    // Resolve previous/next status from nested presence.status or fallback top-level status
    const prevStatus = String(before?.presence?.status ?? before?.status ?? '').toLowerCase();
    const nextStatus = String(after?.presence?.status  ?? after?.status  ?? '').toLowerCase();

    // Log so you can see it in Cloud logs
    logger.info('notifyPresenceStatusChange fired', {
      familyId, userId, prevStatus, nextStatus, hasBefore: !!before, hasAfter: !!after,
    });

    // First-time create without prior status? Skip to avoid noise.
    if (!before || !prevStatus) {
      return;
    }

    // Only notify on actual transition and only for home/away
    if (prevStatus === nextStatus) return;
    if (!['home', 'away'].includes(nextStatus)) return;

    // Best-effort name: prefer member doc.name, else users/{uid}
    let displayName = after?.name || userId;
    if (!after?.name) {
      try {
        const uDoc = await firestore.collection('users').doc(userId).get();
        const u = uDoc.data() as any;
        displayName = u?.displayName ?? u?.name ?? displayName;
      } catch { /* ignore */ }
    }

    const isAuto = (after?.presence?.statusSource === 'geo') || (after?.autoPresence === true);
    const title = nextStatus === 'home' ? 'Arrived home' : 'Left home';
    const body  = `${displayName} is now ${nextStatus}.`;

    // Record event (exclude the actor user)
    await recordEvent(
      familyId,
      'presence_changed',
      title,
      body,
      '/family',
      { uid: userId, status: nextStatus, auto: isAuto },
      { excludeUids: [userId] }
    );

    // Push to family members (exclude the actor user)
    await sendNotificationToFamilyMembers(
      familyId,
      title,
      body,
      { changedUserId: userId, status: nextStatus, tag: `presence:${familyId}:${userId}`, url: '/family' },
      { excludeUids: [userId] }
    );
  }
);

