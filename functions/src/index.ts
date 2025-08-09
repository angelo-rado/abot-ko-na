import * as functions from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import winston from 'winston';
import { LoggingWinston } from '@google-cloud/logging-winston';

admin.initializeApp();

const firestore = admin.firestore();
const messaging = admin.messaging();

// Create Winston logger with Cloud Logging transport
const loggingWinston = new LoggingWinston();
const logger = winston.createLogger({
  level: 'info',
  transports: [
    new winston.transports.Console(), // Also logs to console
    loggingWinston, // Sends logs to Google Cloud Logging
  ],
});

export const notifyDeliveryInTransit = functions.firestore.onDocumentUpdated(
  'families/{familyId}/deliveries/{deliveryId}',
  async (event) => {
    logger.info('Function triggered with params', { params: event.params });

    const beforeSnap = event.data?.before;
    const afterSnap = event.data?.after;
    const familyId = event.params.familyId;

    if (!beforeSnap || !afterSnap || !familyId) {
      logger.warn('Missing beforeSnap, afterSnap, or familyId - exiting');
      return null;
    }

    const before = beforeSnap.data();
    const after = afterSnap.data();

    if (!before || !after) {
      logger.warn('Missing before or after data - exiting');
      return null;
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

      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(now.getDate() + 1);

      logger.info('Current date/time and Tomorrow date/time', { now, tomorrow });

      if (expectedDate && expectedDate >= now && expectedDate <= tomorrow) {
        logger.info('Expected date is between now and tomorrow, proceeding with notification');

        try {
          const familyUsersSnapshot = await firestore
            .collection('families')
            .doc(familyId)
            .collection('members')
            .get();

          const userIds = familyUsersSnapshot.docs.map((doc) => doc.id);
          logger.info(`Found family members`, { count: userIds.length });

          const tokens: string[] = [];
          for (const userId of userIds) {
            const userDoc = await firestore.collection('users').doc(userId).get();
            const userData = userDoc.data();
            if (userData && Array.isArray(userData.fcmTokens)) {
              logger.info(`User has FCM tokens`, { userId, tokensCount: userData.fcmTokens.length });
              tokens.push(...userData.fcmTokens);
            } else {
              logger.info(`User has no FCM tokens`, { userId });
            }
          }

          if (tokens.length === 0) {
            logger.warn('No FCM tokens found for any family members');
            return null;
          }

          logger.info('Sending notification to tokens', { count: tokens.length });

          const payload: admin.messaging.MessagingPayload = {
            notification: {
              title: 'Delivery is on its way!',
              body: 'Delivery expected today is now in transit.',
              icon: '/android-chrome-192x192.png',
            },
            data: {
              familyId,
            },
          };

          const message: admin.messaging.MulticastMessage = {
            tokens,
            notification: payload.notification,
            data: payload.data,
          };

          const response = await messaging.sendMulticast(message);
          logger.info('Notifications sent', { successCount: response.successCount, failureCount: response.failureCount });

          if (response.failureCount > 0) {
            response.responses.forEach((resp, idx) => {
              if (!resp.success) {
                logger.error('Failed to send notification', { token: tokens[idx], error: resp.error });
              }
            });
          }
        } catch (error) {
          logger.error('Error sending notifications', { error });
        }
      } else {
        logger.info('Expected date is not within now to tomorrow, no notification sent');
      }
    } else {
      logger.info('Status change does not meet criteria for sending notification');
    }

    return null;
  }
);
