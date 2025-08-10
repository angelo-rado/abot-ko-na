'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { motion, useMotionValue, animate } from 'framer-motion'
import { getAuth, onAuthStateChanged } from 'firebase/auth'
import { getFirebaseMessaging } from '@/lib/firebase'
import { getToken } from 'firebase/messaging'

import { HomeIcon, PackageIcon, UsersIcon, SettingsIcon } from 'lucide-react'

const navItems = [
  { label: 'Home', href: '/', Icon: HomeIcon },
  { label: 'Deliveries', href: '/deliveries', Icon: PackageIcon },
  { label: 'Family', href: '/family', Icon: UsersIcon },
  { label: 'Settings', href: '/settings', Icon: SettingsIcon },
]

async function sendTokenToBackend(token: string, userId: string) {
  try {
    const response = await fetch('/api/save-fcm-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, userId }),
    })
    if (!response.ok) {
      console.error('Failed to save token')
    } else {
      console.log('Token saved')
    }
  } catch (error) {
    console.error('Error sending token:', error)
  }
}

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const auth = getAuth()
  const userId = auth.currentUser?.uid ?? null

  const [viewportWidth, setViewportWidth] = useState<number | null>(null)

  useEffect(() => {
    console.log('Notification.permission:', Notification.permission)
  }, [])

  useEffect(() => {
    const auth = getAuth();

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        console.log('User signed out');
        return;
      }

      console.log('User signed in:', user.uid);
      setupPushNotificationsForUser(user.uid).catch((err) => {
        console.error('Push setup failed:', err);
      });
    });

    async function setupPushNotificationsForUser(uid: string) {
      if (typeof window === 'undefined') return;
      if (!('serviceWorker' in navigator)) {
        console.log('Service Worker not supported');
        return;
      }

      try {
        console.log('[Push Setup] Step 1: Registering SW...');
        const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        console.log('[Push Setup] Step 1 Success:', registration.scope);

        console.log('[Push Setup] Step 2: Waiting for SW ready...');
        await navigator.serviceWorker.ready;
        console.log('[Push Setup] Step 2 Success: SW ready');

        console.log('[Push Setup] Step 3: Getting Messaging instance...');
        const messaging = getFirebaseMessaging();
        console.log('[Push Setup] Messaging instance:', messaging);

        console.log('[Push Setup] Step 4: Requesting Notification permission...');
        const permission = await Notification.requestPermission();
        console.log('[Push Setup] Permission result:', permission);
        if (permission !== 'granted') return;

        const vapidKey = 'BGh3Isyh15lAQ_GJ19Xwluh4atLY5QbbBt3tl0bnpUt6OkTNonKcm7IwlrmbI_E--IkvB__NYXV6xjbvGIE87iI'
        console.log('[Push Setup] Step 5: Getting FCM token...');
        const token = await getToken(messaging!, {
          vapidKey
        });
        console.log('[Push Setup] Token result:', token);

        if (token) {
          console.log('[Push Setup] Step 6: Sending token to backend...');
          await sendTokenToBackend(token, uid);
          console.log('[Push Setup] Step 6 Success: Token sent');
        } else {
          console.warn('[Push Setup] No FCM token retrieved');
        }
      } catch (error) {
        console.error('[Push Setup] FAILED:', error);
      }
    }

    return () => unsubscribe();
  }, []);


  useEffect(() => {
    function updateWidth() {
      setViewportWidth(window.innerWidth)
    }
    updateWidth()
    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [])

  function findNavIndexByPath(path: string) {
    return navItems.findIndex((item) => path === item.href || path.startsWith(item.href + '/'))
  }
  const currentIndexFromPath = findNavIndexByPath(pathname)
  const safeIndex = currentIndexFromPath === -1 ? 0 : currentIndexFromPath

  const [currentIndex, setCurrentIndex] = useState<number | null>(null)
  const isSyncingFromPath = useRef(false)

  useEffect(() => {
    if (safeIndex !== currentIndex) {
      isSyncingFromPath.current = true
      setCurrentIndex(safeIndex)
    }
  }, [safeIndex])

  useEffect(() => {
    if (currentIndex === null) return
    if (isSyncingFromPath.current) {
      isSyncingFromPath.current = false
      return
    }
    if (currentIndex !== safeIndex) {
      router.push(navItems[currentIndex].href)
    }
  }, [currentIndex, safeIndex, router])

  const x = useMotionValue(0)
  const isDragging = useRef(false)

  useEffect(() => {
    if (!isDragging.current && viewportWidth !== null && currentIndex !== null) {
      animate(x, -currentIndex * viewportWidth, {
        type: 'spring',
        stiffness: 400,
        damping: 35,
      })
    }
  }, [currentIndex, viewportWidth, x])

  const touchStartX = useRef<number | null>(null)
  const touchStartTime = useRef<number>(0)
  const lastTouchX = useRef<number | null>(null)
  const animationFrame = useRef<number | null>(null)

  function setXSmooth(value: number) {
    if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current)
    animationFrame.current = requestAnimationFrame(() => {
      x.set(value)
    })
  }

  function onTouchStart(e: React.TouchEvent) {
    if (viewportWidth === null) return
    isDragging.current = true
    touchStartX.current = e.touches[0].clientX
    lastTouchX.current = e.touches[0].clientX
    touchStartTime.current = e.timeStamp
    if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current)
  }

  function onTouchMove(e: React.TouchEvent) {
    if (viewportWidth === null || touchStartX.current === null) return
    const currentX = e.touches[0].clientX
    const deltaX = currentX - lastTouchX.current!
    lastTouchX.current = currentX

    const currentOffset = x.get()
    let newOffset = currentOffset + deltaX

    const maxOffset = 50
    const minOffset = -viewportWidth * (navItems.length - 1) - 50

    if (newOffset > maxOffset) {
      newOffset = maxOffset + (newOffset - maxOffset) * 0.3
    } else if (newOffset < minOffset) {
      newOffset = minOffset + (newOffset - minOffset) * 0.3
    }

    setXSmooth(newOffset)
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (viewportWidth === null) return
    isDragging.current = false

    const touchDuration = e.timeStamp - touchStartTime.current
    const offsetX = x.get()
    const velocity =
      lastTouchX.current !== null && touchStartX.current !== null
        ? ((lastTouchX.current - touchStartX.current) / touchDuration) * 1000
        : 0

    let newIndex = currentIndex ?? 0

    const velocityThreshold = 500
    const maxIndex = navItems.length - 1

    if (velocity < -velocityThreshold && newIndex < maxIndex) {
      newIndex = Math.min(newIndex + 1, maxIndex)
    } else if (velocity > velocityThreshold && newIndex > 0) {
      newIndex = Math.max(newIndex - 1, 0)
    } else {
      newIndex = Math.min(Math.max(Math.round(-offsetX / viewportWidth), 0), maxIndex)
    }

    setCurrentIndex(newIndex)

    animate(x, -newIndex * viewportWidth, {
      type: 'spring',
      stiffness: 600,
      damping: 45,
      mass: 1,
    })
  }

  // PATCH: Preload adjacent pages
  const [pageCache, setPageCache] = useState<Record<number, React.ReactNode>>({})
  useEffect(() => {
    if (currentIndex !== null) {
      setPageCache((prev) => ({
        ...prev,
        [currentIndex]: children,
      }))
    }
  }, [children, currentIndex])

  if (viewportWidth === null || currentIndex === null) return null

  return (
    <div className="flex flex-col min-h-screen overflow-hidden select-none" style={{ height: '100vh' }}>
      <nav className="fixed top-0 left-0 right-0 h-16 bg-white border-b flex items-center justify-around z-50">
        {navItems.map(({ label, href, Icon }, i) => (
          <button
            key={href}
            onClick={() => setCurrentIndex(i)}
            className={`flex flex-col items-center text-xs p-2 ${i === currentIndex ? 'text-blue-600 font-semibold' : 'text-gray-600'
              }`}
          >
            <Icon className="w-5 h-5 mb-1" />
            {label}
          </button>
        ))}
      </nav>

      <motion.div
        className="flex flex-row pt-16 overflow-x-hidden"
        style={{ width: viewportWidth * navItems.length, x, height: 'calc(100vh - 4rem)' }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {navItems.map(({ href }, i) => (
          <div
            key={href}
            style={{ width: viewportWidth, flexShrink: 0, overflowY: 'auto', height: '100%' }}
          >
            {/* PATCH: Render current + adjacent pages */}
            {pageCache[i] || (i === currentIndex ? children : <div style={{ height: '100%' }} />)}
          </div>
        ))}
      </motion.div>
    </div>
  )
}
