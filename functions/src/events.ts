// functions/src/events.ts
import * as admin from 'firebase-admin'

if (!admin.apps.length) admin.initializeApp()
const db = admin.firestore()

type EventPayload = {
  familyId: string
  type: string
  title: string
  body?: string | null
  link?: string | null
  meta?: Record<string, any> | null
  excludeUids?: string[] // e.g., actor uid
}

async function getFamilyMemberUids(familyId: string): Promise<string[]> {
  // Preferred: families/{id}.members array
  const famSnap = await db.doc(`families/${familyId}`).get()
  const membersArray = (famSnap.get('members') as string[] | undefined) ?? []

  if (Array.isArray(membersArray) && membersArray.length > 0) {
    return [...new Set(membersArray.filter(Boolean))]
  }

  // Fallback: subcollection docs as members
  const memCol = await db.collection(`families/${familyId}/members`).select().get()
  return memCol.docs.map((d) => d.id)
}

export async function emitEvent({
  familyId,
  type,
  title,
  body = null,
  link = null,
  meta = null,
  excludeUids = [],
}: EventPayload) {
  const targets = (await getFamilyMemberUids(familyId)).filter((uid) => !excludeUids.includes(uid))
  if (targets.length === 0) return

  const evRef = db.collection(`families/${familyId}/events`).doc()
  const payload = {
    familyId,
    type,
    title,
    body,
    link,
    meta,
    targets,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }

  await evRef.set(payload)

  // OPTIONAL: fan-out to user notifications (disabled by default)
  if (process.env.FALLBACK_USER_NOTIFICATIONS === '1') {
    const batch = db.batch()
    targets.forEach((uid) => {
      const uref = db.doc(`users/${uid}/notifications/${evRef.id}`)
      batch.set(uref, payload, { merge: true })
    })
    await batch.commit()
  }

  // OPTIONAL: basic FCM push (data-only). Requires user tokens at users/{uid}.fcmTokens map
  if (process.env.SEND_FCM === '1') {
    const userSnaps = await Promise.all(
      targets.map((uid) => db.doc(`users/${uid}`).get())
    )
    const tokens: string[] = []
    userSnaps.forEach((s) => {
      const map = (s.get('fcmTokens') as Record<string, boolean> | undefined) ?? {}
      Object.keys(map || {}).forEach((t) => tokens.push(t))
    })
    if (tokens.length) {
      await admin.messaging().sendEachForMulticast({
        tokens: [...new Set(tokens)],
        data: {
          type,
          familyId,
          title: title ?? '',
          body: body ?? '',
          link: link ?? '',
          eventId: evRef.id,
        },
        android: { priority: 'high' },
        apns: { headers: { 'apns-priority': '10' } },
      })
    }
  }
}
