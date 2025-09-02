'use client'

import { useMemo, useCallback, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Bell,
  CheckCheck,
  Filter,
  Truck,
  DoorOpen,
  Users,
  Info,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useNotifications } from '@/lib/notifications/useNotifications'
import type { NotificationDoc } from '@/lib/notifications/types'
import { useAuth } from '@/lib/useAuth'
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { useSelectedFamily } from '@/lib/selected-family'
import { useOnlineStatus } from '@/lib/hooks/useOnlinestatus'
import { safeFormatDistanceToNow, toDate } from '@/lib/dates'
import { onJoined } from '@/lib/join-bus'

type Scope = 'all' | { familyId: string }
type Cat = 'all' | 'deliveries' | 'members' | 'presence'

const CLEAR_KEY_ALL = 'abot:notifs:clear:all'
const CLEAR_KEY_FAM_PREFIX = 'abot:notifs:clear:family:'

export default function NotificationsPage() {
  const params = useSearchParams()
  const router = useRouter()
  const { user } = useAuth()
  const { familyId: defaultFamilyId, families } = useSelectedFamily()
  const isOnline = useOnlineStatus()

  // ===== scope (all vs family) =====
  const familyParam = params.get('family') // 'all' | familyId
  const scope: Scope = useMemo(() => {
    if (!familyParam || familyParam === 'all') return 'all'
    return { familyId: familyParam }
  }, [familyParam])

  // ===== category filter =====
  const typeParam = (params.get('type') as Cat | null) || 'all'
  const [cat, setCat] = useState<Cat>(typeParam)
  useEffect(() => { setCat(typeParam) }, [typeParam])

  const { items, loading, error } = useNotifications(scope)

  // Refresh when someone joins a family (subscription + cleanup)
  useEffect(() => {
    const off = onJoined(() => router.refresh())
    return () => { try { off?.() } catch {} }
  }, [router])

  const currentLabel = useMemo(() => {
    if (scope === 'all') return 'All families'
    const fid = (scope as any).familyId as string
    const found = families.find((f) => f.id === fid)
    return found?.name ?? fid
  }, [scope, families])

  const navigateScope = useCallback(
    (next: 'all' | string) => {
      const search = new URLSearchParams(params.toString())
      if (next === 'all') search.set('family', 'all')
      else search.set('family', next)
      router.replace(`/notifications?${search.toString()}`)
    },
    [params, router]
  )

  const navigateCat = useCallback((next: Cat) => {
    const search = new URLSearchParams(params.toString())
    if (next === 'all') search.delete('type')
    else search.set('type', next)
    router.replace(`/notifications?${search.toString()}`)
  }, [params, router])

  // ===== clear threshold (local-only hide) =====
  const clearKeyBase =
    scope === 'all'
      ? CLEAR_KEY_ALL
      : `${CLEAR_KEY_FAM_PREFIX}${(scope as any).familyId}`
  // Per-user key to avoid cross-account bleed on shared devices
  const clearKey = user?.uid ? `${clearKeyBase}:u:${user.uid}` : clearKeyBase

  const [clearTs, setClearTs] = useState<number>(() => {
    if (typeof window === 'undefined') return 0
    const v = localStorage.getItem(clearKey)
    return v ? Number(v) || 0 : 0
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    const v = localStorage.getItem(clearKey)
    setClearTs(v ? Number(v) || 0 : 0)
  }, [clearKey])

  const unread = useMemo(() => {
    if (!user?.uid) return new Set<string>()
    const set = new Set<string>()
    for (const n of items) {
      if (!n.reads || !user.uid) {
        set.add(n.id)
      } else if (!n.reads[user.uid]) {
        set.add(n.id)
      }
    }
    return set
  }, [items, user?.uid])

  const markOne = useCallback(
    async (n: NotificationDoc) => {
      if (!user?.uid || !(n as any)._path) return
      try {
        await updateDoc(doc(firestore, (n as any)._path), {
          [`reads.${user.uid}`]: serverTimestamp(),
        })
      } catch (e) {
        console.warn('mark read failed', e)
      }
    },
    [user?.uid]
  )

  const markAll = useCallback(async () => {
    if (!user?.uid) return
    const targets = items.filter((n) => !n.reads?.[user.uid] && (n as any)._path)
    if (targets.length === 0) return
    await Promise.all(
      targets.map((n) =>
        updateDoc(doc(firestore, (n as any)._path as string), {
          [`reads.${user.uid}`]: serverTimestamp(),
        }).catch(() => {})
      )
    )
    toast.success('All caught up')
  }, [items, user?.uid])

  const clearReadLocally = useCallback(() => {
    if (items.length === 0) { toast.info('No notifications to clear'); return }
    const now = Date.now()
    try { localStorage.setItem(clearKey, String(now)) } catch {}
    setClearTs(now)
    toast.success('Cleared read notifications')
  }, [clearKey, items.length])

  const clearAllLocally = useCallback(async () => {
    if (items.length === 0) { toast.info('No notifications to clear'); return }
    await markAll()
    const now = Date.now()
    try { localStorage.setItem(clearKey, String(now)) } catch {}
    setClearTs(now)
    toast.success('Cleared all notifications')
  }, [markAll, clearKey, items.length])

  const filtered = useMemo(() => {
    const byClear = items.filter((n) => {
      const t = toDate(n.createdAt)
      const ms = t ? t.getTime() : 0
      return ms >= clearTs
    })
    if (cat === 'all') return byClear
    return byClear.filter((n) => categorize(n) === cat)
  }, [items, clearTs, cat])

  return (
    <main
      className="mx-auto w-full max-w-2xl p-4 md:p-6 leading-tight"
      style={{ WebkitFontSmoothing: 'antialiased' }}
    >
      {!isOnline && (
        <p className="mb-3 text-center text-xs text-amber-600" aria-live="polite">
          Offline — showing cached notifications.
        </p>
      )}

      {/* Header — mark as no-swipe to keep it tappable on mobile */}
      <div
        data-no-swipe
        className="mb-3 flex items-center justify-between gap-2 sm:gap-3 pointer-events-auto"
      >
        <div className="flex items-center gap-2 min-h-[44px]">
          <Bell className="h-5 w-5 shrink-0" />
          <h1 className="text-lg font-semibold">Notifications</h1>
          {unread.size > 0 && (
            <Badge variant="secondary" className="ml-1">{unread.size}</Badge>
          )}
        </div>

        {/* Actions (responsive) */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Mark all read: icon on xs, text on sm+ */}
          <Button
            variant="ghost"
            size="sm"
            className="gap-1"
            onClick={markAll}
            disabled={items.length === 0 || unread.size === 0}
            data-no-swipe
            aria-label="Mark all read"
          >
            <CheckCheck className="h-4 w-4" />
            <span className="hidden sm:inline">Mark all read</span>
          </Button>

          {/* Filter by family */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* SINGLE child only (Radix requirement) */}
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                aria-label="Filter by family"
                data-no-swipe
              >
                <Filter className="h-4 w-4" />
                <span className="hidden sm:inline">{currentLabel}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Filter by family</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigateScope('all')}>
                All families
              </DropdownMenuItem>
              {defaultFamilyId && (
                <DropdownMenuItem onClick={() => navigateScope(defaultFamilyId)}>
                  Default: {families.find((f) => f.id === defaultFamilyId)?.name ?? defaultFamilyId}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {families.map((f) => (
                <DropdownMenuItem key={f.id} onClick={() => navigateScope(f.id)}>
                  {f.name ?? f.id}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Clear */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* SINGLE child only (Radix requirement) */}
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                aria-label="Clear notifications"
                data-no-swipe
              >
                <Trash2 className="h-4 w-4" />
                <span className="hidden sm:inline">Clear</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={clearReadLocally}>Clear read</DropdownMenuItem>
              <DropdownMenuItem onClick={clearAllLocally}>Clear all</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Category pills (horiz scroller) — mark as no-swipe */}
      <div
        data-no-swipe
        role="tablist"
        aria-label="Notification categories"
        className="mb-2 flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]"
      >
        <CatPill current={cat} target="all" onSelect={navigateCat} label="All" />
        <CatPill current={cat} target="deliveries" onSelect={navigateCat} label="Deliveries" Icon={Truck} />
        <CatPill current={cat} target="members" onSelect={navigateCat} label="Members" Icon={Users} />
        <CatPill current={cat} target="presence" onSelect={navigateCat} label="Presence" Icon={DoorOpen} />
      </div>

      <Separator />

      <div className="mt-4 space-y-2" aria-busy={loading ? 'true' : 'false'} aria-live="polite">
        {loading && (
          <>
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="rounded-xl">
                <CardContent className="flex items-start gap-3 p-3 sm:p-4">
                  <Skeleton className="h-9 w-9 rounded-full" />
                  <div className="grid w-full gap-1">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </>
        )}

        {!loading && error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {!loading && !error && filtered.length === 0 && (
          <Card className="rounded-xl">
            <CardContent className="p-4 text-sm text-muted-foreground">
              No notifications{cat !== 'all' ? ` in ${cat}` : ''}.
            </CardContent>
          </Card>
        )}

        {!loading && !error && filtered.map((n) => (
          <NotificationRow
            key={n.id}
            n={n}
            unread={!n.reads?.[(user?.uid ?? '')]}
            onSeen={() => markOne(n)}
          />
        ))}
      </div>
    </main>
  )
}

function CatPill({
  current,
  target,
  onSelect,
  label,
  Icon,
}: {
  current: Cat
  target: Cat
  onSelect: (c: Cat) => void
  label: string
  Icon?: React.ComponentType<{ className?: string }>
}) {
  const active = current === target
  const Ico = Icon
  return (
    <button
      type="button"
      data-no-swipe
      aria-pressed={active}
      aria-label={label}
      onClick={() => onSelect(target)}
      className={`whitespace-nowrap rounded-full border px-3 py-2 text-xs sm:text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border bg-background text-foreground'
      }`}
      style={{ WebkitTapHighlightColor: 'transparent' }}
      role="tab"
    >
      <span className="inline-flex items-center gap-1.5 min-h-[24px]">
        {Ico ? <Ico className="h-4 w-4" /> : null}
        {label}
      </span>
    </button>
  )
}

function categorize(n: NotificationDoc): Cat {
  const t = (n.type || '').toLowerCase()
  if (t.startsWith('delivery')) return 'deliveries'
  if (t.includes('presence')) return 'presence'
  if (t.includes('member') || t.includes('invite') || t.includes('joined') || t.includes('left')) return 'members'
  return 'all'
}

function NotificationRow({
  n,
  unread,
  onSeen,
}: {
  n: NotificationDoc
  unread: boolean
  onSeen: () => void
}) {
  const createdAt = safeFormatDistanceToNow(toDate(n.createdAt))
  const cat = categorize(n)

  const icon = (() => {
    const base = 'h-5 w-5'
    switch (cat) {
      case 'deliveries': return <Truck className={base} />
      case 'presence': return <DoorOpen className={base} />
      case 'members': return <Users className={base} />
      default: return <Info className={base} />
    }
  })()

  const meta: any = (n as any).meta || {}

  // Family info – only show badge when we have a human-readable name; never show raw IDs
  const familyName =
    (n as any).familyName ||
    (n as any).family?.name ||
    meta.familyName ||
    null

  const actorName =
    meta.actorName || meta.userName || (n as any).actorName || null

  const status = meta.status || (n as any).status || null
  const statusSource = meta.statusSource || (n as any).statusSource || null
  const expected = toDate(meta.expectedDate || (n as any).expectedDate)
  const expectedStr = expected ? safeFormatDistanceToNow(expected) : null
  const courier = meta.courier || meta.carrier || null
  const tracking = meta.tracking || meta.trackingNumber || null
  const itemsCount = typeof meta.itemsCount === 'number' ? meta.itemsCount : null

  const familyLabel =
    typeof familyName === 'string' && familyName.trim().length > 0
      ? familyName.trim()
      : null

  return (
    <Card
      data-unread={unread ? '1' : undefined}
      className="rounded-xl transition-colors data-[unread=1]:border-primary/40"
      style={{ transform: 'translateZ(0)' }} // reduce iOS subpixel jitter
    >
      <CardContent className="flex items-start gap-3 p-3 sm:p-4">
        <div className="mt-0.5 shrink-0">{icon}</div>

        <div className="min-w-0 flex-1">
          {/* Title row */}
          <div className="flex items-baseline justify-between gap-2">
            <div className="truncate font-medium">{n.title ?? prettify(n.type)}</div>
            <div className="shrink-0 text-xs text-muted-foreground">{createdAt}</div>
          </div>

          {/* Body */}
          {n.body && (
            <div className="mt-0.5 text-sm text-muted-foreground break-words">
              {n.body}
            </div>
          )}

          {/* Meta row (chips) */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
              {cat === 'deliveries' ? 'Delivery'
                : cat === 'presence' ? 'Presence'
                : cat === 'members' ? 'Members'
                : 'Info'}
            </Badge>

            {familyLabel ? (
              <Badge variant="secondary" className="text-[10px]">
                {familyLabel}
              </Badge>
            ) : null}

            {cat === 'members' && actorName ? (
              <Badge variant="outline" className="text-[10px]">by {actorName}</Badge>
            ) : null}

            {cat === 'presence' && status ? (
              <Badge variant="outline" className="text-[10px] capitalize">
                {status}{statusSource ? ` • ${statusSource === 'geo' ? 'Auto' : 'Manual'}` : ''}
              </Badge>
            ) : null}

            {cat === 'deliveries' && expectedStr ? (
              <Badge variant="outline" className="text-[10px]">ETA {expectedStr}</Badge>
            ) : null}

            {cat === 'deliveries' && courier ? (
              <Badge variant="outline" className="text-[10px]">{courier}</Badge>
            ) : null}

            {cat === 'deliveries' && typeof itemsCount === 'number' ? (
              <Badge variant="outline" className="text-[10px]">
                {itemsCount} item{itemsCount === 1 ? '' : 's'}
              </Badge>
            ) : null}

            {cat === 'deliveries' && tracking ? (
              <Badge variant="outline" className="text-[10px]"># {String(tracking).slice(-8)}</Badge>
            ) : null}
          </div>

          {/* Actions */}
          <div className="mt-2 flex gap-2">
            {unread && (
              <Button variant="ghost" size="sm" onClick={onSeen}>Mark read</Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function prettify(t: string) {
  return (t || 'Notification').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
