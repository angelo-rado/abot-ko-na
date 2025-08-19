import * as functions from 'firebase-functions/v2';
import { scheduler } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import winston from 'winston';
import { LoggingWinston } from '@google-cloud/logging-winston';

admin.initializeApp();

const firestore = admin.firestore();
const messaging = admin.messaging();

const loggingWinston = new LoggingWinston();
const logger = winston.createLogger({
  level: 'info',
  transports: [new winston.transports.Console(), loggingWinston],
});

/* =============================================================================
   Timezone helpers (Asia/Manila)
   ============================================================================= */

const TZ_OFFSETS_HOURS: Record<string, number> = {
  'Asia/Manila': 8,
  UTC: 0,
};

function getTodayBoundsInTimeZone(timeZone: string): {
  startOfDay: Date;
  endOfDay: Date;
  dateKey: string; // yyyy-mm-dd in the target time zone
} {
  const offsetH = TZ_OFFSETS_HOURS[timeZone] ?? 0;

  const nowUtc = new Date();
  const zonedNow = new Date(nowUtc.getTime() + offsetH * 3600_000);

  const y = zonedNow.getUTCFullYear();
  const m = zonedNow.getUTCMonth();
  const d = zonedNow.getUTCDate();

  const startOfDayUtc = new Date(Date.UTC(y, m, d) - offsetH * 3600_000);
  const endOfDayUtc = new Date(startOfDayUtc.getTime() + 24 * 3600_000);

  const dateKey = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { startOfDay: startOfDayUtc, endOfDay: endOfDayUtc, dateKey };
}

/* =============================================================================
   Utils
   ============================================================================= */

function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* =============================================================================
   Idempotency for the daily sweep
   ============================================================================= */

async function markDailyNotifiedIfNeeded(familyId: string, dateKey: string): Promise<boolean> {
  const ref = firestore
    .collection('system')
    .doc('dailyDeliveryNotifications')
    .collection(dateKey)
    .doc('families')
    .collection('ids')
    .doc(familyId);

  const snap = await ref.get();
  if (snap.exists) return false;

  await ref.set({ at: admin.firestore.FieldValue.serverTimestamp() });
  return true;
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
    const exclude = new Set(opts?.excludeUids ?? []);

    // Get member UIDs from subcollection: families/{familyId}/members/{uid}
    const membersSnap = await firestore
      .collection('families')
      .doc(familyId)
      .collection('members')
      .get();

    const memberUids = membersSnap.docs.map((d) => d.id).filter((uid) => !exclude.has(uid));

    const fcmTokens: string[] = [];
    const safariFallbackUids: string[] = [];

    // Collect tokens & Safari fallback
    for (const uid of memberUids) {
      const userDoc = await firestore.collection('users').doc(uid).get();
      const u = userDoc.data() as any;
      if (u && Array.isArray(u.fcmTokens) && u.fcmTokens.length > 0) {
        fcmTokens.push(...u.fcmTokens);
      } else if (u?.isSafari) {
        safariFallbackUids.push(uid);
      }
    }

    const tokens = Array.from(new Set(fcmTokens)); // dedupe

    // Multicast in chunks of 500 (FCM limit)
    if (tokens.length > 0) {
      const chunks = chunk(tokens, 500);
      for (const part of chunks) {
        try {
          const res = await messaging.sendEachForMulticast({
            tokens: part,
            notification: { title, body },
            data: { familyId, ...extraData },
          });
          logger.info('Push multicast result', {
            familyId,
            successCount: res.successCount,
            failureCount: res.failureCount,
          });

          // Optional: log specific errors per token (kept concise)
          res.responses.forEach((r, i) => {
            if (!r.success) {
              logger.error('Push failed', {
                token: part[i],
                error: r.error?.message ?? 'unknown',
              });
            }
          });
        } catch (err) {
          logger.error('Push multicast exception', {
            error: err instanceof Error ? err.message : JSON.stringify(err),
          });
        }
      }
    }

    // Safari fallback: queue on user doc
    for (const uid of safariFallbackUids) {
      try {
        await firestore.collection('users').doc(uid).update({
          pendingNotifications: admin.firestore.FieldValue.arrayUnion({
            title,
            body,
            familyId,
            ...extraData,
            timestamp: Date.now(),
          }),
        });
      } catch (err) {
        logger.error('Safari fallback queue failed', {
          uid,
          error: err instanceof Error ? err.message : JSON.stringify(err),
        });
      }
    }
  } catch (err) {
    logger.error('sendNotificationToFamilyMembers error', {
      familyId,
      error: err instanceof Error ? err.message : JSON.stringify(err),
    });
  }
}

/* =============================================================================
   Delivery-specific notifier used by triggers below
   ============================================================================= */

async function sendDeliveryNotificationForFamily(familyId: string, expectedDate: Date | null) {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  logger.info('sendDeliveryNotificationForFamily called', { familyId, expectedDate });

  // Only notify if expectedDate is within [now, tomorrow)
  if (!expectedDate || expectedDate < now || expectedDate >= tomorrow) {
    logger.info('Expected date not within [now, +24h); skip', { familyId, expectedDate });
    return;
  }

  await sendNotificationToFamilyMembers(
    familyId,
    'Delivery is on its way!',
    'Delivery expected today is now in transit.'
  );
}

/* =============================================================================
   Triggers
   ============================================================================= */

/**
 * 1) Status change -> in_transit (existing behavior)
 */
export const notifyDeliveryInTransit = functions.firestore.onDocumentUpdated(
  'families/{familyId}/deliveries/{deliveryId}',
  async (event) => {
    logger.info('notifyDeliveryInTransit triggered', { params: event.params });

    const beforeSnap = event.data?.before;
    const afterSnap  = event.data?.after;
    const familyId   = event.params.familyId as string;

    if (!beforeSnap || !afterSnap || !familyId) return;

    const before = beforeSnap.data() as any;
    const after  = afterSnap.data() as any;
    if (!before || !after) return;

    const prevStatus = String(before.status ?? '').toLowerCase();
    const nextStatus = String(after.status ?? '').toLowerCase();

    if (prevStatus !== 'in_transit' && nextStatus === 'in_transit') {
      let expectedDate: Date | null = null;

      if (after.expectedDate) {
        if (typeof after.expectedDate === 'object' && 'toDate' in after.expectedDate) {
          expectedDate = (after.expectedDate as admin.firestore.Timestamp).toDate();
        } else {
          const d = new Date(after.expectedDate);
          expectedDate = isNaN(d.getTime()) ? null : d;
        }
      }

      await sendDeliveryNotificationForFamily(familyId, expectedDate);
    }
  }
);

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
    logger.info('Daily 8AM delivery detection start');

    const { startOfDay, endOfDay, dateKey } = getTodayBoundsInTimeZone('Asia/Manila');

    try {
      const snap = await firestore
        .collectionGroup('deliveries')
        .where('expectedDate', '>=', startOfDay)
        .where('expectedDate', '<', endOfDay)
        .where('status', 'in', ['pending', 'in_transit'])
        .get();

      if (snap.empty) {
        logger.info('No deliveries found for today', { dateKey });
        return;
      }

      const visited = new Set<string>();

      for (const docSnap of snap.docs) {
        const familyId = docSnap.ref.parent.parent?.id;
        if (!familyId || visited.has(familyId)) continue;

        // Only notify each family once per day
        const shouldNotify = await markDailyNotifiedIfNeeded(familyId, dateKey);
        if (!shouldNotify) {
          visited.add(familyId);
          continue;
        }

        const delivery = docSnap.data() as any;
        let expectedDate: Date | null = null;
        if (delivery?.expectedDate) {
          if (typeof delivery.expectedDate === 'object' && 'toDate' in delivery.expectedDate) {
            expectedDate = (delivery.expectedDate as admin.firestore.Timestamp).toDate();
          } else {
            const d = new Date(delivery.expectedDate);
            expectedDate = isNaN(d.getTime()) ? null : d;
          }
        }

        await sendDeliveryNotificationForFamily(familyId, expectedDate);
        visited.add(familyId);
      }

      logger.info('Daily 8AM delivery detection complete', {
        dateKey,
        familiesNotified: visited.size,
      });
    } catch (error) {
      logger.error('Error during daily delivery detection', {
        error: error instanceof Error ? error.message : JSON.stringify(error),
      });
      console.error('Full error stack:', error);
    }
  }
);

/**
 * 3) Creation trigger:
 *    Notify when a delivery is CREATED for TODAY (Asia/Manila)
 *    with status in ['pending','in_transit'].
 */
export const notifyDeliveryCreatedToday = functions.firestore.onDocumentCreated(
  'families/{familyId}/deliveries/{deliveryId}',
  async (event) => {
    const snap = event.data;
    const { familyId, deliveryId } = event.params as { familyId: string; deliveryId: string };
    if (!snap || !familyId) return;

    const d = snap.data() as any;
    const status = String(d?.status ?? 'pending').toLowerCase();
    if (!['pending', 'in_transit'].includes(status)) return;

    let expected: Date | null = null;
    if (d?.expectedDate) {
      if (typeof d.expectedDate === 'object' && 'toDate' in d.expectedDate) {
        expected = (d.expectedDate as admin.firestore.Timestamp).toDate();
      } else {
        const dt = new Date(d.expectedDate);
        expected = isNaN(dt.getTime()) ? null : dt;
      }
    }
    if (!expected) return;

    const { startOfDay, endOfDay } = getTodayBoundsInTimeZone('Asia/Manila');
    if (expected >= startOfDay && expected < endOfDay) {
      await sendNotificationToFamilyMembers(
        familyId,
        'New delivery for today',
        'A delivery scheduled for today was added.',
        { deliveryId }
      );
    }
  }
);

/**
 * 4) Presence change trigger:
 *    families/{familyId}/presence/{userId}
 *    Notify the family (excluding the user) when status becomes 'home' or 'away'.
 */
export const notifyPresenceStatusChange = functions.firestore.onDocumentUpdated(
  'families/{familyId}/presence/{userId}',
  async (event) => {
    const before = event.data?.before?.data() as any;
    const after = event.data?.after?.data() as any;
    const { familyId, userId } = event.params as { familyId: string; userId: string };

    if (!before || !after) return;
    if (before.status === after.status) return;

    const next = String(after.status ?? '').toLowerCase();
    if (!['home', 'away'].includes(next)) return;

    // Try to get a display name
    let displayName = userId;
    try {
      const uDoc = await firestore.collection('users').doc(userId).get();
      const u = uDoc.data() as any;
      displayName = u?.displayName ?? u?.name ?? userId;
    } catch {}

    const title = next === 'home' ? 'Arrived home' : 'Left home';
    const body = `${displayName} is now ${next}.`;

    await sendNotificationToFamilyMembers(
      familyId,
      title,
      body,
      { changedUserId: userId, status: next },
      { excludeUids: [userId] }
    );
  }
);
