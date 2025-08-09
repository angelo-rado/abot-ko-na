'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { motion, useMotionValue, animate } from 'framer-motion'
import { getAuth } from 'firebase/auth'
import { getFirebaseMessaging } from '@/lib/firebase'
import { getToken } from 'firebase/messaging'

import HomePage from './page'
import DeliveriesPage from './deliveries/page'
import FamilyPickerPage from './family/page'
import SettingsPage from './settings/page'

import { HomeIcon, PackageIcon, UsersIcon, SettingsIcon } from 'lucide-react'

const navItems = [
  { label: 'Home', href: '/', Component: HomePage, Icon: HomeIcon },
  { label: 'Deliveries', href: '/deliveries', Component: DeliveriesPage, Icon: PackageIcon },
  { label: 'Family', href: '/family', Component: FamilyPickerPage, Icon: UsersIcon },
  { label: 'Settings', href: '/settings', Component: SettingsPage, Icon: SettingsIcon },
]

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/')

  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

async function sendTokenToBackend(token: string, userId: string) {
  try {
    const response = await fetch('/api/save-fcm-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, userId }),
    })
    if (!response.ok) {
      console.error('Failed to save token')
    } else {
      console.log('Token saved')
    }
  } catch (error) {
    console.error('Error sending token:', error)
  }
}

export default function MainLayout() {
  const router = useRouter()
  const pathname = usePathname()
  const auth = getAuth()
  const userId = auth.currentUser?.uid

  const [viewportWidth, setViewportWidth] = useState<number | null>(null)

  useEffect(() => {
  console.log('Notification.permission:', Notification.permission);
}, []);


  useEffect(() => {
  async function setupPushNotifications() {
    if (!('serviceWorker' in navigator)) return

    try {
      const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js')
      console.log('Service Worker registered with scope:', registration.scope)

      const messaging = getFirebaseMessaging()
      if (!messaging) return

      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        console.log('Notification permission not granted')
        return
      }

      const token = await getToken(messaging, {
        vapidKey: 'BGh3Isyh15lAQ_GJ19Xwluh4atLY5QbbBt3tl0bnpUt6OkTNonKcm7IwlrmbI_E--IkvB__NYXV6xjbvGIE87iI',
        serviceWorkerRegistration: registration,
      })

      console.log('FCM token:', token)
    } catch (error) {
      console.error('Error setting up notifications:', error)
    }
  }

  setupPushNotifications()
}, [])





  useEffect(() => {
    function updateWidth() {
      setViewportWidth(window.innerWidth)
    }
    updateWidth()
    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [])

  const currentIndexFromPath = navItems.findIndex(item => item.href === pathname)
  const safeIndex = currentIndexFromPath === -1 ? 0 : currentIndexFromPath

  const [currentIndex, setCurrentIndex] = useState<number | null>(null)
  const isSyncingFromPath = useRef(false)

  useEffect(() => {
    if (safeIndex !== currentIndex) {
      isSyncingFromPath.current = true
      setCurrentIndex(safeIndex)
    }
  }, [safeIndex])

  useEffect(() => {
    if (currentIndex === null) return
    if (isSyncingFromPath.current) {
      isSyncingFromPath.current = false
      return
    }
    if (currentIndex !== safeIndex) {
      router.push(navItems[currentIndex].href)
    }
  }, [currentIndex, safeIndex, router])

  const x = useMotionValue(0)
  const isDragging = useRef(false)

  // Animate x on currentIndex change, if not dragging
  useEffect(() => {
    if (!isDragging.current && viewportWidth !== null && currentIndex !== null) {
      animate(x, -currentIndex * viewportWidth, {
        type: 'spring',
        stiffness: 400,
        damping: 35,
      })
    }
  }, [currentIndex, viewportWidth, x])

  // Touch tracking refs
  const touchStartX = useRef<number | null>(null)
  const touchStartTime = useRef<number>(0)
  const lastTouchX = useRef<number | null>(null)
  const animationFrame = useRef<number | null>(null)

  // Helper: safely set x with requestAnimationFrame to avoid jank
  function setXSmooth(value: number) {
    if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current)
    animationFrame.current = requestAnimationFrame(() => {
      x.set(value)
    })
  }

  function onTouchStart(e: React.TouchEvent) {
    if (viewportWidth === null) return
    isDragging.current = true
    touchStartX.current = e.touches[0].clientX
    lastTouchX.current = e.touches[0].clientX
    touchStartTime.current = e.timeStamp
    if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current)
  }

  function onTouchMove(e: React.TouchEvent) {
    if (viewportWidth === null || touchStartX.current === null) return
    const currentX = e.touches[0].clientX
    const deltaX = currentX - lastTouchX.current!
    lastTouchX.current = currentX

    // No hard clamping here for elastic feel, but softly limit with easing:
    const currentOffset = x.get()
    let newOffset = currentOffset + deltaX

    const maxOffset = 50 // allow 50px elastic pull
    const minOffset = -viewportWidth * (navItems.length - 1) - 50

    if (newOffset > maxOffset) {
      newOffset = maxOffset + (newOffset - maxOffset) * 0.3
    } else if (newOffset < minOffset) {
      newOffset = minOffset + (newOffset - minOffset) * 0.3
    }

    setXSmooth(newOffset)
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (viewportWidth === null) return
    isDragging.current = false

    const touchDuration = e.timeStamp - touchStartTime.current
    const offsetX = x.get()
    const velocity = lastTouchX.current !== null && touchStartX.current !== null
      ? (lastTouchX.current - touchStartX.current) / touchDuration * 1000
      : 0

    let newIndex = currentIndex ?? 0

    const velocityThreshold = 500
    const maxIndex = navItems.length - 1

    // Velocity flick moves only 1 page max
    if (velocity < -velocityThreshold && newIndex < maxIndex) {
      newIndex = Math.min(newIndex + 1, maxIndex)
    } else if (velocity > velocityThreshold && newIndex > 0) {
      newIndex = Math.max(newIndex - 1, 0)
    } else {
      // Snap to nearest page by rounding offset
      newIndex = Math.min(Math.max(Math.round(-offsetX / viewportWidth), 0), maxIndex)
    }

    setCurrentIndex(newIndex)

    // Animate to snapped page position for smoothness
    animate(x, -newIndex * viewportWidth, {
      type: 'spring',
      stiffness: 600,
      damping: 45,
      mass: 1,
    })
  }


  if (viewportWidth === null || currentIndex === null) return null

  return (
    <div
      className="flex flex-col min-h-screen overflow-hidden select-none"
      style={{ height: '100vh' }} // full height for max swipe area
    >
      <nav className="fixed top-0 left-0 right-0 h-16 bg-white border-b flex items-center justify-around z-50">
        {navItems.map(({ label, href, Icon }, i) => (
          <button
            key={href}
            onClick={() => setCurrentIndex(i)}
            className={`flex flex-col items-center text-xs p-2 ${i === currentIndex ? 'text-blue-600 font-semibold' : 'text-gray-600'
              }`}
          >
            <Icon className="w-5 h-5 mb-1" />
            {label}
          </button>
        ))}
      </nav>

      <motion.div
        className="flex flex-row pt-16 overflow-x-hidden"
        style={{ width: viewportWidth * navItems.length, x, height: 'calc(100vh - 4rem)' }}
        // Remove framer-motion drag to avoid conflicts on mobile, use only touch handlers:
        // drag="x"
        // dragConstraints={{ left: -viewportWidth * (navItems.length - 1), right: 0 }}
        // dragElastic={0}
        // onDragStart={() => { isDragging.current = true }}
        // onDragEnd={handleDragEnd}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {navItems.map(({ Component, href }, i) => (
          <div
            key={href}
            style={{ width: viewportWidth, flexShrink: 0, overflowY: 'auto', height: '100%' }}
          >
            <Component />
          </div>
        ))}
      </motion.div>
    </div>
  )
}
