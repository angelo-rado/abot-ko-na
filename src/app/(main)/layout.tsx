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

function isIOS() {
  if (typeof navigator === 'undefined') return false
  return /iP(ad|hone|od)/i.test(navigator.userAgent) && !('MSStream' in window)
}

function isIOSWebKit() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /iP(ad|hone|od)/i.test(ua) && /WebKit/i.test(ua)
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
      if (isIOSWebKit()) {
        try {
          const evt = new CustomEvent('abot-safari-fallback', { detail: { uid: user.uid } })
          window.dispatchEvent(evt)
        } catch (e) {}
      } else {
        setupPushNotificationsForUser(user.uid).catch((err) => {
          console.error('Push setup failed:', err);
        });
      }
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
        stiffness: 420,
        damping: 40,
      })
    }
  }, [currentIndex, viewportWidth, x])

  const touchStartX = useRef<number | null>(null)
  const touchStartTime = useRef<number>(0)
  const lastTouchX = useRef<number | null>(null)
  const lastTouchTime = useRef<number>(0)
  const velocityRef = useRef(0)
  const baseOffsetRef = useRef(0)
  const animationFrame = useRef<number | null>(null)
  const rafRunning = useRef(false)

  function setXSmooth(value: number) {
    if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current)
    animationFrame.current = requestAnimationFrame(() => {
      x.set(value)
    })
  }

  function startRafLoop() {
    if (rafRunning.current) return
    rafRunning.current = true
    const loop = () => {
      rafRunning.current && (animationFrame.current = requestAnimationFrame(loop))
    }
    loop()
  }

  function stopRafLoop() {
    if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current)
    rafRunning.current = false
  }

  function onTouchStart(e: React.TouchEvent) {
    if (viewportWidth === null) return
    isDragging.current = true
    touchStartX.current = e.touches[0].clientX
    lastTouchX.current = e.touches[0].clientX
    touchStartTime.current = e.timeStamp
    lastTouchTime.current = e.timeStamp
    baseOffsetRef.current = x.get()
    velocityRef.current = 0
    startRafLoop()
  }

  function onTouchMove(e: React.TouchEvent) {
    if (!isDragging.current || viewportWidth === null || touchStartX.current === null) return
    const currentX = e.touches[0].clientX
    const now = e.timeStamp
    const dx = currentX - lastTouchX.current!
    const dt = Math.max(1, now - lastTouchTime.current)
    const instVel = dx / dt * 1000
    velocityRef.current = velocityRef.current * 0.2 + instVel * 0.8
    lastTouchX.current = currentX
    lastTouchTime.current = now

    const desired = baseOffsetRef.current + (currentX - touchStartX.current)
    const max = 50
    const min = -viewportWidth * (navItems.length - 1) - 50
    let newOffset = desired
    if (newOffset > max) newOffset = max + (newOffset - max) * 0.25
    if (newOffset < min) newOffset = min + (newOffset - min) * 0.25
    setXSmooth(newOffset)
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (viewportWidth === null) return
    isDragging.current = false
    stopRafLoop()

    const offsetX = x.get()
    const vel = velocityRef.current
    const thresholdVelocity = 450
    const thresholdDistance = viewportWidth ? viewportWidth * 0.22 : 72
    let newIndex = currentIndex ?? 0
    const maxIndex = navItems.length - 1

    const rawIndex = -offsetX / viewportWidth
    const rounded = Math.round(rawIndex)

    if (Math.abs(vel) > thresholdVelocity) {
      if (vel < 0 && newIndex < maxIndex) {
        newIndex = Math.min(newIndex + 1, maxIndex)
      } else if (vel > 0 && newIndex > 0) {
        newIndex = Math.max(newIndex - 1, 0)
      }
    } else {
      const distanceFromIndex = rawIndex - (currentIndex ?? 0)
      if (Math.abs(distanceFromIndex) > 0.15) {
        if (distanceFromIndex > 0 && (currentIndex ?? 0) < maxIndex) {
          newIndex = Math.min((currentIndex ?? 0) + 1, maxIndex)
        } else if (distanceFromIndex < 0 && (currentIndex ?? 0) > 0) {
          newIndex = Math.max((currentIndex ?? 0) - 1, 0)
        } else {
          newIndex = rounded
        }
      } else {
        newIndex = rounded
      }
    }

    setCurrentIndex(newIndex)

    animate(x, -newIndex * viewportWidth, {
      type: 'spring',
      stiffness: 700,
      damping: 48,
      mass: 1,
    })
  }

  useEffect(() => {
    if (currentIndex !== null && viewportWidth !== null) {
      x.set(-currentIndex * viewportWidth)
    }
  }, [viewportWidth])

  // preload full HTML for all pages so peeking shows real content
  const [pageCache, setPageCache] = useState<Record<number, { html?: string, fetched?: boolean }>>({})
  useEffect(() => {
    // prefetch all pages once on mount (non-blocking)
    navItems.forEach((item, idx) => {
      if (!pageCache[idx]) {
        fetch(item.href, { credentials: 'include' })
          .then(res => res.text())
          .then(html => {
            setPageCache(prev => ({ ...prev, [idx]: { html, fetched: true } }))
          })
          .catch(() => {
            setPageCache(prev => ({ ...prev, [idx]: { fetched: false } }))
          })
      }
    })
    // ensure currentIndex is initialized to safeIndex if null
    if (currentIndex === null) {
      setCurrentIndex(safeIndex)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ensure children for current index stays in cache (helps when navigating back)
  useEffect(() => {
    if (currentIndex !== null) {
      setPageCache(prev => ({ ...prev, [currentIndex]: { ...prev[currentIndex], fetched: true } }))
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
        className="relative flex flex-row pt-16 overflow-hidden"
        style={{
          width: viewportWidth * navItems.length,
          x,
          height: 'calc(100vh - 4rem)',
          touchAction: 'pan-y',
          WebkitOverflowScrolling: 'touch'
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {navItems.map(({ href }, i) => (
          <div
            key={href}
            style={{
              width: viewportWidth,
              flexShrink: 0,
              overflowY: 'auto',
              height: '100%',
              willChange: 'transform, opacity',
              WebkitBackfaceVisibility: 'hidden',
              backfaceVisibility: 'hidden',
              transform: 'translateZ(0)',
            }}
          >
            {i === currentIndex ? (
              <div style={{ height: '100%' }}>{children}</div>
            ) : pageCache[i]?.html ? (
              <div style={{ height: '100%' }} dangerouslySetInnerHTML={{ __html: pageCache[i]!.html || '' }} />
            ) : (
              <div style={{ height: '100%' }} />
            )}
          </div>
        ))}
      </motion.div>
    </div>
  )
}
