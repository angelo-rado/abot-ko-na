'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
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

  useEffect(() => {
    setHasMounted(true)
  }, [])

  if (!hasMounted) {
    // Avoid mismatch by skipping render until after hydration
    return null
  }

  return (
    <div className="flex flex-col min-h-screen bg-[#fdfcf9]">
      {/* Fixed top nav */}
      <nav className="fixed top-0 left-0 right-0 h-16 bg-white border-b flex items-center justify-around z-50">
        {navItems.map(({ label, href, icon: Icon }) => {
          const isActive = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center text-xs p-2',
                isActive ? 'text-blue-600 font-semibold' : 'text-muted-foreground'
              )}
            >
              <Icon className="w-5 h-5 mb-1" />
              <span>{label}</span>
            </Link>
          )
        })}
      </nav>

      {/* Main content with top padding to account for nav */}
      <main className="flex-1 pt-16 px-4">
        {children}
      </main>
    </div>
  )
}
