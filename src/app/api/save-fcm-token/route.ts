import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const admin = await import('firebase-admin')
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    })
  }

  const db = admin.firestore()
  const { FieldValue } = admin.firestore

  try {
    const { token, userId } = await req.json()
    if (!token || !userId) {
      return NextResponse.json({ ok: false, error: 'missing token/userId' }, { status: 400 })
    }

    // Verify the caller
    const authz = req.headers.get('authorization') || ''
    const idToken = authz.startsWith('Bearer ') ? authz.slice(7) : ''
    if (!idToken) return NextResponse.json({ ok: false, error: 'no auth' }, { status: 401 })
    const decoded = await admin.auth().verifyIdToken(idToken)
    if (decoded.uid !== userId) {
      return NextResponse.json({ ok: false, error: 'uid mismatch' }, { status: 403 })
    }

    const ua = req.headers.get('user-agent') || ''
    const isSafari = /Safari/i.test(ua) && !/Chrome|Chromium/i.test(ua)

    const ref = db.collection('users').doc(userId)
    await ref.set(
      {
        fcmTokens: FieldValue.arrayUnion(token),
        isSafari,
        platform: 'web',
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('Error saving token:', error)
    return NextResponse.json({ ok: false, error: error?.message || 'server error' }, { status: 500 })
  }
}
