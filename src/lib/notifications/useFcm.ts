'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { getMessaging, getToken, onMessage, isSupported, deleteToken, Messaging } from 'firebase/messaging';
import type { User } from 'firebase/auth';
import { useAuth } from '@/lib/useAuth';

type Status = 'idle' | 'checking' | 'granted' | 'denied' | 'unsupported' | 'error';

let messagingSingleton: Messaging | null = null;

function getMessagingSingleton() {
  if (messagingSingleton) return messagingSingleton;
  if (typeof window === 'undefined') return null;
  if (!getApps().length) {
    initializeApp({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
    });
  }
  messagingSingleton = getMessaging();
  return messagingSingleton;
}

async function getOrRegisterFcmSW(): Promise<ServiceWorkerRegistration> {
  // Ensure our dedicated SW exists; fallback to registering it
  const existing = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
  if (existing) return existing;
  return navigator.serviceWorker.register('/firebase-messaging-sw.js');
}

async function saveTokenToServer(token: string, user: User) {
  const idToken = await user.getIdToken();
  await fetch('/api/fcm/save', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ token, userId: user.uid }),
  });
}

export function useFcm() {
  const { user } = useAuth();
  const [status, setStatus] = useState<Status>('idle');
  const lastTokenRef = useRef<string | null>(null);

  const ensureToken = useCallback(async () => {
    try {
      setStatus('checking');

      if (!(await isSupported())) {
        setStatus('unsupported');
        return null;
      }
      const messaging = getMessagingSingleton();
      if (!messaging) {
        setStatus('unsupported');
        return null;
      }

      // Ensure our SW is registered and ready
      const swReg = await getOrRegisterFcmSW();

      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        // If previously had a token, attempt cleanup
        if (lastTokenRef.current) {
          try { await deleteToken(messaging); } catch {}
          lastTokenRef.current = null;
        }
        setStatus('denied');
        return null;
      }

      const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY!;
      if (!vapidKey) {
        console.warn('[FCM] Missing NEXT_PUBLIC_FIREBASE_VAPID_KEY');
      }

      // Primary token attempt
      let token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: swReg });

      // Occasionally returns empty; retry once after a delete
      if (!token) {
        try { await deleteToken(messaging); } catch {}
        token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: swReg });
        if (!token) throw new Error('FCM getToken returned empty twice');
      }

      // Save to server if changed
      if (token !== lastTokenRef.current) {
        lastTokenRef.current = token;
        if (user?.uid) await saveTokenToServer(token, user as User);
      }

      setStatus('granted');
      return token;
    } catch (e) {
      console.error('[FCM] ensureToken error', e);
      setStatus('error');
      return null;
    }
  }, [user?.uid]);

  useEffect(() => {
    // Initial token + refresh every 24h
    ensureToken();
    const id = window.setInterval(ensureToken, 24 * 60 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [ensureToken]);

  useEffect(() => {
    // Foreground message handler (data-only)
    (async () => {
      if (!(await isSupported())) return;
      const messaging = getMessagingSingleton();
      if (!messaging) return;
      onMessage(messaging, (payload) => {
        const d = (payload as any).data || {};
        const title = d.title || 'Abot Ko Na';
        const body = d.body || '';
        if (Notification.permission === 'granted') {
          // Lightweight foreground toast via Notification API; app can hook here for custom UI
          new Notification(title, { body });
        }
      });
    })();
  }, []);

  // Optional: if the tab regains focus and permission flipped, re-check
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') ensureToken();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [ensureToken]);

  return { status, ensureToken };
}
