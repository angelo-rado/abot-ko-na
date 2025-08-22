'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/useAuth';
import { useSelectedFamily } from '@/lib/useSelectedFamily';
import { useRouter } from 'next/navigation';
import { Separator } from '@/components/ui/separator';
import PresenceSettings from '@/app/components/PresenceSettings';
import LogoutButton from '@/app/components/LogoutButton';
import { Loader2, Monitor, Sun, Moon } from 'lucide-react';
import { useOnlineStatus } from '@/lib/hooks/useOnlinestatus';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { firestore, getFirebaseMessaging } from '@/lib/firebase';
import { doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { getToken, deleteToken } from 'firebase/messaging';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import DefaultFamilySelector from '@/app/components/DefaultFamilySelector';
import DisplayNameEditor from '@/app/components/DisplayNameEditor';

const VAPID_KEY =
  (
    process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ||
    process.env.NEXT_PUBLIC_VAPID_KEY ||
    ''
  ).trim() || undefined;

type UserLike = {
  uid: string;
  name?: string;
  email?: string;
  fcmTokens?: string[];
  familyId?: string | null;
};

export default function SettingsPage() {
  const { user, loading } = useAuth() as { user: UserLike | null; loading: boolean };
  const { loading: familyLoading } = useSelectedFamily(user?.familyId ?? null);
  const router = useRouter();
  const isOnline = useOnlineStatus();

  const [notifEnabled, setNotifEnabled] = useState(false);
  const [working, setWorking] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const notificationsSupported =
    typeof window !== 'undefined' && 'Notification' in window;

  // THEME
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const currentTheme = mounted ? (theme ?? 'system') : 'system';

  const offlineBanner = !isOnline ? (
    <p className="text-center text-red-500">You're offline — cached content only.</p>
  ) : null

  // auth gate
  useEffect(() => {
    if (!loading && user === null) router.push('/login');
  }, [user, loading, router]);

  // reflect permission on mount
  useEffect(() => {
    if (notificationsSupported) {
      setPermission(Notification.permission);
    }
  }, [notificationsSupported]);

  // init toggle from user doc + permission
  useEffect(() => {
    if (!user) return;
    const hasTokens = Array.isArray(user.fcmTokens) && user.fcmTokens.length > 0;
    const granted = notificationsSupported ? Notification.permission === 'granted' : false;
    setNotifEnabled(hasTokens && granted);
  }, [user, notificationsSupported]);

  if (loading || familyLoading || user === null) {
    return (
      <main className="flex items-center justify-center h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  async function enableNotifications(): Promise<void> {
    if (typeof window === 'undefined') return;
    if (!user?.uid) {
      toast.error('You need to be signed in to enable notifications.');
      setNotifEnabled(false);
      return;
    }
    if (!('serviceWorker' in navigator)) {
      toast.error('Notifications require Service Workers (not supported in this browser).');
      return;
    }
    if (!('Notification' in window)) {
      toast.error('Notifications are not supported on this device.');
      return;
    }
    if (!VAPID_KEY) {
      toast.error('Missing VAPID key. Set NEXT_PUBLIC_FIREBASE_VAPID_KEY (or NEXT_PUBLIC_VAPID_KEY).');
      setNotifEnabled(false);
      return;
    }

    setWorking(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm); // keep UI in sync
      if (perm !== 'granted') {
        toast.error('Permission was not granted.');
        setNotifEnabled(false);
        return;
      }

      const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      await navigator.serviceWorker.ready;

      const messaging = getFirebaseMessaging();
      if (!messaging) {
        toast.error('Messaging not initialized.');
        setNotifEnabled(false);
        return;
      }

      const token = await getToken(messaging, {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: registration,
      });
      if (!token) {
        toast.error('Failed to get notification token.');
        setNotifEnabled(false);
        return;
      }

      await updateDoc(doc(firestore, 'users', user.uid), {
        fcmTokens: arrayUnion(token),
        notificationsEnabled: true,
      });

      try {
        localStorage.setItem('abotko.fcmToken', token);
      } catch { }

      setNotifEnabled(true);
      toast.success('Notifications enabled');
    } catch (err) {
      console.error('enableNotifications error', err);
      toast.error('Could not enable notifications.');
      setNotifEnabled(false);
    } finally {
      setWorking(false);
    }
  }

  async function disableNotifications(): Promise<void> {
    if (typeof window === 'undefined') return;
    if (!user?.uid) {
      setNotifEnabled(false);
      return;
    }

    setWorking(true);
    try {
      const messaging = getFirebaseMessaging();

      // try to use stored token first
      let token: string | null = null;
      try {
        token = localStorage.getItem('abotko.fcmToken');
      } catch { }
      if (!token && messaging && VAPID_KEY) {
        try {
          token = await getToken(messaging, { vapidKey: VAPID_KEY });
        } catch { }
      }

      // delete on device
      try {
        if (messaging) await deleteToken(messaging);
      } catch (e) {
        console.warn('deleteToken failed, continuing:', e);
      }

      // remove from firestore
      if (token) {
        await updateDoc(doc(firestore, 'users', user.uid), {
          fcmTokens: arrayRemove(token),
          notificationsEnabled: false,
        });
      } else {
        await updateDoc(doc(firestore, 'users', user.uid), {
          notificationsEnabled: false,
        });
      }

      try {
        localStorage.removeItem('abotko.fcmToken');
      } catch { }

      setNotifEnabled(false);
      toast.success('Notifications disabled');
    } catch (err) {
      console.error('disableNotifications error', err);
      toast.error('Could not disable notifications.');
    } finally {
      setWorking(false);
    }
  }

  const onToggleChange = (next: boolean) => {
    if (working) return;
    void (next ? enableNotifications() : disableNotifications());
  };

  return (
    <>
      {offlineBanner}
      <main className="max-w-xl mx-auto p-6 space-y-6">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">Settings</h1>
          <Separator />
        </div>

        <div className="space-y-1">
          <p className="text-sm">
            Logged in as <strong>{user.name ?? 'User'}</strong>
          </p>
          <p className="text-xs text-muted-foreground">{user.email ?? ''}</p>
        </div>
        <section className="rounded-lg border p-4 space-y-3 bg-background">
          {/* Appearance */}
          <section className="rounded-lg border p-4 space-y-3 bg-background">
            <Label className="text-sm font-medium">Appearance</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={currentTheme === 'system' ? 'default' : 'outline'}
                onClick={() => setTheme('system')}
                className="gap-1"
              >
                <Monitor className="w-4 h-4" /> System
              </Button>
              <Button
                type="button"
                size="sm"
                variant={currentTheme === 'light' ? 'default' : 'outline'}
                onClick={() => setTheme('light')}
                className="gap-1"
              >
                <Sun className="w-4 h-4" /> Light
              </Button>
              <Button
                type="button"
                size="sm"
                variant={currentTheme === 'dark' ? 'default' : 'outline'}
                onClick={() => setTheme('dark')}
                className="gap-1"
              >
                <Moon className="w-4 h-4" /> Dark
              </Button>
            </div>
            {mounted && (
              <p className="text-xs text-muted-foreground">
                Active theme:{' '}
                <strong>
                  {currentTheme === 'system' ? `System (${resolvedTheme})` : currentTheme}
                </strong>
              </p>
            )}
          </section>

          {/* Display name */}

          <DisplayNameEditor />

          {/* Default family */}
          <DefaultFamilySelector />

          {/* Notifications */}
          <section className="rounded-lg border p-4 flex items-start justify-between gap-4 bg-background">
            <div className="space-y-1">
              <Label className="text-sm font-medium">Push notifications</Label>
              <p className="text-xs text-muted-foreground">
                Get alerts for today’s deliveries and status updates.
              </p>

              {/* Permission guidance */}
              {notificationsSupported && permission === 'denied' && (
                <p className="text-xs text-red-500 mt-1">
                  Notifications are <strong>blocked</strong> for this site. Please enable them
                  in your browser’s Site Settings, then try again.
                </p>
              )}
              {!notificationsSupported && (
                <p className="text-xs text-red-500 mt-1">
                  Not supported by this browser.
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {working && (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" aria-hidden />
              )}
              <Switch
                checked={notifEnabled}
                onCheckedChange={onToggleChange}
                disabled={working || !notificationsSupported || permission === 'denied'}
                aria-label="Toggle push notifications"
              />
            </div>
          </section>
        </section>

        <Separator />

        <PresenceSettings />
        <Separator />

        <LogoutButton />
      </main>
    </>
  );
}
