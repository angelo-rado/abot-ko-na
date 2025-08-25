// app/(main)/_shells/SwipeShell.tsx
'use client'

import React, { useRef, useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { motion, useMotionValue, animate } from 'framer-motion'
import { HomeIcon, PackageIcon, UsersIcon, SettingsIcon } from 'lucide-react'
import PullToRefresh from '@/app/components/PullToRefresh'

const VAPID_KEY =
  (
    process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ||
    process.env.NEXT_PUBLIC_VAPID_KEY ||
    ''
  )

const EDGE = 24
const STIFF = 220
const DAMP = 30

export default function SwipeShell({ children }: { children: React.ReactNode[] | React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const x = useMotionValue(0)
  const [width, setWidth] = useState(0)

  const nav = [
    { label: 'Home', href: '/home', Icon: HomeIcon },
    { label: 'MyDeliveries', href: '/deliveries', Icon: PackageIcon },
    { label: 'Family', href: '/family', Icon: UsersIcon },
    { label: 'Settings', href: '/settings', Icon: SettingsIcon },
  ]

  const index = (() => {
    const i = nav.findIndex(n => pathname === n.href || pathname.startsWith(n.href + '/'))
    return i === -1 ? 0 : i
  })()

  useEffect(() => {
    const edge = index === 0 ? -EDGE : index === nav.length - 1 ? EDGE : 0
    animate(x, -index * width + edge, { type: 'spring', stiffness: STIFF, damping: DAMP })
  }, [index, width, x, nav.length])

  // Prefetch neighbors & all tabs (best-effort)
  useEffect(() => {
    // @ts-ignore
    const prefetch = (p?: string) => p && router.prefetch?.(p)
    prefetch(nav[index - 1]?.href)
    prefetch(nav[index + 1]?.href)
  }, [index, router, nav])
  useEffect(() => {
    // @ts-ignore
    nav.forEach(n => router.prefetch?.(n.href))
  }, [router, nav])

  // Gesture state
  const modeRef = useRef<'idle' | 'detect' | 'horiz'>('idle')
  const isDragging = useRef(false)
  const startX = useRef<number>(0)
  const startY = useRef<number>(0)
  const lastX = useRef<number>(0)
  const lastT = useRef<number>(0)
  const velRef = useRef(0)
  const baseRef = useRef(0)

  // Pane refs (for per-pane scroll element)
  const paneRefs = React.useRef<Array<HTMLDivElement | null>>([])
  const getPaneScrollEl = (i: number) => () => paneRefs.current[i] as Element | Document | null

  // 🔁 Force a remount on refresh to re-run effects inside the pane
  const [refreshNonce, setRefreshNonce] = React.useState(0)

  // Resize observer
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    onResize()
    window.addEventListener('resize', onResize, { passive: true })
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Swipe handling (unchanged) ...
  // ... (keeping your existing swipe/drag logic intact)

  const panes = React.Children.toArray(children)

  const safeRenderNode = (node: React.ReactNode) => node

  const softRefresh = async () => {
    try { router.refresh() } catch { }
    try { window.dispatchEvent(new CustomEvent('abot-refresh')) } catch { }
    setRefreshNonce((n) => n + 1)
    await new Promise((r) => setTimeout(r, 250))
  }

  const maxIndex = nav.length - 1

  const onEnd = (clientX: number) => {
    const now = performance.now()
    const dt = Math.max(1, now - lastT.current)
    const v = (clientX - lastX.current) / dt
    const raw = (-x.get() + baseRef.current) / width
    let ni = index
    const dist = Math.abs(raw - index)
    const swiped = Math.abs(v) > 0.6 || dist > 0.5
    if (swiped) {
      if (v > 0 && index > 0) ni = index - 1
      else if (v < 0 && index < maxIndex) ni = index + 1
      else {
        if (dist > 0 && index < maxIndex) ni = index + 1
        else if (dist < 0 && index > 0) ni = index - 1
      }
    } else {
      ni = Math.round(raw)
    }
    if (ni !== index) {
      router.push(nav[ni].href, { scroll: false })
      return
    }
    const edge = index === 0 ? -EDGE : index === nav.length - 1 ? EDGE : 0
    animate(x, -index * width + edge, { type: 'spring', stiffness: STIFF, damping: DAMP })
  }

  return (
    <div className="flex flex-col min-h-screen overflow-hidden select-none bg-background text-foreground" style={{ height: '100vh' }}>
      <nav className="fixed top-0 left-0 right-0 h-16 bg-background border-b flex items-center justify-around z-50">
        {nav.map(({ label, href, Icon }, i) => (
          <button
            key={href}
            type="button"
            onClick={() => router.push(href, { scroll: false })}
            className={`flex flex-col items-center gap-1 px-4 py-2 ${i === index ? 'text-foreground' : 'text-muted-foreground'}`}
          >
            <Icon className="w-5 h-5" />
            <span className="text-xs">{label}</span>
          </button>
        ))}
      </nav>

      <div className="pt-16 flex-1 relative">
        <motion.div
          className="absolute inset-0 flex"
          style={{ x, width: width * nav.length }}
          drag="x"
          dragMomentum={false}
          dragConstraints={{ left: -width * (nav.length - 1), right: 0 }}
          onDragStart={(e, info) => {
            isDragging.current = true
            startX.current = info.point.x
            startY.current = info.point.y
            baseRef.current = x.get()
            modeRef.current = 'detect'
            lastX.current = info.point.x
            lastT.current = performance.now()
          }}
          onDrag={(e, info) => {
            const dx = info.point.x - startX.current
            const dy = info.point.y - startY.current
            if (modeRef.current === 'detect') {
              if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
                modeRef.current = 'horiz'
              } else {
                return
              }
            }
            if (modeRef.current === 'horiz') {
              x.set(baseRef.current + dx)
              lastX.current = info.point.x
              lastT.current = performance.now()
            }
          }}
          onDragEnd={(e, info) => {
            isDragging.current = false
            onEnd(info.point.x)
          }}
        >
          {panes.map((node, i) => (
            <div
              key={`pane-${i}`}
              ref={(el) => { paneRefs.current[i] = el }}
              className="h-[calc(100dvh-64px)] w-[100vw] overflow-y-auto"
              id={`pane-${i}`}
            >
              <PullToRefresh
                key={refreshNonce}
                getScrollEl={getPaneScrollEl(i)}
                onRefresh={softRefresh}
                className="min-h-full"
                safetyTimeoutMs={2500}
                minSpinMs={400}
              >
                {safeRenderNode(node)}
              </PullToRefresh>
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  )
}

