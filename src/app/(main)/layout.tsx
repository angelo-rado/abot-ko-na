// app/(main)/layout.tsx
'use client'

import React, { useEffect } from 'react'
import { ThemeProvider } from 'next-themes'
import { usePathname, useRouter } from 'next/navigation'
import { Bell, HomeIcon, PackageIcon, UsersIcon, SettingsIcon } from 'lucide-react'
import { getAuth, onAuthStateChanged } from 'firebase/auth'
import { getFirebaseMessaging } from '@/lib/firebase'
import { getToken, onMessage } from 'firebase/messaging'
import PTR from '../components/PullToRefresh'
import { SelectedFamilyProvider } from '@/lib/selected-family'
import { initOutboxProcessor } from '@/lib/offline'
import { toast } from 'sonner'
import GlobalMembershipEnsurer from './GlobalMembershipEnsurer'
import { useFcm } from '@/lib/notifications/useFcm'

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
function safeRenderNode(node: React.ReactNode): React.ReactNode {
  if (node == null) return null
  if (typeof node === 'string' || typeof node === 'number') return node
  if (Array.isArray(node)) return <>{node}</>
  if (React.isValidElement(node)) return node
  return null
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

/** ==== Standalone shell (no tab bar) ==== */
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

/** ==== Tab shell (bottom tab bar, tap-only — no swipe) ==== */
function TabShell({
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
  const auth = getAuth()

  // Push notifications (non-Safari) — register token once signed in.
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
              const idt = await u.getIdToken()
              await fetch('/api/save-fcm-token', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${idt}`,
                },
                body: JSON.stringify({ token, userId: u.uid }),
              }).then(r => r.json()).then(j => {
                if (!j?.ok) console.warn('[push] save token failed', j)
              }).catch(err => console.warn('[push] save token error', err))

              onMessage(messaging, (payload) => {
                const title = payload.notification?.title || 'Update'
                const body = payload.notification?.body || ''
                toast(title, { description: body })
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
    { label: 'Deliveries', href: '/deliveries', Icon: PackageIcon, node: deliveries },
    { label: 'Family', href: '/family', Icon: UsersIcon, node: family },
    { label: 'Alerts', href: '/notifications', Icon: Bell, node: notifications },
    { label: 'Settings', href: '/settings', Icon: SettingsIcon, node: settings },
  ]

  const index = (() => {
    const i = nav.findIndex(n => pathname === n.href || pathname.startsWith(n.href + '/'))
    return i === -1 ? 0 : i
  })()

  // Prefetch all tabs for instant switching.
  useEffect(() => {
    nav.forEach(n => router.prefetch?.(n.href))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  const softRefresh = async () => {
    try { router.refresh() } catch { }
    await new Promise((r) => setTimeout(r, 250))
  }

  return (
    <div className="flex flex-col bg-background text-foreground" style={{ height: '100dvh' }}>
      {/* Active screen */}
      <div
        id="main-scroll"
        className="flex-1 overflow-y-auto overscroll-contain"
        style={{ paddingBottom: 'calc(4.25rem + env(safe-area-inset-bottom))' }}
      >
        <PTR
          getScrollEl={() => document.getElementById('main-scroll')}
          onRefresh={softRefresh}
          className="min-h-full"
          safetyTimeoutMs={2500}
          minSpinMs={400}
        >
          {safeRenderNode(nav[index].node)}
        </PTR>
      </div>

      {/* Bottom tab bar */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 flex items-stretch justify-around border-t bg-background/95 backdrop-blur"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="Primary"
      >
        {nav.map(({ label, href, Icon }, i) => {
          const active = i === index
          return (
            <button
              key={href}
              type="button"
              onClick={() => { if (i !== index) router.push(href, { scroll: false }) }}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 min-h-[60px] px-1 transition-colors ${
                active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 1.8} />
              <span className={`text-[11px] leading-none ${active ? 'font-semibold' : ''}`}>{label}</span>
            </button>
          )
        })}
      </nav>
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

  useFcm()

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

  const STANDALONE_PREFIXES = ['/family/join', '/login', '/onboarding', '/family/create', '/shopping'] as const
  const isStandalone = STANDALONE_PREFIXES.some((p) => pathname.startsWith(p))

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <SelectedFamilyProvider>
        <RouteFlash />
        <GlobalMembershipEnsurer />
        {isStandalone ? (
          <StandaloneShell>{children}</StandaloneShell>
        ) : (
          <TabShell
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
