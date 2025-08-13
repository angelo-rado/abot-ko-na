// app/(main)/layout.tsx
'use client'

import React, { useEffect, useMemo, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { motion, useMotionValue, animate } from 'framer-motion'
import { getAuth, onAuthStateChanged } from 'firebase/auth'
import { getFirebaseMessaging } from '@/lib/firebase'
import { getToken } from 'firebase/messaging'
import { HomeIcon, PackageIcon, UsersIcon, SettingsIcon } from 'lucide-react'
import { ThemeProvider } from 'next-themes'

const VAPID_KEY =
  (
    process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ||
    process.env.NEXT_PUBLIC_VAPID_KEY ||
    ''
  ).trim() || undefined

export default function MainLayout({
  children,
  home,
  deliveries,
  family,
  settings,
}: {
  children: React.ReactNode
  home: React.ReactNode
  deliveries: React.ReactNode
  family: React.ReactNode
  settings: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const auth = getAuth()

  // ⛔️ Bypass the swipe layout on public/standalone routes
  const STANDALONE_PREFIXES = useMemo(
    () => ['/family/join', '/login', '/onboarding', '/family/create'],
    []
  )
  const isStandalone = useMemo(
    () => STANDALONE_PREFIXES.some((p) => pathname.startsWith(p)),
    [pathname, STANDALONE_PREFIXES]
  )

  if (isStandalone) {
    return (
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <div className="min-h-screen bg-background text-foreground">
          {children}
        </div>
      </ThemeProvider>
    )
  }

  // --- existing swipe-nav layout below unchanged ---
  const nav = [
    { label: 'Home', href: '/', Icon: HomeIcon, node: home ?? children },
    { label: 'Deliveries', href: '/deliveries', Icon: PackageIcon, node: deliveries },
    { label: 'Family', href: '/family', Icon: UsersIcon, node: family },
    { label: 'Settings', href: '/settings', Icon: SettingsIcon, node: settings },
  ]

  const width = useViewportWidth()
  const x = useMotionValue(0)
  const isDragging = useRef(false)
  const startX = useRef<number | null>(null)
  const lastX = useRef<number | null>(null)
  const lastT = useRef<number>(0)
  const velRef = useRef(0)
  const baseRef = useRef(0)

  const EDGE = 16
  const STIFF = 420
  const DAMP = 36
  const VEL_TH = 650
  const DIST_TH = 0.18
  const RUBBER = 0.25

  const index = useMemo(() => {
    const i = nav.findIndex(n => pathname === n.href || pathname.startsWith(n.href + '/'))
    return i === -1 ? 0 : i
  }, [pathname])

  useEffect(() => {
    const edge = index === 0 ? -EDGE : index === nav.length - 1 ? EDGE : 0
    animate(x, -index * width + edge, { type: 'spring', stiffness: STIFF, damping: DAMP })
  }, [index, width, x])

  useEffect(() => {
    // @ts-ignore
    const prefetch = (p?: string) => p && router.prefetch?.(p)
    prefetch(nav[index - 1]?.href)
    prefetch(nav[index + 1]?.href)
  }, [index, router])
  useEffect(() => {
    // @ts-ignore
    nav.forEach(n => router.prefetch?.(n.href))
  }, [router])

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) return
      if (isIOSWebKit()) {
        window.dispatchEvent(new CustomEvent('abot-safari-fallback', { detail: { uid: u.uid } }))
      } else {
        setupPushNotifications(u.uid).catch(() => {})
      }
    })
    return () => unsub()
  }, [auth])

  async function setupPushNotifications(uid: string) {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('Notification' in window)) return
    if (!VAPID_KEY) return
    try {
      const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js')
      await navigator.serviceWorker.ready
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') return
      const messaging = getFirebaseMessaging()
      if (!messaging) return
      const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration })
      if (token) await sendTokenToBackend(token, uid)
    } catch {}
  }

  function onTouchStart(e: React.TouchEvent) {
    isDragging.current = true
    startX.current = e.touches[0].clientX
    lastX.current = e.touches[0].clientX
    lastT.current = e.timeStamp
    baseRef.current = x.get()
    velRef.current = 0
    // @ts-ignore
    router.prefetch?.(nav[index - 1]?.href)
    // @ts-ignore
    router.prefetch?.(nav[index + 1]?.href)
  }

  function onTouchMove(e: React.TouchEvent) {
    if (!isDragging.current || startX.current === null) return
    const cx = e.touches[0].clientX
    const now = e.timeStamp
    const dx = cx - (lastX.current as number)
    const dt = Math.max(1, now - lastT.current)
    const inst = (dx / dt) * 1000
    velRef.current = velRef.current * 0.2 + inst * 0.8
    lastX.current = cx
    lastT.current = now
    const desired = baseRef.current + (cx - startX.current)
    const max = 60
    const min = -width * (nav.length - 1) - 60
    let next = desired
    if (next > max) next = max + (next - max) * RUBBER
    if (next < min) next = min + (next - min) * RUBBER
    x.set(next)
  }

  function onTouchEnd() {
    isDragging.current = false
    const offsetX = x.get()
    const raw = -offsetX / width
    const vel = velRef.current
    const maxIndex = nav.length - 1
    let ni = index
    if (Math.abs(vel) > VEL_TH) {
      if (vel < 0 && index < maxIndex) ni = index + 1
      if (vel > 0 && index > 0) ni = index - 1
    } else {
      const dist = raw - index
      if (Math.abs(dist) > DIST_TH) {
        if (dist > 0 && index < maxIndex) ni = index + 1
        else if (dist < 0 && index > 0) ni = index - 1
      } else {
        ni = Math.round(raw)
      }
    }
    if (ni !== index) {
      router.push(nav[ni].href, { scroll: false })
      return
    }
    const edge = index === 0 ? -EDGE : index === nav.length - 1 ? EDGE : 0
    animate(x, -index * width + edge, { type: 'spring', stiffness: STIFF, damping: DAMP })
  }

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <div className="flex flex-col min-h-screen overflow-hidden select-none bg-background text-foreground" style={{ height: '100vh' }}>
        <nav className="fixed top-0 left-0 right-0 h-16 bg-background border-b flex items-center justify-around z-50">
          {nav.map(({ label, href, Icon }, i) => (
            <button
              key={href}
              type="button"
              onClick={() => router.push(href, { scroll: false })}
              className={`flex flex-col items-center text-xs p-2 ${i === index ? 'text-primary font-semibold' : 'text-muted-foreground'}`}
              aria-current={i === index ? 'page' : undefined}
            >
              <Icon className="w-5 h-5 mb-1" />
              {label}
            </button>
          ))}
        </nav>

        <motion.div
          className="relative flex flex-row pt-16 overflow-hidden"
          style={{
            width: width * nav.length,
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
          {[home ?? children, deliveries, family, settings].map((node, i) => (
            <div
              key={i}
              style={{
                width: width,
                flexShrink: 0,
                height: '100%',
                overflowY: 'auto',
                willChange: 'transform, opacity',
                WebkitBackfaceVisibility: 'hidden',
                backfaceVisibility: 'hidden',
                transform: 'translateZ(0)',
              }}
            >
              {safeRenderNode(node)}
            </div>
          ))}
        </motion.div>
      </div>
    </ThemeProvider>
  )
}

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

function useViewportWidth() {
  const [w, setW] = React.useState<number>(() => (typeof window !== 'undefined' ? window.innerWidth : 0))
  React.useEffect(() => {
    const onR = () => setW(window.innerWidth)
    onR()
    window.addEventListener('resize', onR)
    return () => window.removeEventListener('resize', onR)
  }, [])
  return w
}

function safeRenderNode(node: React.ReactNode): React.ReactNode {
  if (node == null) return null
  if (typeof node === 'string' || typeof node === 'number') return node
  if (Array.isArray(node)) return <>{node as any}</>
  // @ts-ignore – React is already imported in this file
  if (React.isValidElement?.(node)) return node as any
  // Fallback: avoid rendering plain objects (e.g., module exports)
  return null
}