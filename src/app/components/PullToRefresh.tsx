'use client'

import { useRef, useState, useCallback } from 'react'
import { Loader2 } from 'lucide-react'

type Props = {
  children: React.ReactNode
  onRefresh?: () => Promise<void> | void
  /** pixels to pull before triggering refresh */
  threshold?: number
  /** max visual pull distance */
  maxPull?: number
  className?: string
}

export default function PullToRefresh({
  children,
  onRefresh,
  threshold = 64,
  maxPull = 120,
  className = '',
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const startY = useRef<number | null>(null)
  const pulling = useRef(false)

  const [pullPx, setPullPx] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  const atTop = () => {
    const el = document.scrollingElement || document.documentElement
    return (el?.scrollTop ?? 0) <= 0
  }

  const reset = useCallback(() => {
    setPullPx(0)
    pulling.current = false
    startY.current = null
  }, [])

  const doRefresh = useCallback(async () => {
    if (!onRefresh) return
    try {
      setRefreshing(true)
      // light haptic if supported
      try { navigator.vibrate?.(15) } catch {}
      await onRefresh()
    } finally {
      setRefreshing(false)
      reset()
    }
  }, [onRefresh, reset])

  const onTouchStart = (e: React.TouchEvent) => {
    if (refreshing) return
    if (!atTop()) return
    startY.current = e.touches[0].clientY
    pulling.current = true
  }

  const onTouchMove = (e: React.TouchEvent) => {
    if (!pulling.current || refreshing) return
    const y = e.touches[0].clientY
    if (startY.current == null) startY.current = y
    const diff = y - startY.current
    if (diff > 0 && atTop()) {
      // dampen pull
      const damped = Math.min(maxPull, diff * 0.6)
      setPullPx(damped)
      // prevent native bounce
      if (e.cancelable) e.preventDefault()
    }
  }

  const onTouchEnd = () => {
    if (!pulling.current || refreshing) return reset()
    if (pullPx >= threshold) {
      // lock indicator while refreshing
      setPullPx(threshold)
      doRefresh()
    } else {
      reset()
    }
  }

  return (
    <div
      ref={wrapRef}
      className={`relative ${className}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      {/* Indicator */}
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

      {/* Content translates with pull */}
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

// tiny helper animation (optional)
// Add to your global CSS if you want slower spin while pulling:
// .animate-spin-slow { animation: spin 1.2s linear infinite; }
