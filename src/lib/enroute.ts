// src/lib/enroute.ts
//
// "On my way home" broadcast helpers. Writes onto the family member document so
// the change streams live to every family member's "Who's Home" view via the
// existing onSnapshot listener — no extra infrastructure required.

import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { firestore } from '@/lib/firebase'

export const ETA_OPTIONS: { label: string; minutes: number | null }[] = [
  { label: 'No ETA', minutes: null },
  { label: '5 min', minutes: 5 },
  { label: '10 min', minutes: 10 },
  { label: '15 min', minutes: 15 },
  { label: '30 min', minutes: 30 },
  { label: '45 min', minutes: 45 },
  { label: '1 hr', minutes: 60 },
]

/** Start broadcasting "on my way home", with an optional self-reported ETA. */
export async function setEnRoute(
  familyId: string,
  uid: string,
  etaMinutes: number | null,
  profile?: { name?: string; photoURL?: string | null }
) {
  const ref = doc(firestore, 'families', familyId, 'members', uid)
  await setDoc(
    ref,
    {
      enRoute: true,
      enRouteSince: serverTimestamp(),
      etaMinutes: etaMinutes ?? null,
      updatedAt: serverTimestamp(),
      uid,
      ...(profile?.name ? { name: profile.name } : {}),
      ...(profile?.photoURL !== undefined ? { photoURL: profile.photoURL } : {}),
    },
    { merge: true }
  )
}

/** Stop broadcasting "on my way home". */
export async function clearEnRoute(familyId: string, uid: string) {
  const ref = doc(firestore, 'families', familyId, 'members', uid)
  await setDoc(
    ref,
    {
      enRoute: false,
      etaMinutes: null,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  )
}
