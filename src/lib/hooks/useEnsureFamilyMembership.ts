// src/lib/hooks/useEnsureFamilyMembership.ts
'use client'
import { useEffect } from 'react'
import { doc, setDoc } from 'firebase/firestore'
import { firestore } from '@/lib/firebase'

type Profile = { name?: string | null; photoURL?: string | null }

export function useEnsureFamilyMembership(
  familyId?: string | null,
  uid?: string | null,
  profile?: Profile
) {
  useEffect(() => {
    if (!familyId || !uid) return
    // create/merge my member doc ASAP so rules see me as a member
    setDoc(
      doc(firestore, 'families', familyId, 'members', uid),
      {
        uid,
        name: profile?.name ?? null,
        photoURL: profile?.photoURL ?? null,
      },
      { merge: true }
    ).catch((e) => console.warn('[ensureMember] failed', e))
  }, [familyId, uid, profile?.name, profile?.photoURL])
}
