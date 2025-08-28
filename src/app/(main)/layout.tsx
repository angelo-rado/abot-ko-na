// app/(main)/layout.tsx
'use client'

import React, { useRef, useEffect, useState } from 'react'
import { ThemeProvider } from 'next-themes'
import { usePathname, useRouter } from 'next/navigation'
import { motion, useMotionValue, animate } from 'framer-motion'
import { Bell, HomeIcon, PackageIcon, UsersIcon, SettingsIcon } from 'lucide-react'
import { getAuth, onAuthStateChanged } from 'firebase/auth'
import { getFirebaseMessaging } from '@/lib/firebase'
import { getToken } from 'firebase/messaging'
import PTR from '../components/PullToRefresh'
import { SelectedFamilyProvider } from '@/lib/selected-family'
import { initOutboxProcessor } from '@/lib/offline'
import { toast } from 'sonner'

/** ==== Push config ==== */
const VAPID_KEY =
  (
    process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ||
    process.env.NEXT_PUBLIC_VAPID_KEY ||
    ''
  ).trim() || undefined

/** ==== Small helpers ==== */
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
  // @ts-ignore
  if (React.isValidElement?.(node)) return node as any
  return null
}
function detectModalOpen(): boolean {
  if (typeof document === 'undefined') return false
  return !!document.querySelector(
    [
      '[role="dialog"][data-state="open"]',
      '[role="alertdialog"][data-state="open"]',               
      '[data-radix-portal] [role="dialog"][data-state="open"]',
      '[data-radix-portal] [role="alertdialog"][data-state="open"]', 
      '[data-state="open"][data-side]',
      '[data-radix-portal] [data-state="open"][data-side]',
    ].join(', ')
  )
}

/** ==== Route flash (one-time toast across navigation) ==== */
function RouteFlash() {
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('abot:flash')
      if (!raw) return
      sessionStorage.removeItem('abot:flash')
      const { type, msg } = JSON.parse(raw) as { type?: string; msg?: string }
      if (!msg) return
      import('sonner').then(({ toast }) => {
        if (type === 'error') toast.error(msg)
        else if (type === 'warning') (toast as any).warning?.(msg) ?? toast.message(msg)
        else toast.success(msg)
      })
    } catch { }
  }, [])
  return null
}

/** ==== Standalone shell (no swipe nav) ==== */
function StandaloneShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const softRefresh = async () => {
    try { router.refresh() } catch { }
    await new Promise((r) => setTimeout(r, 250))
  }
  return (
    <div id="main-scroll" className="h-[100dvh] overflow-y-auto overscroll-contain">
      <PTR
        getScrollEl={() => document.getElementById('main-scroll')}
        onRefresh={softRefresh}
        className="min-h-[100dvh]"
        safetyTimeoutMs={2500}
        minSpinMs={400}
      >
        {children}
      </PTR>
    </div>
  )
}

/** ==== Swipe shell (tabs + swipe + PTR per pane) ==== */
function SwipeShell({
  home, deliveries, family, notifications, settings,
}: {
  home: React.ReactNode
  deliveries: React.ReactNode
  family: React.ReactNode
  notifications: React.ReactNode
  settings: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => { try { initOutboxProcessor() } catch { } }, [])

  // outbox toast/status listeners
  useEffect(() => {
    const onStart = (e: any) => { const c = e?.detail?.count ?? 0; if (c) toast(`Syncing ${c} change${c > 1 ? 's' : ''}…`) }
    const onErr = (e: any) => { const msg = e?.detail?.error || 'Sync error'; toast.error(msg) }
    const onDone = () => { toast.success('All offline changes synced') }
    window.addEventListener('abot-sync-start', onStart as any)
    window.addEventListener('abot-sync-error', onErr as any)
    window.addEventListener('abot-sync-done', onDone as any)
    return () => {
      window.removeEventListener('abot-sync-start', onStart as any)
      window.removeEventListener('abot-sync-error', onErr as any)
      window.removeEventListener('abot-sync-done', onDone as any)
    }
  }, [])

  const auth = getAuth()

  // Lock gestures when a modal/sheet is open
  const [uiLocked, setUiLocked] = useState(false)
  useEffect(() => {
    const check = () => setUiLocked(detectModalOpen())
    check()
    const mo = new MutationObserver(check)
    mo.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-state', 'class', 'style'],
    })
    return () => mo.disconnect()
  }, [])

  // Push notifications (non-Safari)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) return
      if (isIOSWebKit()) {
        window.dispatchEvent(new CustomEvent('abot-safari-fallback', { detail: { uid: u.uid } }))
      } else {
        ; (async () => {
          try {
            if (!('serviceWorker' in navigator) || !('Notification' in window) || !VAPID_KEY) return
            const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js')
            await navigator.serviceWorker.ready
            const permission = await Notification.requestPermission()
            if (permission !== 'granted') return
            const messaging = getFirebaseMessaging()
            if (!messaging) return
            const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration })
            if (token) {
              await fetch('/api/save-fcm-token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, userId: u.uid }),
              })
            }
          } catch { }
        })()
      }
    })
    return () => unsub()
  }, [auth])

  const nav = [
    { label: 'Home', href: '/', Icon: HomeIcon, node: home },
    { label: 'MyDeliveries', href: '/deliveries', Icon: PackageIcon, node: deliveries },
    { label: 'Family', href: '/family', Icon: UsersIcon, node: family },
    { label: 'Notifications', href: '/notifications', Icon: Bell, node: notifications },
    { label: 'Settings', href: '/settings', Icon: SettingsIcon, node: settings },
    
  ]

  // Swipe constants (less sensitive)
  const EDGE = 12
  const STIFF = 420
  const DAMP = 38
  const VEL_TH = 1400
  const DIST_TH = 0.35
  const RUBBER = 0.22
  const LOCK_AFTER = 14
  const DIR_RATIO = 1.35

  const width = useViewportWidth()
  const x = useMotionValue(0)

  const index = (() => {
    const i = nav.findIndex(n => pathname === n.href || pathname.startsWith(n.href + '/'))
    return i === -1 ? 0 : i
  })()

  useEffect(() => {
    const edge = index === 0 ? -EDGE : index === nav.length - 1 ? EDGE : 0
    animate(x, -index * width + edge, { type: 'spring', stiffness: STIFF, damping: DAMP })
  }, [index, width, x])

  // Prefetch neighbors & all tabs (best-effort)
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

  // Gesture state
  const modeRef = useRef<'idle' | 'detect' | 'horiz'>('idle')
  const isDragging = useRef(false)
  const startX = useRef<number>(0)
  const startY = useRef<number>(0)
  const lastX = useRef<number>(0)
  const lastT = useRef<number>(0)
  const velRef = useRef(0)
  const baseRef = useRef(0)

  function onTouchStart(e: React.TouchEvent) {
    if (uiLocked) return
    modeRef.current = 'detect'
    isDragging.current = false
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
    lastX.current = startX.current
    lastT.current = e.timeStamp
    baseRef.current = x.get()
    velRef.current = 0
    // @ts-ignore
    router.prefetch?.(nav[index - 1]?.href)
    // @ts-ignore
    router.prefetch?.(nav[index + 1]?.href)
  }

  function onTouchMove(e: React.TouchEvent) {
    if (uiLocked) return
    const cx = e.touches[0].clientX
    const cy = e.touches[0].clientY
    const dxAll = cx - startX.current
    const dyAll = cy - startY.current

    if (modeRef.current === 'detect') {
      const traveled = Math.max(Math.abs(dxAll), Math.abs(dyAll))
      if (traveled < LOCK_AFTER) return
      if (Math.abs(dxAll) > Math.abs(dyAll) * DIR_RATIO) {
        modeRef.current = 'horiz'
        isDragging.current = true
      } else {
        modeRef.current = 'idle' // vertical: let PTR/scroll handle
        return
      }
    }
    if (!isDragging.current) return

    const now = e.timeStamp
    const dx = cx - lastX.current
    const dt = Math.max(1, now - lastT.current)
    const inst = (dx / dt) * 1000
    velRef.current = velRef.current * 0.25 + inst * 0.75
    lastX.current = cx
    lastT.current = now

    const desired = baseRef.current + dxAll
    const max = 60
    const min = -width * (nav.length - 1) - 60
    let next = desired
    if (next > max) next = max + (next - max) * RUBBER
    if (next < min) next = min + (next - min) * RUBBER
    x.set(next)
  }

  function onTouchEnd() {
    if (uiLocked || !isDragging.current) return
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

  // pane refs to drive PTR per pane
  const paneRefs = React.useRef<Array<HTMLDivElement | null>>([])
  const getPaneScrollEl = (i: number) => () => paneRefs.current[i] as Element | Document | null

  const softRefresh = async () => {
    try { router.refresh() } catch { }
    await new Promise((r) => setTimeout(r, 250))
  }

  return (
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
          touchAction: uiLocked ? 'auto' : 'pan-y',
          WebkitOverflowScrolling: 'touch',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {[home, deliveries, family, notifications, settings].map((node, i) => (
          <div
            key={i}
            ref={(el) => { paneRefs.current[i] = el }}
            style={{
              width,
              flexShrink: 0,
              height: '100%',
              overflowY: 'auto',
              overscrollBehaviorY: 'contain',
              WebkitBackfaceVisibility: 'hidden',
              backfaceVisibility: 'hidden',
              transform: 'translateZ(0)',
            }}
          >
            <PTR
              getScrollEl={getPaneScrollEl(i)}
              onRefresh={softRefresh}
              className="min-h-full"
              safetyTimeoutMs={2500}
              minSpinMs={400}
            >
              {safeRenderNode(node)}
            </PTR>
          </div>
        ))}
      </motion.div>
    </div>
  )
}

/** ==== Main layout (hook-stable parent) ==== */
export default function MainLayout({
  children,
  home,
  deliveries,
  family,
  notifications, 
  settings,
}: {
  children: React.ReactNode
  home: React.ReactNode
  deliveries: React.ReactNode
  family: React.ReactNode
  notifications: React.ReactNode
  settings: React.ReactNode
}) {
  const pathname = usePathname()

  useEffect(() => { try { initOutboxProcessor() } catch { } }, [])

  // outbox toast/status listeners
  useEffect(() => {
    const onStart = (e: any) => { const c = e?.detail?.count ?? 0; if (c) toast(`Syncing ${c} change${c > 1 ? 's' : ''}…`) }
    const onErr = (e: any) => { const msg = e?.detail?.error || 'Sync error'; toast.error(msg) }
    const onDone = () => { toast.success('All offline changes synced') }
    window.addEventListener('abot-sync-start', onStart as any)
    window.addEventListener('abot-sync-error', onErr as any)
    window.addEventListener('abot-sync-done', onDone as any)
    return () => {
      window.removeEventListener('abot-sync-start', onStart as any)
      window.removeEventListener('abot-sync-error', onErr as any)
      window.removeEventListener('abot-sync-done', onDone as any)
    }
  }, [])

  const STANDALONE_PREFIXES = ['/family/join', '/login', '/onboarding', '/family/create'] as const
  const isStandalone = STANDALONE_PREFIXES.some((p) => pathname.startsWith(p))

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <SelectedFamilyProvider>
        <RouteFlash />
        {isStandalone ? (
          <StandaloneShell>{children}</StandaloneShell>
        ) : (
          <SwipeShell
            home={home ?? children}
            deliveries={deliveries}
            family={family}
            notifications={notifications}
            settings={settings}
          />
        )}
      </SelectedFamilyProvider>
    </ThemeProvider>
  )
}
