// src/app/(main)/page.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/lib/useAuth'
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  deleteField,
} from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { Loader2, Home as HomeIcon, DoorOpen, MapPin, ShoppingCart, Truck, X, Bell, BellRing } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { useAutoPresence } from '@/lib/useAutoPresence'
import {
  TooltipProvider,
} from '@/components/ui/tooltip'
import { formatDistanceToNow } from 'date-fns'
import { motion, AnimatePresence } from 'framer-motion'
import CreateFamilyModal from '../components/CreateFamilyModal'
import JoinFamilyModal from '../components/JoinFamilyModal'
import HomeDeliveriesToday from '../components/HomeDeliveriesToday'
import Link from 'next/link'
import { useOnlineStatus } from '@/lib/hooks/useOnlinestatus'
import { useSelectedFamily } from '@/lib/selected-family'

// NEW
import { useRouter, useSearchParams } from 'next/navigation'
import { useIsIOS } from '@/lib/useIsIOS'
import { onJoined, getLastSelectedFamily } from '@/lib/join-bus'
import { toast } from 'sonner'
import {
  type RawMember,
  normalizeMemberStatus,
  normalizeMemberSource,
  normalizeMember,
} from '@/lib/models/presence'
import { hasHomeLocation as familyHasHomeLocation, getHomeLocation } from '@/lib/models/family'
import { setEnRoute, clearEnRoute, ETA_OPTIONS } from '@/lib/enroute'
import dynamic from 'next/dynamic'
import type { PresenceMember } from '../components/PresenceMap'

const PresenceMap = dynamic(() => import('../components/PresenceMap'), {
  ssr: false,
  loading: () => <Skeleton className="h-[260px] w-full rounded-2xl" />,
})

export default function HomePage() {
  const { user, loading: authLoading } = useAuth()
  const { familyId, families, loadingFamilies } = useSelectedFamily()

  const [isHome, setIsHome] = useState<boolean | null>(null)
  const [justChangedStatusAt, setJustChangedStatusAt] = useState<number | null>(null)
  const [myStatusSource, setMyStatusSource] = useState<string | null>(null)
  const [presenceLoading, setPresenceLoading] = useState(true)

  const [membersLive, setMembersLive] = useState<RawMember[]>([])
  const [membersLoading, setMembersLoading] = useState(true)

  // Map focus (tap a member to fly to them) + ref to scroll the map into view.
  const [focusTarget, setFocusTarget] = useState<{ lat: number; lng: number } | null>(null)
  const [locMsg, setLocMsg] = useState<string | null>(null)
  const mapCardRef = useRef<HTMLDivElement | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)

  const [, setNow] = useState(0)

  const isOnline = useOnlineStatus()
  const offlineBanner = !isOnline ? (
    <p className="text-center text-red-500">You're offline — cached content only.</p>
  ) : null

  // NEW
  const router = useRouter()
  const qp = useSearchParams()
  const joined = qp.get('joined')
  const joinedFamily = qp.get('family')
  const [hydrationKey, setHydrationKey] = useState(0)
  const isIOS = useIsIOS()

  // family-aware auto presence hook
  useAutoPresence(familyId)

  // tick to update "x minutes ago"
  useEffect(() => {
    const id = setInterval(() => setNow((n) => n + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!justChangedStatusAt) return
    const id = setTimeout(() => setJustChangedStatusAt(null), 1500)
    return () => clearTimeout(id)
  }, [justChangedStatusAt])

  // Ensure current user's profile exists in members doc
  useEffect(() => {
    if (!user?.uid || !familyId) return
    const ref = doc(firestore, 'families', familyId, 'members', user.uid)
    setDoc(
      ref,
      {
        name: user.name ?? 'Unknown',
        photoURL: user.photoURL ?? null,
        uid: user.uid,
      },
      { merge: true }
    ).catch(err => {
      console.warn('Failed to ensure member profile fields', err)
    })
  }, [user?.uid, familyId])

  // GLOBAL autoPresence
  const [userAutoPresence, setUserAutoPresence] = useState<boolean | null>(null)
  useEffect(() => {
    if (!user?.uid) { setUserAutoPresence(null); return }
    const unsub = onSnapshot(
      doc(firestore, 'users', user.uid),
      (snap) => setUserAutoPresence(snap.data()?.autoPresence === true),
      () => setUserAutoPresence(null)
    )
    return () => unsub()
  }, [user?.uid])

  // Family Home Location detector (robust: GeoPoint | {lat,lng} | {lat,lon} | legacy fields)
  const [hasHomeLocation, setHasHomeLocation] = useState<boolean | null>(null)
  const [homeLoc, setHomeLoc] = useState<{ lat: number; lng: number } | null>(null)
  const [homeRadius, setHomeRadius] = useState<number>(120)
  const [familyName, setFamilyName] = useState<string | null>(null)
  useEffect(() => {
    if (!familyId) { setHasHomeLocation(null); setHomeLoc(null); setFamilyName(null); return }

    const unsub = onSnapshot(
      doc(firestore, 'families', familyId),
      (snap) => {
        const data = snap.data()
        setHasHomeLocation(familyHasHomeLocation(data))
        setHomeLoc(getHomeLocation(data))
        setFamilyName(((data as any)?.name as string) ?? null)
        const r = (data as any)?.homeRadiusMeters
        setHomeRadius(typeof r === 'number' && Number.isFinite(r) ? Math.max(30, Math.min(1000, r)) : 120)
      },
      () => { setHasHomeLocation(false); setHomeLoc(null) }
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
        const docs: RawMember[] = snapshot.docs.map((d) => ({ uid: d.id, ...(d.data() as Record<string, unknown>) }))
        setMembersLive(docs)
        setMembersLoading(false)
        setPresenceLoading(false)

        const me = docs.find((m) => m.uid === user.uid)
        if (me) {
          const isRecentChange = justChangedStatusAt && Date.now() - justChangedStatusAt < 1500
          if (!isRecentChange) setIsHome(normalizeMemberStatus(me) === 'home')

          const effective = normalizeMemberSource(me, { autoPresenceOverride: userAutoPresence === true })
          setMyStatusSource(effective)
        }
      },
      (err) => {
        if (user?.uid) console.warn('members collection snapshot error', err)
        setMembersLive([]); setMembersLoading(false); setPresenceLoading(false)
      }
    )

    return () => unsub()
  }, [user?.uid, familyId, justChangedStatusAt, userAutoPresence, hydrationKey])

  const toggleWatch = async (targetUid: string) => {
    if (!user?.uid || !familyId || targetUid === user.uid) return
    const mine = membersLive.find((mm) => mm.uid === user.uid)?.watchHome as Record<string, boolean> | undefined
    const isWatching = !!mine?.[targetUid]
    try {
      await setDoc(
        doc(firestore, 'families', familyId, 'members', user.uid),
        { watchHome: { [targetUid]: isWatching ? deleteField() : true } },
        { merge: true }
      )
      toast.success(isWatching ? 'Stopped watching' : 'You’ll be notified when they get home')
    } catch {
      toast.error('Could not update')
    }
  }

  const handlePresenceChange = async (newStatus: 'home' | 'away') => {
    if (!user || !familyId) return
    const ref = doc(firestore, 'families', familyId, 'members', user.uid)
    await setDoc(ref, {
      status: newStatus,
      statusSource: 'manual',
      updatedAt: serverTimestamp(),
      name: user.name ?? 'Unknown',
      photoURL: user.photoURL ?? null,
      uid: user.uid,
      // Arriving home ends any "on my way" broadcast.
      ...(newStatus === 'home' ? { enRoute: false, etaMinutes: null } : {}),
    }, { merge: true })
    setIsHome(newStatus === 'home')
    setJustChangedStatusAt(Date.now())
  }

  // "On my way home" broadcast (derived from my live member doc)
  const me = user?.uid ? membersLive.find((m) => m.uid === user.uid) : undefined
  const myPresence = me ? normalizeMember(me, { autoPresenceOverride: userAutoPresence === true }) : null
  const [etaChoice, setEtaChoice] = useState<number | null>(null)

  const handleSetEnRoute = async () => {
    if (!user || !familyId) return
    try {
      await setEnRoute(familyId, user.uid, etaChoice, { name: user.name ?? 'Unknown', photoURL: user.photoURL ?? null })
      toast.success("Family notified you're on the way")
    } catch {
      toast.error('Could not update your status')
    }
  }

  const handleClearEnRoute = async () => {
    if (!user || !familyId) return
    try {
      await clearEnRoute(familyId, user.uid)
    } catch {
      toast.error('Could not update your status')
    }
  }

  // NEW: post-join hydration via query param
  useEffect(() => {
    if (joined === '1') {
      const fam = joinedFamily || getLastSelectedFamily()
      if (fam) {
        router.replace('/(main)')
        setHydrationKey(k => k + 1)
        router.refresh()
        toast.success('Joined successfully')
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, joinedFamily])

  // NEW: post-join hydration via event
  useEffect(() => {
    const off = onJoined(() => {
      setHydrationKey(k => k + 1)
      router.refresh()
      toast.success('Family joined')
    })
    return off
  }, [router])

  if (authLoading) {
    return (
      <main className="flex items-center justify-center h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </main>
    )
  }

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const greetEmoji = hour < 12 ? '☀️' : hour < 18 ? '🌤️' : '🌙'
  const firstName = (user?.name ?? '').trim().split(' ')[0] || ''

  // Members with auto-presence on that have a last-known location → map pins.
  // Members with auto-presence on that have a RECENT last-known location → map pins.
  const FRESH_MS = 3 * 60 * 60 * 1000 // 3 hours
  const mapMembers: PresenceMember[] = membersLive.flatMap((m) => {
    const lg = (m as any).lastGeo
    const lat = lg?.lat, lng = lg?.lng
    if (typeof lat !== 'number' || typeof lng !== 'number') return []
    const ts = lg?.updatedAt?.toDate
      ? lg.updatedAt.toDate().getTime()
      : typeof lg?.updatedAt?.seconds === 'number'
        ? lg.updatedAt.seconds * 1000
        : null
    // Hide only confidently-stale fixes (e.g. months-old). A null timestamp means
    // the server write is still pending (the freshest case) — keep it.
    if (ts != null && Date.now() - ts > FRESH_MS) return []
    const pm: PresenceMember = {
      uid: m.uid as string,
      name: ((m as any).name as string) ?? 'Member',
      photoURL: ((m as any).photoURL as string | null) ?? null,
      status: normalizeMemberStatus(m) as 'home' | 'away' | null,
      lat,
      lng,
      updatedAt: ts,
    }
    return [pm]
  })

  const locateMember = (uid: string, name: string) => {
    const pin = mapMembers.find((p) => p.uid === uid)
    if (!pin) {
      toast(`No recent location for ${name}`)
      return
    }
    setFocusTarget({ lat: pin.lat, lng: pin.lng })
    mapCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const meOnMap = mapMembers.some((p) => p.uid === user?.uid)
  const showMeOnMap = () => {
    if (!user?.uid || !familyId) return
    if (!('geolocation' in navigator)) {
      toast.error('Location not supported on this device')
      return
    }
    toast('Getting your location…')
    setLocMsg('Getting your location…')
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude, accuracy } = pos.coords
        try {
          await setDoc(
            doc(firestore, 'families', familyId, 'members', user.uid),
            {
              lastGeo: { lat: latitude, lng: longitude, accuracy: accuracy ?? null, updatedAt: serverTimestamp() },
              uid: user.uid,
            },
            { merge: true }
          )
          setFocusTarget({ lat: latitude, lng: longitude })
          setLocMsg(`On map ✓ — ${latitude.toFixed(4)}, ${longitude.toFixed(4)} (±${Math.round(accuracy ?? 0)}m)`)
          toast.success('You’re on the map 📍')
        } catch (e) {
          const m = e instanceof Error ? e.message : 'unknown error'
          setLocMsg(`Save failed: ${m}`)
          toast.error(`Couldn’t save location: ${m}`)
        }
      },
      (err) => {
        const msg =
          err.code === err.PERMISSION_DENIED
            ? 'Location is off for Safari — Settings → Privacy → Location Services → Safari Websites → While Using'
            : err.code === err.POSITION_UNAVAILABLE
              ? 'Location unavailable right now — try again (better signal helps)'
              : err.code === err.TIMEOUT
                ? 'Location timed out — tap again'
                : 'Could not get your location'
        setLocMsg(`${msg} (code ${err.code})`)
        toast.error(`${msg} (code ${err.code})`)
      },
      { enableHighAccuracy: false, maximumAge: 30_000, timeout: 15_000 }
    )
  }

  return (
    <>
      {offlineBanner}
      <div className="bg-gradient-to-b from-amber-50/70 via-background to-background dark:from-amber-950/10">
      <main className={`max-w-2xl mx-auto p-5 sm:p-6 space-y-5 ios-scroll ${isIOS ? 'ios-screen ios-stack' : ''}`}>
        <CreateFamilyModal open={createOpen} onOpenChange={setCreateOpen} />
        <JoinFamilyModal open={joinOpen} onOpenChange={setJoinOpen} />

        {/* Greeting */}
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        >
          <h1 className="text-2xl font-bold tracking-tight truncate">
            {greeting}{firstName ? `, ${firstName}` : ''} {greetEmoji}
          </h1>
          <p className="text-sm text-muted-foreground">Welcome home 🏡</p>
          <Link
            href="/settings#default-family"
            className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="inline-flex h-2 w-2 rounded-full bg-primary/70" />
            {families.find((f) => f.id === familyId)?.name ?? familyName ?? (familyId ? 'Loading…' : 'No family set')}
            <span className="underline underline-offset-2">change</span>
          </Link>
        </motion.div>

        <Card className="rounded-3xl border-border/60 shadow-sm shadow-black/[0.03]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2.5">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600">
                <HomeIcon className="h-4 w-4" />
              </span>
              Who&apos;s home
            </CardTitle>
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
            ) : (!familyId && families.length === 0) ? (
              <div className="flex flex-col items-center text-center space-y-3 py-4">
                <div className="text-3xl">🏡</div>
                <p className="text-sm text-muted-foreground">
                  No family yet — create one or join with an invite link.
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

                const homeBanner = hasHomeLocation === false ? (
                  <div className="flex items-start gap-3 p-3 border rounded-2xl bg-muted/30 mb-2">
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

                const presenceMap = new Map(
                  members.map((m) => {
                    const isMe = Boolean(user?.uid && m.uid === user.uid)
                    return [
                      m.uid,
                      normalizeMember(m, { autoPresenceOverride: isMe && userAutoPresence === true }),
                    ]
                  })
                )

                const myWatch = (membersLive.find((mm) => mm.uid === user?.uid)?.watchHome ?? {}) as Record<string, boolean>
                const homeCount = members.filter((m) => presenceMap.get(m.uid)?.status === 'home').length
                const outCount = members.filter((m) => presenceMap.get(m.uid)?.status === 'away').length

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
                      <div className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-dashed py-6 text-center">
                        <div className="text-2xl">🏡</div>
                        <p className="text-sm text-muted-foreground">No members yet.</p>
                        <p className="text-xs text-muted-foreground">Invite family from the Family tab.</p>
                      </div>
                    </>
                  )
                }

                const activity = members
                  .map((m) => {
                    const p = presenceMap.get(m.uid)!
                    return { uid: p.uid, name: p.name, status: p.status ?? 'unknown', ts: p.updatedAt?.getTime() ?? null }
                  })
                  .filter((x) => x.ts)
                  .sort((a, b) => (b.ts! - a.ts!))
                  .slice(0, 3)

                return (
                  <TooltipProvider>
                    <div className="space-y-2">
                      {homeBanner}

                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                          🏠 {homeCount} home
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                          🚪 {outCount} out
                        </span>
                      </div>

                      <div className="space-y-2">
                        <AnimatePresence>
                          {members.map((m) => {
                            const presence = presenceMap.get(m.uid)!
                            const updatedDate = presence.updatedAt
                            const initials = (presence.name ?? '')
                              .split(' ')
                              .map((s: string) => s[0])
                              .join('')
                              .slice(0, 2)
                              .toUpperCase()

                            const isCurrentUser = m.uid === user?.uid
                            const watchingMember = !!myWatch[m.uid as string]

                            return (
                              <motion.div
                                key={m.uid}
                                layout
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 8 }}
                                transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                                className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2 px-2.5 py-2 rounded-2xl transition-colors ${isCurrentUser ? 'bg-primary/5 ring-1 ring-primary/10' : 'hover:bg-muted/40'}`}
                              >
                                <div className="flex items-center gap-3 min-h-[48px]">
                                  {presence.photoURL ? (
                                    <img src={presence.photoURL} alt={presence.name} className="h-9 w-9 rounded-full object-cover ring-2 ring-background shadow-sm" />
                                  ) : (
                                    <div className="h-9 w-9 rounded-full bg-gradient-to-br from-amber-200/70 to-orange-100/40 text-amber-700 dark:from-amber-900/40 dark:to-amber-900/10 dark:text-amber-300 flex items-center justify-center text-xs font-semibold ring-2 ring-background shadow-sm">
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

                                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
                                      <span className={`capitalize rounded-full px-2 py-0.5 font-medium ${presence.status === 'home' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>{presence.status ?? 'unknown'}</span>
                                      {presence.enRoute && (
                                        <span className="inline-flex items-center gap-1 text-sky-600 font-medium">
                                          <Truck className="w-3 h-3" /> on the way{presence.etaMinutes != null ? ` (~${presence.etaMinutes}m)` : ''}
                                        </span>
                                      )}
                                      {presence.source && (<span>• {presence.source === 'geo' ? 'Auto' : 'Manual'}</span>)}
                                      {updatedDate && <span>• {formatDistanceToNow(updatedDate, { addSuffix: true })}</span>}
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2">
                                  <motion.button
                                    type="button"
                                    whileTap={{ scale: 0.82 }}
                                    transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                                    onClick={() => locateMember(m.uid as string, presence.name)}
                                    aria-label={`Show ${presence.name} on the map`}
                                    title="Show on map"
                                    className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                  >
                                    <MapPin className="h-4 w-4" />
                                  </motion.button>
                                  {!isCurrentUser && (
                                    <motion.button
                                      type="button"
                                      whileTap={{ scale: 0.82 }}
                                      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                                      onClick={() => toggleWatch(m.uid as string)}
                                      aria-label={watchingMember ? `Stop home alerts for ${presence.name}` : `Notify me when ${presence.name} gets home`}
                                      title={watchingMember ? 'Watching — you’ll be alerted when they get home' : 'Notify me when they get home'}
                                      className={`rounded-full p-2 transition-colors ${watchingMember ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                                    >
                                      {watchingMember ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                                    </motion.button>
                                  )}
                                </div>
                              </motion.div>
                            )
                          })}
                        </AnimatePresence>
                      </div>

                      {activity.length > 0 && (
                        <div className="mt-3 p-3 bg-muted/40 rounded-2xl text-sm">
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

        {familyId && homeLoc && (
          <div ref={mapCardRef}>
            <Card className="rounded-3xl border-border/60 shadow-sm shadow-black/[0.03]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2.5">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-600">
                    <MapPin className="h-4 w-4" />
                  </span>
                  Family map
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
                <PresenceMap home={homeLoc} radius={homeRadius} members={mapMembers} focus={focusTarget} />
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    Home 🏡 and recent spots. Tap 📍 on a member to fly there. Locations refresh while the app is open.
                  </p>
                  <Button type="button" size="sm" variant="outline" className="rounded-full shrink-0" onClick={showMeOnMap}>
                    <MapPin className="h-4 w-4 mr-1.5" /> {meOnMap ? 'Update me' : 'Show me'}
                  </Button>
                </div>
                {locMsg && (
                  <p className="rounded-lg bg-muted px-3 py-2 text-[11px] leading-snug text-muted-foreground">
                    {locMsg} · pins on map: {mapMembers.length}{meOnMap ? ' · you’re shown ✓' : ''}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        <Card className="rounded-3xl border-border/60 shadow-sm shadow-black/[0.03]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2.5">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-600">
                <Truck className="h-4 w-4" />
              </span>
              Deliveries today
            </CardTitle>
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

        {familyId && (
          <Link href="/shopping" className="block">
            <motion.div whileTap={{ scale: 0.985 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }}>
              <Card className="rounded-3xl border-border/60 shadow-sm shadow-black/[0.03] transition-colors hover:bg-muted/40">
                <CardContent className="flex items-center justify-between py-4">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600">
                      <ShoppingCart className="h-5 w-5" />
                    </span>
                    <div>
                      <div className="font-medium">Shopping list</div>
                      <div className="text-xs text-muted-foreground">Shared family errands &amp; groceries</div>
                    </div>
                  </div>
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground">→</span>
                </CardContent>
              </Card>
            </motion.div>
          </Link>
        )}

        {/* Your status */}
        <Card className="rounded-3xl border-border/60 shadow-sm shadow-black/[0.03]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2.5">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <MapPin className="h-4 w-4" />
              </span>
              Your status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(presenceLoading || loadingFamilies) ? (
              <Skeleton className="h-11 w-full rounded-md" />
            ) : myStatusSource === 'geo' ? (
              <>
                <div className="flex items-center justify-between gap-3 rounded-2xl border bg-muted/30 p-3">
                  <div className="flex items-center gap-3">
                    {isHome ? (
                      <HomeIcon className="h-5 w-5 text-green-600" />
                    ) : (
                      <DoorOpen className="h-5 w-5 text-muted-foreground" />
                    )}
                    <div>
                      <div className="font-medium">{isHome ? "You're home" : "You're out"}</div>
                      <div className="text-xs text-muted-foreground">Set automatically from your location</div>
                    </div>
                  </div>
                  <span className="text-[11px] px-2 py-0.5 rounded-full border bg-background text-muted-foreground">Auto</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Prefer to set it yourself? Turn off auto-presence in{' '}
                  <Link href="/settings#default-family" className="underline">Settings</Link>.
                </p>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                <Button type="button" variant={isHome ? 'default' : 'outline'} onClick={() => handlePresenceChange('home')} className="h-12 rounded-2xl text-base transition-transform active:scale-[0.97]">
                  <span className="mr-2">🏠</span> I’m home
                </Button>
                <Button type="button" variant={isHome === false ? 'default' : 'outline'} onClick={() => handlePresenceChange('away')} className="h-12 rounded-2xl text-base transition-transform active:scale-[0.97]">
                  <span className="mr-2">👋</span> I’m out
                </Button>
              </div>
            )}

            {/* On my way home — secondary action, only when not currently home */}
            {!presenceLoading && !loadingFamilies && familyId && !isHome && (
              myPresence?.enRoute ? (
                <div className="flex items-center justify-between gap-3 rounded-2xl border bg-sky-50/60 dark:bg-sky-950/20 p-3">
                  <div className="flex items-center gap-2 text-sm min-w-0">
                    <Truck className="w-4 h-4 text-sky-600 shrink-0" />
                    <span className="font-medium">On the way home</span>
                    {myPresence.etaMinutes != null && (
                      <span className="text-muted-foreground truncate">• ~{myPresence.etaMinutes} min</span>
                    )}
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={handleClearEnRoute} className="shrink-0">
                    <X className="w-4 h-4 mr-1" /> Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1">
                  <div className="flex items-center gap-2 text-sm flex-1 min-w-0 text-muted-foreground">
                    <Truck className="w-4 h-4 shrink-0" />
                    <span className="truncate">Heading home? Let your family know.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={etaChoice ?? ''}
                      onChange={(e) => setEtaChoice(e.target.value === '' ? null : Number(e.target.value))}
                      className="h-9 border border-input bg-background text-foreground px-2 rounded-md text-sm"
                      aria-label="Estimated time to arrival"
                    >
                      {ETA_OPTIONS.map((o) => (
                        <option key={o.label} value={o.minutes ?? ''}>{o.label}</option>
                      ))}
                    </select>
                    <Button type="button" onClick={handleSetEnRoute} className="h-9">
                      <Truck className="w-4 h-4 mr-2" /> On my way
                    </Button>
                  </div>
                </div>
              )
            )}
          </CardContent>
        </Card>
      </main>
      </div>
    </>
  )
}
