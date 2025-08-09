import * as functions from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

admin.initializeApp();

const firestore = admin.firestore();
const messaging = admin.messaging();

export const notifyDeliveryInTransit = functions.firestore.onDocumentUpdated(
  'families/{familyId}/deliveries/{deliveryId}',
  async (event) => {
    console.log('Function triggered with params:', event.params);

    const beforeSnap = event.data?.before;
    const afterSnap = event.data?.after;
    const familyId = event.params.familyId;

    if (!beforeSnap || !afterSnap || !familyId) {
      console.log('Missing beforeSnap, afterSnap, or familyId - exiting');
      return null;
    }

    const before = beforeSnap.data();
    const after = afterSnap.data();

    if (!before || !after) {
      console.log('Missing before or after data - exiting');
      return null;
    }

    console.log('Before status:', before.status, 'After status:', after.status);

    if (before.status !== 'in_transit' && after.status === 'in_transit') {
      let expectedDate: Date | null = null;

      if (after.expectedDate) {
        if (typeof after.expectedDate === 'object' && 'toDate' in after.expectedDate) {
          expectedDate = (after.expectedDate as admin.firestore.Timestamp).toDate();
          console.log('Parsed expectedDate from Timestamp:', expectedDate);
        } else {
          expectedDate = new Date(after.expectedDate);
          console.log('Parsed expectedDate from string/date:', expectedDate);
        }
      } else {
        console.log('No expectedDate found on after snapshot');
      }

      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(now.getDate() + 1);

      console.log('Current date/time:', now);
      console.log('Tomorrow date/time:', tomorrow);

      if (expectedDate && expectedDate >= now && expectedDate <= tomorrow) {
        console.log('Expected date is between now and tomorrow, proceeding with notification');

        try {
          const familyUsersSnapshot = await firestore
            .collection('families')
            .doc(familyId)
            .collection('members')
            .get();

          const userIds = familyUsersSnapshot.docs.map((doc) => doc.id);
          console.log(`Found ${userIds.length} family members`);

          const tokens: string[] = [];
          for (const userId of userIds) {
            const userDoc = await firestore.collection('users').doc(userId).get();
            const userData = userDoc.data();
            if (userData && Array.isArray(userData.fcmTokens)) {
              console.log(`User ${userId} has ${userData.fcmTokens.length} FCM tokens`);
              tokens.push(...userData.fcmTokens);
            } else {
              console.log(`User ${userId} has no FCM tokens`);
            }
          }

          if (tokens.length === 0) {
            console.log('No FCM tokens found for any family members');
            return null;
          }

          console.log(`Sending notification to ${tokens.length} tokens`);

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
          console.log('Notifications sent:', response.successCount, 'failures:', response.failureCount);
        } catch (error) {
          console.error('Error sending notifications:', error);
        }
      } else {
        console.log('Expected date is not within now to tomorrow, no notification sent');
      }
    } else {
      console.log('Status change does not meet criteria for sending notification');
    }

    return null;
  }
);
