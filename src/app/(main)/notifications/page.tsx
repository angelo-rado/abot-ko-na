// src/app/(main)/notifications/page.tsx
'use client'

import { useMemo, useCallback, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Bell, CheckCheck, Filter, Truck, DoorOpen, MessageSquare, Users, Info } from 'lucide-react'
import { toast } from 'sonner'
import { useNotifications } from '@/lib/notifications/useNotifications'
import { NotificationDoc } from '@/lib/notifications/types'
import { useAuth } from '@/lib/useAuth'
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { useSelectedFamily } from '@/lib/selected-family'
import { useOnlineStatus } from '@/lib/hooks/useOnlinestatus'
import { safeFormatDistanceToNow, toDate } from '@/lib/dates'
import { onJoined } from '@/lib/join-bus'

export default function NotificationsPage() {
  const params = useSearchParams()
  const router = useRouter()
  const { user } = useAuth()
  const { familyId: defaultFamilyId, families } = useSelectedFamily()
  const isOnline = useOnlineStatus()

  const familyParam = params.get('family') // 'all' | familyId
  const scope = useMemo(() => {
    if (!familyParam || familyParam === 'all') return 'all' as const
    return { familyId: familyParam } as const
  }, [familyParam])

  const { items, loading, error } = useNotifications(scope)

  // Refresh on join
  useMemo(() => onJoined(() => router.refresh()), [router])

  const currentLabel = useMemo(() => {
    if (scope === 'all') return 'All families'
    const found = families.find((f) => f.id === scope.familyId)
    return found?.name ?? scope.familyId
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

  const unread = useMemo(() => {
    if (!user?.uid) return new Set<string>()
    const set = new Set<string>()
    for (const n of items) {
      if (!n.reads || !user?.uid) {
        set.add(n.id)
      } else if (!n.reads[user.uid]) {
        set.add(n.id)
      }
    }
    return set
  }, [items, user?.uid])

  const markOne = useCallback(async (n: NotificationDoc) => {
    if (!user?.uid || !n._path) return
    try {
      await updateDoc(doc(firestore, n._path), {
        [`reads.${user.uid}`]: serverTimestamp(),
      })
    } catch (e) {
      console.warn('mark read failed', e)
    }
  }, [user?.uid])

  const markAll = useCallback(async () => {
    if (!user?.uid) return
    const targets = items.filter((n) => !n.reads?.[user.uid] && n._path)
    if (targets.length === 0) return
    await Promise.all(
      targets.map((n) =>
        updateDoc(doc(firestore, n._path as string), {
          [`reads.${user.uid}`]: serverTimestamp(),
        }).catch(() => {})
      )
    )
    toast.success('All caught up')
  }, [items, user?.uid])

  return (
    <main className="mx-auto w-full max-w-2xl p-4 md:p-6">
      {!isOnline && (
        <p className="mb-3 text-center text-xs text-amber-600">Offline — showing cached notifications.</p>
      )}

      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          <h1 className="text-lg font-semibold">Notifications</h1>
          {unread.size > 0 && (
            <Badge variant="secondary" className="ml-1">{unread.size}</Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={markAll} disabled={items.length === 0 || unread.size === 0}>
            <CheckCheck className="mr-1 h-4 w-4" /> Mark all read
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Filter className="mr-2 h-4 w-4" />
                {currentLabel}
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
                  Default: {families.find(f => f.id === defaultFamilyId)?.name ?? defaultFamilyId}
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
        </div>
      </div>

      <Separator />

      <div className="mt-4 space-y-2">
        {loading && (
          <>
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="flex items-center gap-3 p-3">
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

        {!loading && !error && items.length === 0 && (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              No notifications yet.
            </CardContent>
          </Card>
        )}

        {!loading && !error && items.map((n) => (
          <NotificationRow key={n.id} n={n} unread={!n.reads?.[(user?.uid ?? '')]} onSeen={() => markOne(n)} />
        ))}
      </div>
    </main>
  )
}

function NotificationRow({ n, unread, onSeen }: { n: NotificationDoc; unread: boolean; onSeen: () => void }) {
  const icon = (() => {
    const base = 'h-5 w-5'
    switch (true) {
      case n.type.startsWith('delivery'): return <Truck className={base} />
      case n.type === 'presence_changed': return <DoorOpen className={base} />
      case n.type === 'note_added': return <MessageSquare className={base} />
      case n.type === 'invite': return <Users className={base} />
      default: return <Info className={base} />
    }
  })()

  const createdAt = safeFormatDistanceToNow(toDate(n.createdAt))

  return (
    <Card data-unread={unread ? '1' : undefined} className="transition-colors data-[unread=1]:border-primary/40">
      <CardContent className="flex items-start gap-3 p-3">
        <div className="mt-0.5">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="truncate font-medium">{n.title ?? prettify(n.type)}</div>
            <div className="shrink-0 text-xs text-muted-foreground">{createdAt}</div>
          </div>
          {n.body && <div className="truncate text-sm text-muted-foreground">{n.body}</div>}
          <div className="mt-2 flex gap-2">
            {n.link && (
              <Button asChild variant="secondary" size="sm" onClick={onSeen}>
                <Link href={n.link}>Open</Link>
              </Button>
            )}
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
  return t.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
