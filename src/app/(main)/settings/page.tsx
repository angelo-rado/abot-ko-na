'use client';

import { useEffect } from 'react';
import { useAuth } from '@/lib/useAuth';
import { useSelectedFamily } from '@/lib/useSelectedFamily';
import { useRouter } from 'next/navigation';
import { Separator } from '@/components/ui/separator';
import PresenceSettings from '@/app/components/PresenceSettings';
import LogoutButton from '@/app/components/LogoutButton';
import { Loader2 } from 'lucide-react';
import { useOnlineStatus } from '@/lib/hooks/useOnlinestatus';

export default function SettingsPage() {
  const { user, loading } = useAuth();
  const { loading: familyLoading } = useSelectedFamily(user?.familyId ?? null);
  const router = useRouter();

  const isOnline = useOnlineStatus()
    if (!isOnline) {
      return <p className="text-center text-red-500">You're offline — cached content only.</p>
    }

  useEffect(() => {
    if (!loading && user === null) {
      router.push('/');
    }
  }, [user, loading, router]);

  if (loading || familyLoading || user === null) {
    return (
      <main className="flex items-center justify-center h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  return (
    <main className="max-w-xl mx-auto p-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Settings</h1>
        <Separator />
      </div>

      <div className="space-y-1">
        <p className="text-sm">
          Logged in as <strong>{user.name}</strong>
        </p>
        <p className="text-xs text-muted-foreground">{user.email}</p>
      </div>

      <LogoutButton />
      <Separator />

      <PresenceSettings /> {/* or <PresenceSettings familyId={familyId} /> */}
      <Separator />
    </main>
  );
}
