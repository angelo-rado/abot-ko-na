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

/** Util: today’s [start,end) in UTC (adjust if you store local dates) */
function getTodayBounds(): { startOfDay: Date; endOfDay: Date } {
  const now = new Date();
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const endOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return { startOfDay, endOfDay };
}

/** Util: YYYY-MM-DD in UTC for idempotency key */
function formatDateKeyUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Idempotency guard so we only notify a family once per day at the 8AM run.
 * Marker path: system/dailyDeliveryNotifications/{yyyy-mm-dd}/families/ids/{familyId}
 */
async function markDailyNotifiedIfNeeded(familyId: string, dateKey: string): Promise<boolean> {
  const ref = firestore
    .collection('system')
    .doc('dailyDeliveryNotifications')
    .collection(dateKey)
    .doc('families')
    .collection('ids')
    .doc(familyId);

  const snap = await ref.get();
  if (snap.exists) return false; // already notified today

  await ref.set({ at: admin.firestore.FieldValue.serverTimestamp() });
  return true;
}

async function sendDeliveryNotificationForFamily(familyId: string, expectedDate: Date | null) {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  logger.info('sendDeliveryNotificationForFamily called', { familyId, expectedDate, now, tomorrow });

  // Only notify if expectedDate is within [now, tomorrow)
  if (!expectedDate || expectedDate < now || expectedDate >= tomorrow) {
    logger.info('Expected date not within window; skip', { familyId, expectedDate });
    return;
  }

  try {
    const membersSnap = await firestore
      .collection('families')
      .doc(familyId)
      .collection('members')
      .get();

    const userIds = membersSnap.docs.map((d) => d.id);
    logger.info('Found family members', { familyId, count: userIds.length });

    const tokens: string[] = [];
    const safariUsers: string[] = [];

    for (const uid of userIds) {
      const userDoc = await firestore.collection('users').doc(uid).get();
      const u = userDoc.data() as any;
      if (u && Array.isArray(u.fcmTokens) && u.fcmTokens.length > 0) {
        tokens.push(...u.fcmTokens);
      } else if (u?.isSafari) {
        safariUsers.push(uid);
      }
    }

    if (tokens.length === 0 && safariUsers.length === 0) {
      logger.warn('No FCM tokens or Safari fallback targets', { familyId });
      return;
    }

    // Send to FCM tokens
    for (const token of tokens) {
      const message: admin.messaging.Message = {
        token,
        notification: {
          title: 'Delivery is on its way!',
          body: 'Delivery expected today is now in transit.',
        },
        data: { familyId },
      };
      try {
        const response = await messaging.send(message);
        logger.info('Notification sent', { token, response });
      } catch (err) {
        logger.error('Failed to send notification', {
          token,
          error: err instanceof Error ? err.message : JSON.stringify(err),
        });
      }
    }

    // Safari fallback
    for (const uid of safariUsers) {
      try {
        await firestore.collection('users').doc(uid).update({
          pendingNotifications: admin.firestore.FieldValue.arrayUnion({
            title: 'Delivery is on its way!',
            body: 'Delivery expected today is now in transit.',
            familyId,
            timestamp: Date.now(),
          }),
        });
      } catch (err) {
        logger.error('Failed to queue Safari fallback', {
          uid,
          error: err instanceof Error ? err.message : JSON.stringify(err),
        });
      }
    }
  } catch (error) {
    logger.error('Error sending notifications', {
      familyId,
      error: error instanceof Error ? error.message : JSON.stringify(error),
    });
    console.error('Full error stack:', error);
  }
}

// === existing trigger: status -> in_transit (unchanged) ===
export const notifyDeliveryInTransit = functions.firestore.onDocumentUpdated(
  'families/{familyId}/deliveries/{deliveryId}',
  async (event) => {
    logger.info('notifyDeliveryInTransit triggered', { params: event.params });

    const beforeSnap = event.data?.before;
    const afterSnap = event.data?.after;
    const familyId = event.params.familyId;

    if (!beforeSnap || !afterSnap || !familyId) {
      logger.warn('Missing before/after/familyId - exiting');
      return;
    }

    const before = beforeSnap.data() as any;
    const after = afterSnap.data() as any;

    if (!before || !after) {
      logger.warn('Missing before/after data - exiting');
      return;
    }

    if (before.status !== 'in_transit' && after.status === 'in_transit') {
      let expectedDate: Date | null = null;

      if (after.expectedDate) {
        if (typeof after.expectedDate === 'object' && 'toDate' in after.expectedDate) {
          expectedDate = (after.expectedDate as admin.firestore.Timestamp).toDate();
        } else {
          expectedDate = new Date(after.expectedDate);
        }
      }

      await sendDeliveryNotificationForFamily(familyId, expectedDate);
    }
  }
);

// === new: daily 8AM sweep for deliveries expected TODAY with status != 'delivered' ===
export const scheduledDailyDeliveryNotification = scheduler.onSchedule(
  {
    schedule: '0 8 * * *',       // every day at 8:00
    timeZone: 'Asia/Manila',     // <- change if needed
  },
  async () => {
    logger.info('Daily 8AM delivery detection start');

    const { startOfDay, endOfDay } = getTodayBounds();
    const dateKey = formatDateKeyUTC(startOfDay);

    try {
      const snap = await firestore
        .collectionGroup('deliveries')
        .where('expectedDate', '>=', startOfDay)
        .where('expectedDate', '<', endOfDay)
        .where('status', '!=', 'delivered')  // ✅ anything except delivered
        .orderBy('status')                   // required with '!='
        .get();

      if (snap.empty) {
        logger.info('No deliveries found for today', { dateKey });
        return;
      }

      const visited = new Set<string>();

      for (const docSnap of snap.docs) {
        const familyId = docSnap.ref.parent.parent?.id;
        if (!familyId || visited.has(familyId)) continue;

        // Only notify a family once per day at the daily job
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
            expectedDate = new Date(delivery.expectedDate);
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
