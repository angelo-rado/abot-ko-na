'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { Loader2 } from 'lucide-react'

type Props = {
  children: React.ReactNode
  onRefresh?: () => Promise<void> | void
  threshold?: number
  maxPull?: number
  lockAfter?: number
  getScrollEl?: () => Element | Document | null
  className?: string
  safetyTimeoutMs?: number
  minSpinMs?: number
}

type Mode = 'idle' | 'detect' | 'pull' | 'horiz' | 'refreshing'

function anyModalOpen() {
  if (typeof document === 'undefined') return false
  // Radix Dialog/AlertDialog/Sheet/Drawer content all carry data-state="open"
  return !!document.querySelector(
    [
      '[role="dialog"][data-state="open"]',
      '[data-radix-portal] [role="dialog"][data-state="open"]',
      // Radix Sheet/Drawer (content has data-side)
      '[data-state="open"][data-side]',
      '[data-radix-portal] [data-state="open"][data-side]',
    ].join(', ')
  )
}

export default function PullToRefresh({
  children,
  onRefresh,
  threshold = 72,
  maxPull = 120,
  lockAfter = 12,
  getScrollEl,
  className = '',
  safetyTimeoutMs = 2500,
  minSpinMs = 400,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const startX = useRef(0)
  const startY = useRef(0)
  const modeRef = useRef<Mode>('idle')
  const scrollEl = useRef<Element | Document | null>(null)

  const [pullPx, setPullPx] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  // non-stale refs
  const pullPxRef = useRef(0)
  const setPull = (v: number) => { pullPxRef.current = v; setPullPx(v) }

  const setScrollEl = useCallback((target: EventTarget | null) => {
    const explicit = getScrollEl?.()
    if (explicit) { scrollEl.current = explicit; return }
    let el: Element | null = (target as Element) ?? null
    const isScrollable = (e: Element) => {
      const s = getComputedStyle(e)
      return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight
    }
    while (el) { if (isScrollable(el)) { scrollEl.current = el; return }; el = el.parentElement }
    scrollEl.current = document
  }, [getScrollEl])

  const atTop = () => {
    const el = scrollEl.current
    if (!el) return true
    if (el instanceof Document) {
      const se = el.scrollingElement || document.documentElement
      return (se?.scrollTop ?? 0) <= 0
    }
    if (el instanceof HTMLElement) return el.scrollTop <= 0
    return true
  }

  const isInteractive = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false
    return !!target.closest('input, textarea, select, button, a, [contenteditable="true"], [data-no-ptr="true"]')
  }

  const hardReset = useCallback(() => {
    modeRef.current = 'idle'
    setPull(0)
    setRefreshing(false)
  }, [])

  const doRefresh = useCallback(async () => {
    const t0 = performance.now()
    const user = (async () => { await onRefresh?.() })()
    const safety = new Promise<void>((res) => setTimeout(res, safetyTimeoutMs))
    try {
      await Promise.race([user, safety])
      const elapsed = performance.now() - t0
      if (elapsed < minSpinMs) await new Promise(r => setTimeout(r, minSpinMs - elapsed))
    } catch {}
    finally {
      setPull(0)
      setTimeout(hardReset, 180)
    }
  }, [onRefresh, safetyTimeoutMs, minSpinMs, hardReset])

  const dampen = (dy: number) => Math.min(maxPull, dy * 0.6)

  useEffect(() => {
    const root = wrapRef.current
    if (!root) return
    let active = false

    const onTouchStart = (e: TouchEvent) => {
      if (refreshing) return
      if (anyModalOpen()) return            // 🚫 ignore when modal/sheet is open
      if (e.touches.length !== 1) return
      if (isInteractive(e.target)) return
      setScrollEl(e.target)
      if (!atTop()) { modeRef.current = 'idle'; return }
      const t = e.touches[0]
      startX.current = t.clientX
      startY.current = t.clientY
      modeRef.current = 'detect'
      active = true
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!active || refreshing) return
      const t = e.touches[0]
      const dx = t.clientX - startX.current
      const dy = t.clientY - startY.current

      if (modeRef.current === 'detect') {
        const moved = Math.abs(dx) >= lockAfter || Math.abs(dy) >= lockAfter
        if (!moved) return
        if (dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.25 && atTop()) {
          modeRef.current = 'pull'
        } else {
          modeRef.current = 'horiz'
          return
        }
      }

      if (modeRef.current !== 'pull') return
      if (!atTop()) { hardReset(); active = false; return }

      const damped = dampen(dy)
      if (e.cancelable) {
        e.preventDefault()   // stop native rubber-band
        e.stopPropagation()  // don't bubble to swipe container
      }
      setPull(damped)
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (!active || refreshing) return
      active = false
      if (modeRef.current !== 'pull') { hardReset(); return }
      if (e.cancelable) e.stopPropagation()
      if (pullPxRef.current >= threshold) {
        modeRef.current = 'refreshing'
        setRefreshing(true)
        setPull(threshold)
        void doRefresh()
      } else {
        hardReset()
      }
    }

    const onTouchCancel = () => { active = false; hardReset() }

    root.addEventListener('touchstart', onTouchStart, { passive: true })
    root.addEventListener('touchmove', onTouchMove, { passive: false })
    root.addEventListener('touchend', onTouchEnd, { passive: true })
    root.addEventListener('touchcancel', onTouchCancel, { passive: true })
    return () => {
      root.removeEventListener('touchstart', onTouchStart as any)
      root.removeEventListener('touchmove', onTouchMove as any)
      root.removeEventListener('touchend', onTouchEnd as any)
      root.removeEventListener('touchcancel', onTouchCancel as any)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doRefresh, hardReset, lockAfter, maxPull, setScrollEl, threshold])

  return (
    <div
      ref={wrapRef}
      className={`relative ${className}`}
      style={{ touchAction: 'manipulation', overscrollBehaviorY: 'contain' } as React.CSSProperties}
    >
      {/* Indicator */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-20 flex h-12 items-center justify-center"
        style={{
          opacity: pullPx > 2 || refreshing ? 1 : 0,
          transform: `translateY(${Math.min(pullPx, threshold)}px)`,
          transition: refreshing
            ? 'transform 150ms ease'
            : 'transform 180ms cubic-bezier(.2,.7,.3,1), opacity 120ms ease',
        }}
      >
        <div className="flex items-center gap-2 rounded-full bg-muted/70 px-3 py-1 text-xs backdrop-blur">
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Loader2 className={`h-4 w-4 ${pullPx >= threshold ? '' : 'animate-spin-slow'}`} />}
          <span>{refreshing ? 'Refreshing…' : pullPx >= threshold ? 'Release to refresh' : 'Pull to refresh'}</span>
        </div>
      </div>

      {/* Content translates with pull */}
      <div
        style={{
          transform: `translateY(${pullPx}px)`,
          transition: refreshing ? 'transform 150ms ease' : 'transform 180ms cubic-bezier(.2,.7,.3,1)',
          willChange: 'transform',
        }}
      >
        {children}
      </div>
    </div>
  )
}
// .animate-spin-slow { animation: spin 1.2s linear infinite; }
