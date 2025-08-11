'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
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
    await fetch('/api/save-fcm-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, userId }),
    })
  } catch {}
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

  const viewportWidth = useViewportWidth()
  const x = useMotionValue(0)
  const isDragging = useRef(false)
  const touchStartX = useRef<number | null>(null)
  const lastTouchX = useRef<number | null>(null)
  const lastTouchTime = useRef<number>(0)
  const velocityRef = useRef(0)
  const baseOffsetRef = useRef(0)
  const animationFrame = useRef<number | null>(null)
  const rafRunning = useRef(false)

  const currentIndex = useMemo(() => {
    const idx = navItems.findIndex(
      (item) => pathname === item.href || pathname.startsWith(item.href + '/')
    )
    return idx === -1 ? 0 : idx
  }, [pathname])

  useEffect(() => {
    x.set(-currentIndex * viewportWidth)
  }, [currentIndex, viewportWidth, x])

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) return
      if (isIOSWebKit()) {
        window.dispatchEvent(new CustomEvent('abot-safari-fallback', { detail: { uid: user.uid } }))
      } else {
        setupPushNotifications(user.uid)
      }
    })
    return () => unsub()
  }, [auth])

  async function setupPushNotifications(uid: string) {
    if (!('serviceWorker' in navigator)) return
    try {
      const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js')
      await navigator.serviceWorker.ready
      const messaging = getFirebaseMessaging()
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') return
      const vapidKey =
        'BGh3Isyh15lAQ_GJ19Xwluh4atLY5QbbBt3tl0bnpUt6OkTNonKcm7IwlrmbI_E--IkvB__NYXV6xjbvGIE87iI'
      const token = await getToken(messaging!, { vapidKey })
      if (token) await sendTokenToBackend(token, uid)
    } catch {}
  }

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
      if (rafRunning.current) animationFrame.current = requestAnimationFrame(loop)
    }
    loop()
  }

  function stopRafLoop() {
    if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current)
    rafRunning.current = false
  }

  function onTouchStart(e: React.TouchEvent) {
    isDragging.current = true
    touchStartX.current = e.touches[0].clientX
    lastTouchX.current = e.touches[0].clientX
    lastTouchTime.current = e.timeStamp
    baseOffsetRef.current = x.get()
    velocityRef.current = 0
    startRafLoop()
  }

  function onTouchMove(e: React.TouchEvent) {
    if (!isDragging.current || touchStartX.current === null) return
    const currentX = e.touches[0].clientX
    const now = e.timeStamp
    const dx = currentX - lastTouchX.current!
    const dt = Math.max(1, now - lastTouchTime.current)
    const instVel = (dx / dt) * 1000
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

  function onTouchEnd() {
    isDragging.current = false
    stopRafLoop()
    const offsetX = x.get()
    const vel = velocityRef.current
    const thresholdVelocity = 450
    const thresholdDistance = viewportWidth * 0.22
    const maxIndex = navItems.length - 1
    const rawIndex = -offsetX / viewportWidth
    const rounded = Math.round(rawIndex)
    let newIndex = currentIndex
    if (Math.abs(vel) > thresholdVelocity) {
      if (vel < 0 && currentIndex < maxIndex) newIndex = currentIndex + 1
      if (vel > 0 && currentIndex > 0) newIndex = currentIndex - 1
    } else {
      const distanceFromIndex = rawIndex - currentIndex
      if (Math.abs(distanceFromIndex) > 0.15) {
        if (distanceFromIndex > 0 && currentIndex < maxIndex) newIndex = currentIndex + 1
        else if (distanceFromIndex < 0 && currentIndex > 0) newIndex = currentIndex - 1
        else newIndex = rounded
      } else {
        newIndex = rounded
      }
    }
    router.push(navItems[newIndex].href)
  }

  return (
    <div className="flex flex-col min-h-screen overflow-hidden select-none" style={{ height: '100vh' }}>
      <nav className="fixed top-0 left-0 right-0 h-16 bg-white border-b flex items-center justify-around z-50">
        {navItems.map(({ label, href, Icon }, i) => (
          <button
            key={href}
            onClick={() => router.push(href)}
            className={`flex flex-col items-center text-xs p-2 ${
              i === currentIndex ? 'text-blue-600 font-semibold' : 'text-gray-600'
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
          WebkitOverflowScrolling: 'touch',
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
            ) : (
              <div
                style={{
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'transparent',
                }}
              >
                <div style={{ width: '60%', height: '60%', borderRadius: 12, background: 'rgba(0,0,0,0.04)' }} />
              </div>
            )}
          </div>
        ))}
      </motion.div>
    </div>
  )
}

function useViewportWidth() {
  const [width, setWidth] = useState<number>(() => (typeof window !== 'undefined' ? window.innerWidth : 0))
  useEffect(() => {
    const update = () => setWidth(window.innerWidth)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return width
}
