import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const admin = await import('firebase-admin');

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }

  const firestore = admin.firestore();
  const FieldValue = admin.firestore.FieldValue;

  try {
    const { token, userId } = await req.json();

    if (!token || !userId) {
      return NextResponse.json({ error: 'Missing token or userId' }, { status: 400 });
    }

    const userRef = firestore.collection('users').doc(userId);

    await userRef.set(
      {
        fcmTokens: FieldValue.arrayUnion(token),
      },
      { merge: true }
    );

    console.log(`Saved FCM token for user ${userId}: ${token}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving token:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
