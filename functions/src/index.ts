import * as functions from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

admin.initializeApp();

const firestore = admin.firestore();
const messaging = admin.messaging();

export const notifyDeliveryInTransit = functions.firestore.onDocumentUpdated(
  'families/{familyId}/deliveries/{deliveryId}',
  async (event) => {
    const beforeSnap = event.data?.before;
    const afterSnap = event.data?.after;
    const familyId = event.params.familyId;

    if (!beforeSnap || !afterSnap || !familyId) return null;

    const before = beforeSnap.data();
    const after = afterSnap.data();

    if (!before || !after) return null;

    if (before.status !== 'in_transit' && after.status === 'in_transit') {
      let expectedDate: Date | null = null;

      if (after.expectedDate) {
        if (typeof after.expectedDate === 'object' && 'toDate' in after.expectedDate) {
          expectedDate = (after.expectedDate as admin.firestore.Timestamp).toDate();
        } else {
          expectedDate = new Date(after.expectedDate);
        }
      }

      const now = new Date();
      if (expectedDate && expectedDate <= now) {
        try {
          const familyUsersSnapshot = await firestore
            .collection('families')
            .doc(familyId)
            .collection('members')
            .get();

          const userIds = familyUsersSnapshot.docs.map((doc) => doc.id);

          const tokens: string[] = [];
          for (const userId of userIds) {
            const userDoc = await firestore.collection('users').doc(userId).get();
            const userData = userDoc.data();
            if (userData && Array.isArray(userData.fcmTokens)) {
              tokens.push(...userData.fcmTokens);
            }
          }

          if (tokens.length === 0) {
            console.log('No FCM tokens found for family members');
            return null;
          }

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
          console.log('Notifications sent:', response.successCount);
        } catch (error) {
          console.error('Error sending notifications:', error);
        }
      }
    }
    return null;
  }
);
