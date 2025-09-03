import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

type Body = { token?: string; userId?: string };

function json(data: unknown, status = 200) {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

// Minimal token sanity check (still allow any FCM format incl. WebPush/VAPID)
function looksValidToken(t?: string) {
  if (!t) return false;
  const s = t.trim();
  if (!s || s.length < 16) return false; // guard against '', 'undefined', etc.
  return true;
}

export async function OPTIONS() {
  // Allow same-origin callers and preflights cleanly
  return new NextResponse(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      'cache-control': 'no-store',
    },
  });
}

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

  const db = admin.firestore();
  const { FieldValue } = admin.firestore;

  try {
    const body = (await req.json()) as Body;
    const token = (body?.token ?? '').trim();
    const userId = (body?.userId ?? '').trim();

    if (!looksValidToken(token) || !userId) {
      return json({ ok: false, error: 'missing/invalid token or userId' }, 400);
    }

    // Verify the caller via Firebase ID token
    const authz = req.headers.get('authorization') || '';
    const idToken = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (!idToken) return json({ ok: false, error: 'no auth' }, 401);

    const decoded = await admin.auth().verifyIdToken(idToken);
    if (decoded.uid !== userId) return json({ ok: false, error: 'uid mismatch' }, 403);

    const ua = req.headers.get('user-agent') || '';
    const isSafari = /Safari/i.test(ua) && !/Chrome|Chromium/i.test(ua);

    const userRef = db.collection('users').doc(userId);

    // Keep existing shape: fcmTokens array + add helpful metadata (non-breaking).
    // serverTimestamp() per project rule.
    await userRef.set(
      {
        fcmTokens: FieldValue.arrayUnion(token),
        lastToken: token,
        platform: 'web',
        isSafari,
        userAgent: ua.slice(0, 512),
        updatedAt: FieldValue.serverTimestamp(),
        // Optional audit map keyed by token for quick last-seen (doesn't break reads)
        tokenMeta: {
          [token]: {
            addedAt: FieldValue.serverTimestamp(),
            platform: 'web',
            isSafari,
          },
        },
      } as any,
      { merge: true }
    );

    return json({ ok: true });
  } catch (error: unknown) {
    console.error('Error saving token:', error);
    // Don’t leak stack traces to clients
    return json({ ok: false, error: 'server error' }, 500);
  }
}
