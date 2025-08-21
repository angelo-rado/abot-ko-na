'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { Loader2 } from 'lucide-react'

type Props = {
  children: React.ReactNode
  onRefresh?: () => Promise<void> | void
  /** px to pull before triggering refresh */
  threshold?: number
  /** max visual pull distance */
  maxPull?: number
  /** lock direction after this many px of movement */
  lockAfter?: number
  /** return the scrolling element; can be Element or Document */
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
  const startX = useRef<number>(0)
  const startY = useRef<number>(0)
  const mode = useRef<Mode>('idle')
  const pointerId = useRef<number | null>(null)
  const scrollEl = useRef<Element | Document | null>(null)

  const [pullPx, setPullPx] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  const resolveScrollEl = useCallback(() => {
    const el =
      getScrollEl?.() ??
      document.scrollingElement ?? // Element | null
      document.documentElement // Element
    scrollEl.current = el || document // Element | Document
  }, [getScrollEl])

  useEffect(() => {
    resolveScrollEl()
  }, [resolveScrollEl])

  const atTop = () => {
    const el = scrollEl.current
    if (!el) return true
    if (el instanceof Document) {
      const se = el.scrollingElement || document.documentElement
      return (se?.scrollTop ?? 0) <= 0
    }
    if (el instanceof HTMLElement) {
      return el.scrollTop <= 0
    }
    // If not an HTMLElement (e.g., SVGElement), treat as top to avoid blocking
    return true
  }

  const isInteractive = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false
    return !!target.closest('input, textarea, select, button, a, [contenteditable="true"], [data-no-ptr="true"]')
  }

  const reset = useCallback(() => {
    mode.current = 'idle'
    pointerId.current = null
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

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (refreshing) return
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return
    if (isInteractive(e.target)) return
    resolveScrollEl()
    if (!atTop()) {
      mode.current = 'idle'
      return
    }
    pointerId.current = e.pointerId
    startX.current = e.clientX
    startY.current = e.clientY
    mode.current = 'detect'
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (refreshing) return
    if (pointerId.current == null || e.pointerId !== pointerId.current) return
    if (mode.current === 'idle' || mode.current === 'horiz') return

    const dx = e.clientX - startX.current
    const dy = e.clientY - startY.current

    if (mode.current === 'detect') {
      if (Math.abs(dx) >= lockAfter || Math.abs(dy) >= lockAfter) {
        if (dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.15 && atTop()) {
          mode.current = 'pull'
        } else {
          mode.current = 'horiz'
          return
        }
      } else {
        return
      }
    }

    if (mode.current !== 'pull') return
    if (!atTop()) {
      reset()
      return
    }

    const damped = dampen(dy)
    if (e.cancelable) e.preventDefault()
    setPullPx(damped)
  }

  const onPointerUp = () => {
    if (refreshing) return
    if (mode.current !== 'pull') {
      reset()
      return
    }
    if (pullPx >= threshold) {
      setPullPx(threshold)
      doRefresh()
    } else {
      reset()
    }
  }

  const onPointerCancel = () => {
    if (refreshing) return
    reset()
  }

  return (
    <div
      ref={wrapRef}
      className={`relative ${className}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      style={{
        touchAction: 'manipulation',
        overscrollBehaviorY: 'contain',
      } as React.CSSProperties}
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
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Loader2 className={`h-4 w-4 ${pullPx >= threshold ? '' : 'animate-spin-slow'}`} />
          )}
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

// .animate-spin-slow { animation: spin 1.2s linear infinite; }
