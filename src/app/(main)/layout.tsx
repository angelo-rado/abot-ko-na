// src/app/layout.tsx  (or wherever your MainLayout lives)
'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import {
  HomeIcon,
  TruckIcon,
  UsersIcon,
  SettingsIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { label: 'Home', href: '/', icon: HomeIcon },
  { label: 'Deliveries', href: '/deliveries', icon: TruckIcon },
  { label: 'Family', href: '/family', icon: UsersIcon },
  { label: 'Settings', href: '/settings', icon: SettingsIcon },
]

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [hasMounted, setHasMounted] = useState(false)

  // auto-hide state
  const [hidden, setHidden] = useState(false)
  // compact state for subtle shrink on mobile when scrolling down
  const [compact, setCompact] = useState(false)

  const lastY = useRef(0)
  const ticking = useRef(false)

  useEffect(() => {
    setHasMounted(true)
  }, [])

  useEffect(() => {
    // nothing to do server-side
    if (typeof window === 'undefined') return

    lastY.current = window.scrollY || 0

    function onScroll() {
      const currentY = window.scrollY || 0
      if (ticking.current) return
      ticking.current = true
      requestAnimationFrame(() => {
        const delta = currentY - lastY.current

        // thresholds to avoid flicker from micro-scrolls
        const DOWN_THRESHOLD = 20
        const UP_THRESHOLD = -50

        // Hide when scrolling down enough and past some top offset
        if (delta > DOWN_THRESHOLD && currentY > 80) {
          setHidden(true)
          // compact on mobile when hidden
          setCompact(true)
        } else if (delta < UP_THRESHOLD || currentY < 100) {
          // show when scrolling up a reasonable amount, or near top
          setHidden(false)
          setCompact(false)
        }

        lastY.current = currentY
        ticking.current = false
      })
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (!hasMounted) return null // prevents hydration mismatch

  /**
   * Layout notes:
   * - nav is fixed and overlays content. We add top padding to main content to avoid overlap.
   * - nav height is fixed (h-16 desktop, h-12 mobile) so padding can match.
   */
  const navHeightClass = compact ? 'h-12' : 'h-16' // compact = smaller height
  const mainPaddingTop = compact ? 'pt-12' : 'pt-16'

  return (
    
    <div className="flex flex-col min-h-screen bg-[#fdfcfa]">
      {/* Fixed navigator */}
      <nav
        aria-label="Primary navigation"
        className={cn(
          'fixed left-0 right-0 top-0 z-50 w-full border-b bg-white/95 backdrop-blur-sm flex justify-around items-center rounded-b-2xl shadow-sm transform transition-transform duration-300 ease-in-out',
          // hide/show
          hidden ? '-translate-y-full' : 'translate-y-0',
          // height compacting
          navHeightClass,
          // keep horizontal padding consistent
          'px-4'
        )}
      >
        {navItems.map(({ label, href, icon: Icon }) => {
          const isActive = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 rounded p-1',
                isActive
                  ? 'text-primary font-semibold'
                  : 'text-muted-foreground hover:text-primary'
              )}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon className={cn('mb-1', 'h-5 w-5')} />
              {/* label hidden on small screens for compact mobile UI */}
              <span className="hidden sm:inline">{label}</span>
            </Link>
          )
        })}
      </nav>

      {/* Main content — add padding top equal to nav height to avoid overlap */}
      <div className={cn('flex-1 transition-padding duration-200', mainPaddingTop)}>
        {children}
      </div>
    </div>
  )
}
