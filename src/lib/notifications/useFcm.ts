'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { getMessaging, getToken, onMessage, isSupported, deleteToken, Messaging } from 'firebase/messaging';
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

async function saveTokenToServer(token: string, userId: string) {
  // Reuse your existing API route that union-adds tokens to users/{uid}.fcmTokens
  await fetch('/api/fcm/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, userId }),
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

      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setStatus('denied');
        return null;
      }

      const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY!;
      if (!vapidKey) {
        console.warn('[FCM] Missing NEXT_PUBLIC_FIREBASE_VAPID_KEY');
      }

      const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: await navigator.serviceWorker.ready });
      if (!token) {
        // Occasionally the browser returns empty token; try to recover once
        await deleteToken(messaging);
        const retry = await getToken(messaging, { vapidKey, serviceWorkerRegistration: await navigator.serviceWorker.ready });
        if (!retry) throw new Error('FCM getToken returned empty twice');
        lastTokenRef.current = retry;
        if (user?.uid) await saveTokenToServer(retry, user.uid);
        setStatus('granted');
        return retry;
      }

      if (token !== lastTokenRef.current) {
        lastTokenRef.current = token;
        if (user?.uid) await saveTokenToServer(token, user.uid);
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
    // Initial token + refresh every 24h (FCM web no longer exposes onTokenRefresh)
    ensureToken();
    const id = window.setInterval(ensureToken, 24 * 60 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [ensureToken]);

  useEffect(() => {
    (async () => {
      if (!(await isSupported())) return;
      const messaging = getMessagingSingleton();
      if (!messaging) return;
      onMessage(messaging, (payload) => {
        // Foreground messages: show a toast / in-app banner
        const title = payload?.notification?.title || payload?.data?.title || 'Abot Ko Na';
        const body = payload?.notification?.body || payload?.data?.body || '';
        // Minimal non-opinionated: browser Notification if permitted; your UI can hook into this event instead.
        if (Notification.permission === 'granted') {
          new Notification(title, { body });
        }
      });
    })();
  }, []);

  return { status, ensureToken };
}
