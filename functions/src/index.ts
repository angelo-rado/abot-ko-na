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
    transports: [
        new winston.transports.Console(),
        loggingWinston,
    ],
});

async function sendDeliveryNotificationForFamily(familyId: string, expectedDate: Date | null) {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  logger.info('sendDeliveryNotificationForFamily called', { familyId, expectedDate, now, tomorrow });

  if (!expectedDate || expectedDate < now || expectedDate > tomorrow) {
    logger.info('Expected date is not within now to tomorrow, no notification sent', { familyId, expectedDate });
    return;
  }

  try {
    const familyUsersSnapshot = await firestore
      .collection('families')
      .doc(familyId)
      .collection('members')
      .get();

    const userIds = familyUsersSnapshot.docs.map((doc) => doc.id);
    logger.info(`Found family members`, { familyId, count: userIds.length, userIds });

    const tokens: string[] = [];
    for (const userId of userIds) {
      const userDoc = await firestore.collection('users').doc(userId).get();
      const userData = userDoc.data();
      if (userData && Array.isArray(userData.fcmTokens)) {
        logger.info(`User has FCM tokens`, { userId, tokensCount: userData.fcmTokens.length, tokens: userData.fcmTokens });
        tokens.push(...userData.fcmTokens);
      } else {
        logger.info(`User has no FCM tokens`, { userId });
      }
    }

    if (tokens.length === 0) {
      logger.warn('No FCM tokens found for any family members', { familyId });
      return;
    }

    logger.info('Sending notifications individually to tokens', { familyId, tokensCount: tokens.length, tokensSample: tokens.slice(0, 5) });

    for (const token of tokens) {
      const message: admin.messaging.Message = {
        token,
        notification: {
          title: 'Delivery is on its way!',
          body: 'Delivery expected today is now in transit.',
          //icon: '/android-chrome-192x192.png',
        },
        data: {
          familyId,
        },
      };

      try {
        const response = await messaging.send(message);
        logger.info('Notification sent', { token, response });
      } catch (err) {
        logger.error('Failed to send notification', { token, error: err instanceof Error ? err.message : JSON.stringify(err) });
      }
    }
  } catch (error) {
    logger.error('Error sending notifications', { familyId, error: error instanceof Error ? error.message : JSON.stringify(error) });
    console.error('Full error stack:', error);
  }
}




export const notifyDeliveryInTransit = functions.firestore.onDocumentUpdated(
    'families/{familyId}/deliveries/{deliveryId}',
    async (event) => {
        logger.info('Function triggered with params', { params: event.params });

        const beforeSnap = event.data?.before;
        const afterSnap = event.data?.after;
        const familyId = event.params.familyId;

        if (!beforeSnap || !afterSnap || !familyId) {
            logger.warn('Missing beforeSnap, afterSnap, or familyId - exiting');
            return;
        }

        const before = beforeSnap.data();
        const after = afterSnap.data();

        if (!before || !after) {
            logger.warn('Missing before or after data - exiting');
            return;
        }

        logger.info('Before status and After status', { beforeStatus: before.status, afterStatus: after.status });

        if (before.status !== 'in_transit' && after.status === 'in_transit') {
            let expectedDate: Date | null = null;

            if (after.expectedDate) {
                if (typeof after.expectedDate === 'object' && 'toDate' in after.expectedDate) {
                    expectedDate = (after.expectedDate as admin.firestore.Timestamp).toDate();
                    logger.info('Parsed expectedDate from Timestamp', { expectedDate });
                } else {
                    expectedDate = new Date(after.expectedDate);
                    logger.info('Parsed expectedDate from string/date', { expectedDate });
                }
            } else {
                logger.info('No expectedDate found on after snapshot');
            }

            logger.info('Calling sendDeliveryNotificationForFamily', { familyId, expectedDate });

            await sendDeliveryNotificationForFamily(familyId, expectedDate);

            logger.info('sendDeliveryNotificationForFamily call complete', { familyId });
        } else {
            logger.info('Status change does not meet criteria for sending notification');
        }

        return;
    }
);


export const scheduledDeliveryNotification = scheduler.onSchedule('every 1 hours', async (event) => {
    logger.info('Scheduled delivery notification triggered');

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    try {
        const deliveriesSnap = await firestore.collectionGroup('deliveries')
            .where('expectedDate', '>=', startOfDay)
            .where('expectedDate', '<', endOfDay)
            .where('status', 'in', ['pending', 'in_transit'])
            .get();

        if (deliveriesSnap.empty) {
            logger.info('No deliveries found for today');
            return;
        }

        const notifiedFamilies = new Set<string>();

        for (const doc of deliveriesSnap.docs) {
            const delivery = doc.data();
            const familyId = doc.ref.parent.parent?.id;
            if (!familyId || notifiedFamilies.has(familyId)) continue;

            let expectedDate: Date | null = null;
            if (delivery.expectedDate) {
                if (typeof delivery.expectedDate === 'object' && 'toDate' in delivery.expectedDate) {
                    expectedDate = delivery.expectedDate.toDate();
                } else {
                    expectedDate = new Date(delivery.expectedDate);
                }
            }

            await sendDeliveryNotificationForFamily(familyId, expectedDate);
            notifiedFamilies.add(familyId);
        }
    } catch (error) {
        logger.error('Error during scheduled notification', { error: error instanceof Error ? error.message : JSON.stringify(error) });
        console.error('Full error stack:', error);
    }

    return;
});
