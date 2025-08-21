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
}

type Mode = 'idle' | 'detect' | 'pull' | 'horiz' | 'refreshing'

export default function PullToRefresh({
  children,
  onRefresh,
  threshold = 72,
  maxPull = 120,
  lockAfter = 10,
  getScrollEl,
  className = '',
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const startX = useRef(0)
  const startY = useRef(0)
  const mode = useRef<Mode>('idle')
  const scrollEl = useRef<Element | Document | null>(null)
  const [pullPx, setPullPx] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

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

  const reset = useCallback(() => {
    mode.current = 'idle'
    setPullPx(0)
  }, [])

  const doRefresh = useCallback(async () => {
    if (!onRefresh) return
    try {
      mode.current = 'refreshing'
      setRefreshing(true)
      try { navigator.vibrate?.(15) } catch {}
      await onRefresh()
    } finally {
      setRefreshing(false)
      reset()
    }
  }, [onRefresh, reset])

  const dampen = (dy: number) => Math.min(maxPull, dy * 0.6)

  useEffect(() => {
    const root = wrapRef.current
    if (!root) return
    let active = false

    const onTouchStart = (e: TouchEvent) => {
      if (refreshing) return
      if (e.touches.length !== 1) return
      if (isInteractive(e.target)) return
      setScrollEl(e.target)
      if (!atTop()) { mode.current = 'idle'; return }
      const t = e.touches[0]
      startX.current = t.clientX
      startY.current = t.clientY
      mode.current = 'detect'
      active = true
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!active || refreshing) return
      const t = e.touches[0]
      const dx = t.clientX - startX.current
      const dy = t.clientY - startY.current

      if (mode.current === 'detect') {
        const moved = Math.abs(dx) >= lockAfter || Math.abs(dy) >= lockAfter
        if (!moved) return
        if (dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.15 && atTop()) {
          mode.current = 'pull'
        } else {
          mode.current = 'horiz'
          return
        }
      }

      if (mode.current !== 'pull') return

      if (!atTop()) { reset(); active = false; return }

      const damped = dampen(dy)
      if (e.cancelable) {
        e.preventDefault()      // stop native rubber-band
        e.stopPropagation()     // stop swipe parent
      }
      setPullPx(damped)
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (!active || refreshing) return
      if (mode.current === 'pull') {
        e.stopPropagation()
      }
      active = false
      if (mode.current !== 'pull') { reset(); return }
      if (pullPx >= threshold) { setPullPx(threshold); void doRefresh() } else { reset() }
    }

    const onTouchCancel = () => { active = false; if (!refreshing) reset() }

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
  }, [doRefresh, lockAfter, maxPull, refreshing, setScrollEl, threshold, reset, pullPx])

  return (
    <div
      ref={wrapRef}
      className={`relative ${className}`}
      style={{ touchAction: 'manipulation', overscrollBehaviorY: 'contain' } as React.CSSProperties}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-20 flex h-12 items-center justify-center"
        style={{
          opacity: pullPx > 2 || refreshing ? 1 : 0,
          transform: `translateY(${Math.min(pullPx, threshold)}px)`,
          transition: refreshing ? 'transform 150ms ease' : 'opacity 150ms ease',
        }}
      >
        <div className="flex items-center gap-2 rounded-full bg-muted/70 px-3 py-1 text-xs backdrop-blur">
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Loader2 className={`h-4 w-4 ${pullPx >= threshold ? '' : 'animate-spin-slow'}`} />}
          <span>{refreshing ? 'Refreshing…' : pullPx >= threshold ? 'Release to refresh' : 'Pull to refresh'}</span>
        </div>
      </div>

      <div
        style={{
          transform: `translateY(${pullPx}px)`,
          transition: refreshing ? 'transform 150ms ease' : undefined,
          willChange: 'transform',
        }}
      >
        {children}
      </div>
    </div>
  )
}
