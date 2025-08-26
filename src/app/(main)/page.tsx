'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/lib/useAuth'
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  setDoc,
} from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { Loader2, Home as HomeIcon, DoorOpen, MapPin } from 'lucide-react' // ⬅️ MapPin added
import { Skeleton } from '@/components/ui/skeleton'
import { useAutoPresence } from '@/lib/useAutoPresence'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatDistanceToNow } from 'date-fns'
import { motion, AnimatePresence } from 'framer-motion'
import CreateFamilyModal from '../components/CreateFamilyModal'
import JoinFamilyModal from '../components/JoinFamilyModal'
import HomeDeliveriesToday from '../components/HomeDeliveriesToday'
import Link from 'next/link'
import { HelpCircleHint } from '../components/HelpCircleHint'
import { useOnlineStatus } from '@/lib/hooks/useOnlinestatus'
import { useSelectedFamily } from '@/lib/selected-family'

export default function HomePage() {
  const { user, loading: authLoading } = useAuth()
  const { familyId, families, loadingFamilies } = useSelectedFamily()

  const [isHome, setIsHome] = useState<boolean | null>(null)
  const [justChangedStatusAt, setJustChangedStatusAt] = useState<number | null>(null)
  const [myStatusSource, setMyStatusSource] = useState<string | null>(null)
  const [presenceLoading, setPresenceLoading] = useState(true)

  const [membersLive, setMembersLive] = useState<any[]>([])
  const [membersLoading, setMembersLoading] = useState(true)

  const [createOpen, setCreateOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)

  const [now, setNow] = useState(0)

  const isOnline = useOnlineStatus()
  const offlineBanner = !isOnline ? (
    <p className="text-center text-red-500">You're offline — cached content only.</p>
  ) : null

  // family-aware auto presence hook
  useAutoPresence(familyId)

  useEffect(() => {
    const id = setInterval(() => setNow((n) => n + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!justChangedStatusAt) return
    const id = setTimeout(() => setJustChangedStatusAt(null), 1500)
    return () => clearTimeout(id)
  }, [justChangedStatusAt])

  function toMillisSafe(value: unknown): number | null {
    if (value == null) return null
    if (value instanceof Timestamp) return value.toMillis()
    if (typeof value === 'number') return value
    if (value instanceof Date) return value.getTime()
    return null
  }
  const toDateSafe = (ts?: Timestamp | number | Date | null | undefined) => {
    const millis = toMillisSafe(ts)
    return millis ? new Date(millis) : null
  }

  // Ensure current user's profile exists in members doc
  useEffect(() => {
    if (!user?.uid || !familyId) return
    const ref = doc(firestore, 'families', familyId, 'members', user.uid)
    setDoc(ref, {
      name: (user as any).name ?? 'Unknown',
      photoURL: (user as any).photoURL ?? null,
      uid: user.uid,
    }, { merge: true }).catch(err => {
      console.warn('Failed to ensure member profile fields', err)
    })
  }, [user?.uid, familyId])

  // GLOBAL autoPresence
  const [userAutoPresence, setUserAutoPresence] = useState<boolean | null>(null)
  useEffect(() => {
    if (!user?.uid) { setUserAutoPresence(null); return }
    const unsub = onSnapshot(
      doc(firestore, 'users', user.uid),
      (snap) => setUserAutoPresence((snap.data() as any)?.autoPresence === true),
      () => setUserAutoPresence(null)
    )
    return () => unsub()
  }, [user?.uid])

  // 🔎 Family Home Location detector (robust: GeoPoint | {lat,lng} | legacy fields)
  const [hasHomeLocation, setHasHomeLocation] = useState<boolean | null>(null)
  useEffect(() => {
    if (!familyId) { setHasHomeLocation(null); return }

    const unsub = onSnapshot(
      doc(firestore, 'families', familyId),
      (snap) => {
        const d = snap.data() as any
        const hasGeo = (obj: any) =>
          !!obj && (
            (typeof obj.latitude === 'number' && typeof obj.longitude === 'number') || // Firestore GeoPoint
            (typeof obj.lat === 'number' && typeof obj.lng === 'number')              // Plain object
          )

        const has =
          hasGeo(d?.homeLocation) ||
          hasGeo(d?.home) ||
          (typeof d?.homeLat === 'number' && typeof d?.homeLng === 'number') ||
          hasGeo(d?.location) // fallback if stored as `location`
        setHasHomeLocation(!!has)
      },
      () => setHasHomeLocation(null)
    )
    return () => unsub()
  }, [familyId])

  // Subscribe to members
  useEffect(() => {
    if (!user?.uid || !familyId) {
      setMembersLive([]); setMembersLoading(false); setPresenceLoading(false)
      return
    }

    const membersRef = collection(firestore, 'families', familyId, 'members')
    const unsub = onSnapshot(
      membersRef,
      (snapshot) => {
        if (!user?.uid) return
        const docs = snapshot.docs.map((d) => ({ uid: d.id, ...(d.data() as any) }))
        setMembersLive(docs)
        setMembersLoading(false)
        setPresenceLoading(false)

        const me = docs.find((m) => m.uid === user.uid)
        if (me) {
          const isRecentChange = justChangedStatusAt && Date.now() - justChangedStatusAt < 1500
          if (!isRecentChange) setIsHome(me.status === 'home')

          const rawSource = (me.statusSource ?? me.source ?? me.status_source) || null
          const effective = (me.autoPresence === true || userAutoPresence === true) ? 'geo' : rawSource
          setMyStatusSource(effective)
        }
      },
      (err) => {
        if (user?.uid) console.warn('members collection snapshot error', err)
        setMembersLive([]); setMembersLoading(false); setPresenceLoading(false)
      }
    )

    return () => unsub()
  }, [user?.uid, familyId, justChangedStatusAt, userAutoPresence])

  const handlePresenceChange = async (newStatus: 'home' | 'away') => {
    if (!user || !familyId) return
    const ref = doc(firestore, 'families', familyId, 'members', user.uid)
    await setDoc(ref, {
      status: newStatus,
      statusSource: 'manual',
      updatedAt: serverTimestamp(),
      name: (user as any).name ?? 'Unknown',
      photoURL: (user as any).photoURL ?? null,
      uid: user.uid,
    }, { merge: true })
    setIsHome(newStatus === 'home')
    setJustChangedStatusAt(Date.now())
  }

  function formatUpdatedAt(ts: Timestamp | Date | number | undefined) {
    if (!ts) return 'Unknown time'
    const date = ts instanceof Timestamp ? ts.toDate() : (typeof ts === 'number' ? new Date(ts) : ts)
    return formatDistanceToNow(date, { addSuffix: true })
  }

  if (authLoading) {
    return (
      <main className="flex items-center justify-center h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </main>
    )
  }

  return (
    <>
      {offlineBanner}
      <main className="max-w-2xl mx-auto p-6 space-y-6">
        <CreateFamilyModal open={createOpen} onOpenChange={setCreateOpen} />
        <JoinFamilyModal open={joinOpen} onOpenChange={setJoinOpen} />

        {/* Default family summary */}
        <div className="rounded-lg border p-3 bg-muted/30 flex items-center justify-between">
          <div className="text-sm">
            <span className="font-medium">Default family:</span>{' '}
            <span>{families.find((f) => f.id === familyId)?.name ?? familyId ?? 'None set'}</span>
          </div>
          <Link href="/settings#default-family" className="text-sm underline">Change</Link>
        </div>

        {/* Who's Home */}
        <Card>
          <CardHeader>
            <CardTitle>Who's Home</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {presenceLoading || loadingFamilies ? (
              <>
                {Array.from({ length: 3 }).map((_, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-12" />
                  </div>
                ))}
              </>
            ) : families.length === 0 ? (
              <div className="flex flex-col items-center text-center space-y-3 py-4">
                <p className="text-sm text-muted-foreground">
                  You don't have any families yet — create one or join with an invite link.
                </p>
                <div className="flex gap-2">
                  <Button type="button" onClick={() => setCreateOpen(true)}>Create Family</Button>
                  <Button type="button" variant="outline" onClick={() => setJoinOpen(true)}>Join Family</Button>
                </div>
              </div>
            ) : !familyId ? (
              <p className="text-muted-foreground text-sm">Set a default family in Settings to see who's home.</p>
            ) : (
              (() => {
                const members = membersLive
                const loading = membersLoading

                // 🔔 Home location banner lives here now
                { /* show only when determined false */ }
                const homeBanner = hasHomeLocation === false ? (
                  <div className="flex items-start gap-3 p-3 border rounded bg-muted/30 mb-2">
                    <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground" />
                    <div className="text-xs">
                      <div className="font-medium">Family Home Location not set</div>
                      <div className="text-muted-foreground">
                        Set a home location to improve Who&apos;s Home accuracy and auto-presence.
                      </div>
                      <div className="mt-2">
                        <Link href="/family">
                          <Button size="sm" variant="outline">Set Home Location</Button>
                        </Link>
                      </div>
                    </div>
                  </div>
                ) : null

                // normalize presence fields
                const presenceMap = new Map(
                  members.map((m) => {
                    const status = m.status ?? null
                    const memberAuto = m.autoPresence === true
                    const rawSource = (m.statusSource ?? m.source ?? m.status_source) || null
                    const statusSource =
                      memberAuto || (user?.uid && m.uid === user.uid && userAutoPresence === true)
                        ? 'geo'
                        : rawSource

                    const updatedAt = (m.updatedAt ?? m.updated_at ?? m.lastUpdated ?? null) as any
                    const photoURL = (m.photoURL ?? m.photo ?? null) as string | null
                    const name = (m.name ?? m.displayName ?? 'Unknown') as string

                    return [m.uid, { status, statusSource, updatedAt, photoURL, name }]
                  })
                )

                if (loading) {
                  return (
                    <>
                      {homeBanner}
                      {Array.from({ length: 3 }).map((_, idx) => (
                        <div key={idx} className="flex items-center justify-between">
                          <Skeleton className="h-4 w-24" />
                          <Skeleton className="h-4 w-20" />
                        </div>
                      ))}
                    </>
                  )
                }
                if (members.length === 0) {
                  return (
                    <>
                      {homeBanner}
                      <p className="text-muted-foreground text-sm">No members yet.</p>
                    </>
                  )
                }

                const activity = members
                  .map((m) => {
                    const millis = toMillisSafe(m.updatedAt as unknown)
                    return { uid: m.uid, name: m.name, status: m.status, ts: millis }
                  })
                  .filter((x) => x.ts)
                  .sort((a, b) => (b.ts! - a.ts!))
                  .slice(0, 3)

                return (
                  <TooltipProvider>
                    <div className="space-y-2">
                      {homeBanner}

                      <div className="space-y-2">
                        <AnimatePresence>
                          {members.map((m) => {
                            const presence = presenceMap.get(m.uid)!
                            const updatedDate = toDateSafe(presence?.updatedAt)
                            const initials = (presence.name ?? '')
                              .split(' ')
                              .map((s: string) => s[0])
                              .join('')
                              .slice(0, 2)
                              .toUpperCase()

                            const isCurrentUser = m.uid === user?.uid

                            return (
                              <motion.div
                                key={m.uid}
                                layout
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 8 }}
                                transition={{ duration: 0.2 }}
                                className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2 px-2 py-1 rounded-md ${isCurrentUser ? 'bg-muted/10' : ''}`}
                              >
                                <div className="flex items-center gap-3 min-h-[48px]">
                                  {presence.photoURL ? (
                                    <img src={presence.photoURL} alt={presence.name} className="h-8 w-8 rounded-full object-cover" />
                                  ) : (
                                    <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium">
                                      {initials || '?'}
                                    </div>
                                  )}

                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium truncate">{presence.name}</span>
                                      <div className="flex items-center">
                                        <AnimatePresence mode="wait" initial={false}>
                                          {presence.status === 'home' && (
                                            <motion.span key="home" initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }} transition={{ duration: 0.18 }} className="flex items-center text-green-600" title="home">
                                              <HomeIcon className="w-4 h-4" />
                                            </motion.span>
                                          )}
                                          {presence.status === 'away' && (
                                            <motion.span key="away" initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }} transition={{ duration: 0.18 }} className="flex items-center text-gray-500" title="away">
                                              <DoorOpen className="w-4 h-4" />
                                            </motion.span>
                                          )}
                                          {!presence.status && (
                                            <motion.span key="unknown" initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }} transition={{ duration: 0.18 }} className="inline-block h-2 w-2 rounded-full bg-gray-300" title="unknown" />
                                          )}
                                        </AnimatePresence>
                                      </div>
                                    </div>
                                    <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
                                      <span className="capitalize">{presence.status ?? 'unknown'}</span>
                                      {presence.statusSource && (<span>• {presence.statusSource === 'geo' ? 'Auto' : 'Manual'}</span>)}
                                      {updatedDate && <span>• {formatDistanceToNow(updatedDate, { addSuffix: true })}</span>}
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="text-[10px] px-2 py-0.5 rounded bg-muted text-muted-foreground border border-muted-foreground/10 cursor-default">
                                        {presence.statusSource === 'geo' ? 'Auto' : presence.statusSource === 'manual' ? 'Manual' : '—'}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" align="end">
                                      <p>
                                        {presence.statusSource === 'geo'
                                          ? 'Set automatically based on location'
                                          : presence.statusSource === 'manual'
                                            ? 'Manually set by user'
                                            : 'No source available'}
                                      </p>
                                      {updatedDate && (
                                        <p className="text-xs text-muted-foreground">
                                          Updated {formatDistanceToNow(updatedDate, { addSuffix: true })}
                                        </p>
                                      )}
                                    </TooltipContent>
                                  </Tooltip>

                                  <div className="text-xs text-muted-foreground sm:hidden">
                                    {updatedDate ? formatDistanceToNow(updatedDate, { addSuffix: true }) : 'unknown time'}
                                  </div>
                                </div>
                              </motion.div>
                            )
                          })}
                        </AnimatePresence>
                      </div>

                      {activity.length > 0 && (
                        <div className="mt-2 p-2 bg-muted/5 rounded-md text-sm">
                          <div className="text-xs text-muted-foreground mb-1">Recent activity</div>
                          <ul className="space-y-1">
                            {activity.map((a) => (
                              <motion.li key={a.uid} layout transition={{ duration: 0.25 }} className="flex items-center justify-between">
                                <div className="truncate">
                                  <span className="font-medium">{a.name}</span>
                                  <span className="text-muted-foreground"> — {a.status}</span>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {a.ts ? formatDistanceToNow(new Date(a.ts!), { addSuffix: true }) : ''}
                                </div>
                              </motion.li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </TooltipProvider>
                )
              })()
            )}
          </CardContent>
        </Card>

        {/* Deliveries Today */}
        <Card>
          <CardHeader>
            <CardTitle>Deliveries Today</CardTitle>
          </CardHeader>
          <CardContent>
            {presenceLoading || loadingFamilies ? (
              <>
                <Skeleton className="h-4 w-full mb-2" />
                <Skeleton className="h-4 w-5/6" />
              </>
            ) : (
              <HomeDeliveriesToday
                familyId={familyId}
                presenceLoading={presenceLoading}
                familiesLoading={loadingFamilies}
                showAllUsers={true}
              />
            )}
          </CardContent>
        </Card>

        {/* Presence buttons */}
        <div className="flex gap-4">
          {(presenceLoading || loadingFamilies) ? (
            <>
              <Skeleton className="h-10 flex-1 rounded-md" />
              <Skeleton className="h-10 flex-1 rounded-md" />
            </>
          ) : (
            <div className="flex gap-4 w-full">
              {myStatusSource === 'geo' ? (
                <span className="flex-1">
                  <Button type="button" variant={isHome ? 'default' : 'outline'} onClick={() => handlePresenceChange('home')} className="w-full" disabled>
                    <HomeIcon className="w-4 h-4 mr-2" />
                    I’m Home
                  </Button>
                </span>
              ) : (
                <Button type="button" variant={isHome ? 'default' : 'outline'} onClick={() => handlePresenceChange('home')} className="flex-1" disabled={presenceLoading || loadingFamilies}>
                  <HomeIcon className="w-4 h-4 mr-2" />
                  I’m Home
                </Button>
              )}

              {myStatusSource === 'geo' ? (
                <>
                  <span className="flex-1">
                    <Button type="button" variant={isHome === false ? 'default' : 'outline'} onClick={() => handlePresenceChange('away')} className="w-full" disabled>
                      <DoorOpen className="w-4 h-4 mr-2" />
                      I’m Out
                    </Button>
                  </span>
                  <HelpCircleHint title="Auto-set status">
                    <div className="space-y-2">
                      <p>Your presence is updated automatically using your location.</p>
                      <p>
                        To change this, visit{' '}
                        <Link href="/settings#default-family" className="text-blue-600 hover:underline">
                          Settings →
                        </Link>
                      </p>
                    </div>
                  </HelpCircleHint>
                </>
              ) : (
                <Button type="button" variant={isHome === false ? 'default' : 'outline'} onClick={() => handlePresenceChange('away')} className="flex-1">
                  <DoorOpen className="w-4 h-4 mr-2" />
                  I’m Out
                </Button>
              )}
            </div>
          )}
        </div>
      </main>
    </>
  )
}
