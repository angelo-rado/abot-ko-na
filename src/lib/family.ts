import { firestore } from '@/lib/firebase'
import {
  collection,
  addDoc,
  doc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore'

export async function createFamily(familyName: string, userId: string) {
  // Step 1: Create the family document in /families
  const familyRef = await addDoc(collection(firestore, 'families'), {
    name: familyName,
    createdBy: userId,
    createdAt: serverTimestamp(),
    members: [userId], 
  })

  const familyId = familyRef.id

  // Step 2: Update the user's record with familyId and role
  await setDoc(doc(firestore, 'users', userId), {
    familyId,
    role: 'owner',
  }, { merge: true })

  // Step 3: Add the creator as a member in /families/{familyId}/members/{userId}
  await setDoc(doc(firestore, 'families', familyId, 'members', userId), {
    uid: userId,
    role: 'owner',
    addedAt: serverTimestamp(),

    // 🔌 New presence-related fields
    autoPresence: true,
    presence: {
      status: 'away',           // default is away until detected or set
      statusSource: 'manual',   // default source
      lastUpdated: serverTimestamp(),
    },
  })

  return familyId
}
