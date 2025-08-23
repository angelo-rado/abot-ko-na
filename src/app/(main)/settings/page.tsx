'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/useAuth';
import { useSelectedFamily } from '@/lib/selected-family';
import { useRouter } from 'next/navigation';
import { Separator } from '@/components/ui/separator';
import PresenceSettings from '@/app/components/PresenceSettings';
import LogoutButton from '@/app/components/LogoutButton';
import { Loader2, Monitor, Sun, Moon, Bell, User as UserIcon, Home as HomeIcon, Palette } from 'lucide-react';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const VAPID_KEY =
  (
    process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ||
    process.env.NEXT_PUBLIC_VAPID_KEY ||
    ''
  ).trim();

export default function SettingsPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { familyId } = useSelectedFamily();
  const isOnline = useOnlineStatus();
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [working, setWorking] = useState(false);
  const [notificationsSupported, setNotificationsSupported] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    setNotificationsSupported(typeof window !== 'undefined' && 'Notification' in window);
    setPermission(typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default');
  }, []);

  useEffect(() => {
    if (!loading && !user?.uid) {
      router.push('/login');
    }
  }, [loading, user?.uid, router]);

  const subscribe = async () => {
    try {
      setWorking(true);
      const messaging = getFirebaseMessaging();
      if (!messaging) throw new Error('Messaging is not available');

      const token = await getToken(messaging, {
        vapidKey: VAPID_KEY || undefined,
      });

      if (!token) throw new Error('Failed to get FCM token');

      await updateDoc(doc(firestore, 'users', user!.uid), {
        fcmTokens: arrayUnion(token),
      });

      toast.success('Notifications enabled');
      setPermission('granted');
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to enable notifications');
    } finally {
      setWorking(false);
    }
  };

  const unsubscribe = async () => {
    try {
      setWorking(true);
      const messaging = getFirebaseMessaging();
      if (!messaging) throw new Error('Messaging is not available');

      const token = await getToken(messaging, {
        vapidKey: VAPID_KEY || undefined,
      });

      if (token) {
        await deleteToken(messaging);
        await updateDoc(doc(firestore, 'users', user!.uid), {
          fcmTokens: arrayRemove(token),
        });
      }

      toast.success('Notifications disabled');
      setPermission('default');
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to disable notifications');
    } finally {
      setWorking(false);
    }
  };

  const offlineBanner = !isOnline ? (
    <div className="w-full bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-100 text-sm py-2 text-center">
      You are offline. Some settings may not save until you reconnect.
    </div>
  ) : null;

  const currentTheme = theme ?? 'system';

  return (
    <>
      {offlineBanner}
      <main className="mx-auto w-full max-w-2xl p-6 space-y-6">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">Settings</h1>
          <Separator />
        </div>

        {/* Account */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-3">
            <div className="rounded-md border p-2">
              <UserIcon className="h-4 w-4" />
            </div>
            <div className="space-y-1">
              <CardTitle>Account</CardTitle>
              <CardDescription>Manage your profile details.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm">
                Logged in as <strong>{user?.name ?? (user as any)?.name ?? 'User'}</strong>
              </p>
              <p className="text-xs text-muted-foreground">{user?.email ?? ''}</p>
            </div>
            <DisplayNameEditor />
          </CardContent>
        </Card>

        {/* Default Family */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-3">
            <div className="rounded-md border p-2">
              <HomeIcon className="h-4 w-4" />
            </div>
            <div className="space-y-1">
              <CardTitle>Default family</CardTitle>
              <CardDescription>
                Used across Home and Deliveries. You can browse other families from their pages without changing this.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <DefaultFamilySelector />
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-3">
            <div className="rounded-md border p-2">
              <Bell className="h-4 w-4" />
            </div>
            <div className="space-y-1">
              <CardTitle>Notifications</CardTitle>
              <CardDescription>Enable push notifications for delivery updates and presence changes.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Push notifications</Label>
              <div className="flex items-center gap-2">
                {working && <Loader2 className="w-4 h-4 animate-spin" />}
                <Switch
                  checked={permission === 'granted'}
                  onCheckedChange={(v) => (v ? subscribe() : unsubscribe())}
                  disabled={working || !notificationsSupported || permission === 'denied'}
                  aria-label="Toggle push notifications"
                />
              </div>
            </div>
            {!notificationsSupported && (
              <p className="text-xs text-muted-foreground">
                This browser doesn’t support notifications.
              </p>
            )}
            {permission === 'denied' && (
              <p className="text-xs text-muted-foreground">
                Notifications are blocked in your browser. Allow them in site settings and try again.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Presence */}
        <Card>
          <CardHeader>
            <CardTitle>Presence</CardTitle>
            <CardDescription>Control how your “home/away” status is set.</CardDescription>
          </CardHeader>
          <CardContent>
            <PresenceSettings />
          </CardContent>
        </Card>

        {/* Appearance */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-3">
            <div className="rounded-md border p-2">
              <Palette className="h-4 w-4" />
            </div>
            <div className="space-y-1">
              <CardTitle>Appearance</CardTitle>
              <CardDescription>Choose your theme preference.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
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
          </CardContent>
        </Card>

        {/* Session */}
        <Card>
          <CardHeader>
            <CardTitle>Session</CardTitle>
            <CardDescription>Sign out from this device.</CardDescription>
          </CardHeader>
          <CardContent>
            <LogoutButton />
          </CardContent>
        </Card>
      </main>
    </>
  );
}

