'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/useAuth';
import { firestore } from '@/lib/firebase';
import { doc, getDoc, setDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

export default function FamilyJoinPageContent() {
  const sp = useSearchParams();
  const router = useRouter();
  const { user, loading } = useAuth();

  const familyId = sp.get('invite')?.trim() || '';
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If not logged in, show a safe prompt — no Firestore calls.
  if (!loading && !user) {
    const next = `/family/join?invite=${encodeURIComponent(familyId)}`;
    return (
      <div className="max-w-md mx-auto p-6 space-y-3">
        <h1 className="text-lg font-semibold">Join family</h1>
        <p className="text-sm text-muted-foreground">You need to sign in to join this family.</p>
        <Button type="button" onClick={() => router.push(`/login?next=${encodeURIComponent(next)}`)}>
          Sign in to continue
        </Button>
      </div>
    );
  }

  useEffect(() => {
    if (loading) return;
    if (!user || !familyId) return;

    let cancelled = false;
    (async () => {
      setWorking(true);
      setError(null);
      try {
        // Validate family exists
        const famRef = doc(firestore, 'families', familyId);
        const famSnap = await getDoc(famRef);
        if (!famSnap.exists()) {
          setError('This invite link is invalid or has expired.');
          return;
        }

        // Add membership (both subcollection doc and array for compatibility)
        await setDoc(
          doc(firestore, 'families', familyId, 'members', user.uid),
          { joinedAt: Date.now() },
          { merge: true }
        );
        await updateDoc(famRef, { members: arrayUnion(user.uid) }).catch(() => {});

        // Optional: remember preferredFamily
        await updateDoc(doc(firestore, 'users', user.uid), { preferredFamily: familyId }).catch(() => {});

        if (!cancelled) router.replace(`/family/${familyId}`);
      } catch (e: any) {
        console.error('join failed', e);
        if (!cancelled) setError(e?.message ?? 'Failed to join family.');
      } finally {
        if (!cancelled) setWorking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, user, familyId, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!familyId) {
    return (
      <div className="max-w-md mx-auto p-6">
        <p className="text-sm text-red-500">Invalid invite link.</p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-6 space-y-2">
      <div className="flex items-center gap-2">
        <Loader2 className={`w-4 h-4 ${working ? 'animate-spin' : 'hidden'}`} />
        <p className="text-sm">{working ? 'Joining family…' : 'Preparing join…'}</p>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
