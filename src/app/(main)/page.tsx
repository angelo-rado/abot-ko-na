// src/app/(whatever)/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/lib/useAuth'
import {
  collection,
  doc,
  getDoc,
  query,
  where,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import FamilyPicker from '../components/FamilyPicker'
import { Loader2, Home, DoorOpen } from 'lucide-react'
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
import { useRouter } from 'next/navigation'
import CreateFamilyModal from '../components/CreateFamilyModal'
import JoinFamilyModal from '../components/JoinFamilyModal'
import HomeDeliveriesToday from '../components/HomeDeliveriesToday'
import Link from 'next/link'
import { HelpCircleHint } from '../components/HelpCircleHint'
import { useOnlineStatus } from '@/lib/hooks/useOnlinestatus'

const LOCAL_FAMILY_KEY = 'abot:selectedFamily'

export default function HomePage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const [familyId, setFamilyId] = useState<string | null>(null)
  const [families, setFamilies] = useState<{ id: string; name?: string }[]>([])
  const [familiesLoading, setFamiliesLoading] = useState(true)
  const [isHome, setIsHome] = useState<boolean | null>(null)
  const [justChangedStatusAt, setJustChangedStatusAt] = useState<number | null>(null)
  const [myStatusSource, setMyStatusSource] = useState<string | null>(null)
  const [presenceLoading, setPresenceLoading] = useState(true)


  // live members subscription state
  const [membersLive, setMembersLive] = useState<any[]>([])
  const [membersLoading, setMembersLoading] = useState(true)

  // Create / Join modals state
  const [createOpen, setCreateOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)

  // used to re-render every minute so "x minutes ago" ticks
  const [now, setNow] = useState(0)

  const isOnline = useOnlineStatus()
  if (!isOnline) {
    return <p className="text-center text-red-500">You're offline — cached content only.</p>
  }

  // --- NEW: initialize familyId early (localStorage -> user doc) so auto-presence can start fast ---
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      if (familyId) return

      // 1) try localStorage
      try {
        const stored = typeof window !== 'undefined' ? localStorage.getItem(LOCAL_FAMILY_KEY) : null
        if (stored) {
          console.debug('[HomePage:init] using familyId from localStorage', stored)
          setFamilyId(stored)
          return
        }
      } catch (err) {
        console.warn('[HomePage:init] localStorage read failed', err)
      }

      // 2) try user doc preferredFamily
      if (user?.uid) {
        try {
          const userRef = doc(firestore, 'users', user.uid)
          const snap = await getDoc(userRef)
          if (!cancelled && snap.exists()) {
            const data = snap.data() as Record<string, any>
            if (data?.preferredFamily) {
              console.debug('[HomePage:init] using preferredFamily from user doc', data.preferredFamily)
              setFamilyId(data.preferredFamily as string)
              try { localStorage.setItem(LOCAL_FAMILY_KEY, data.preferredFamily as string) } catch { }
              return
            }
          }
        } catch (err) {
          console.warn('[HomePage:init] Could not read preferredFamily during init', err)
        }
      }
      // otherwise: families onSnapshot will choose a fallback when it arrives
    }

    init()
    return () => { cancelled = true }
  }, [user?.uid]) // run on mount and whenever user becomes available
  // --- END NEW ---

  // call the family-aware auto presence hook after attempting early init
  useAutoPresence(familyId)

  // minute tick to update relative timestamps
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

  const selectFamily = async (id: string | null) => {
    setFamilyId(id)
    try {
      if (id) {
        localStorage.setItem(LOCAL_FAMILY_KEY, id)
      } else {
        localStorage.removeItem(LOCAL_FAMILY_KEY)
      }
    } catch (err) {
      console.warn('Could not persist selected family to localStorage', err)
    }

    try {
      if (user?.uid && id) {
        const userRef = doc(firestore, 'users', user.uid)
        await updateDoc(userRef, { preferredFamily: id }).catch(() => {
          return setDoc(userRef, { preferredFamily: id }, { merge: true })
        })
      }
    } catch (err) {
      console.warn('Could not persist preferredFamily to Firestore', err)
    }
  }

  // Load families (real-time)
  useEffect(() => {
    if (!user?.uid) {
      setFamilies([])
      setFamilyId(null)
      setFamiliesLoading(false)
      return
    }

    setFamiliesLoading(true)
    const familiesRef = collection(firestore, 'families')
    const q = query(familiesRef, where('members', 'array-contains', user.uid))

    const unsub = onSnapshot(
      q,
      async (snapshot) => {
        const fams = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))
        console.debug('[HomePage] families snapshot', fams.map(f => f.id))
        setFamilies(fams)

        // Validate current familyId against the new list and clear stale preference if needed
        if (familyId && !fams.some(f => f.id === familyId)) {
          console.warn('[HomePage] selected familyId is stale (not in families list). Clearing local preference and user doc:', familyId)
          try { localStorage.removeItem(LOCAL_FAMILY_KEY) } catch (e) { console.warn('[HomePage] localStorage remove failed', e) }

          // Best-effort: clear user's preferredFamily in Firestore so it doesn't keep getting restored
          (async () => {
            try {
              const userRef = doc(firestore, 'users', user.uid)
              await updateDoc(userRef, { preferredFamily: null }).catch(() => {
                return setDoc(userRef, { preferredFamily: null }, { merge: true })
              })
              console.debug('[HomePage] cleared users.preferredFamily for', user.uid)
            } catch (err) {
              console.warn('[HomePage] failed to clear users.preferredFamily (may be a security rule)', err)
            }
          })()
          // choose a fallback
          if (fams.length > 0) {
            setFamilyId(fams[0].id)
          } else {
            setFamilyId(null)
          }
        } else {
          // Determine preferred if not already set: localStorage -> user doc -> first family
          if (!familyId) {
            let preferred: string | null = null
            try { preferred = localStorage.getItem(LOCAL_FAMILY_KEY) } catch { }
            if (!preferred) {
              try {
                const userRef = doc(firestore, 'users', user.uid)
                const snap = await getDoc(userRef)
                if (snap.exists()) {
                  const data = snap.data() as Record<string, any>
                  if (data?.preferredFamily) {
                    preferred = data.preferredFamily as string
                    try { localStorage.setItem(LOCAL_FAMILY_KEY, preferred) } catch { }
                  }
                }
              } catch (err) {
                console.warn('Could not read preferredFamily from user doc', err)
              }
            }
            if (preferred && fams.some((f) => f.id === preferred)) {
              setFamilyId(preferred)
            } else if (fams.length > 0) {
              setFamilyId(fams[0].id)
            }
          }
        }

        setFamiliesLoading(false)
      },
      (err) => {
        console.warn('families onSnapshot error', err)
        setFamiliesLoading(false)
      }
    )

    return () => unsub()
    // familyId intentionally not a dep here to avoid flipping during snapshot updates
  }, [user?.uid, familyId])

  // Listen to preferredFamily changes on user doc (server-driven updates)
  useEffect(() => {
    if (!user?.uid) return
    const userRef = doc(firestore, 'users', user.uid)
    const unsub = onSnapshot(
      userRef,
      (snap) => {
        if (!snap.exists()) return
        const data = snap.data() as Record<string, any>
        const preferred: string | undefined = data?.preferredFamily
        if (preferred) {
          try { localStorage.setItem(LOCAL_FAMILY_KEY, preferred) } catch { }
          if (preferred !== familyId) {
            setFamilyId(preferred)
          }
        } else {
          try { localStorage.removeItem(LOCAL_FAMILY_KEY) } catch { }
        }
      },
      (err) => {
        console.warn('user doc snapshot error', err)
      }
    )
    return () => unsub()
  }, [user?.uid, familyId])

  // Validate selected family after families load
  useEffect(() => {
    if (!familiesLoading && families.length > 0) {
      if (!familyId || !families.some(f => f.id === familyId)) {
        const localPreferred = (() => { try { return localStorage.getItem(LOCAL_FAMILY_KEY) } catch { return null } })()
        if (localPreferred && families.some(f => f.id === localPreferred)) {
          setFamilyId(localPreferred)
        } else {
          setFamilyId(families[0].id)
        }
      }
    }
  }, [familiesLoading, families.length])

  // Ensure current user's profile is present in their members doc (run when user or family changes)
  useEffect(() => {
    if (!user?.uid || !familyId) return
    const ref = doc(firestore, 'families', familyId, 'members', user.uid)
    // best-effort; don't await
    setDoc(ref, {
      name: (user as any).name ?? 'Unknown',
      photoURL: (user as any).photoURL ?? null,
    }, { merge: true }).catch(err => {
      console.warn('Failed to ensure member profile fields', err)
    })
  }, [user?.uid, familyId])

  // Subscribe to the members collection for the selected family (live updates)
  useEffect(() => {
  if (!user?.uid || !familyId) {
    setMembersLive([])
    setMembersLoading(false)
    setPresenceLoading(false)
    return
  }

  const membersRef = collection(firestore, 'families', familyId, 'members')

  const unsub = onSnapshot(
    membersRef,
    (snapshot) => {
      if (!user?.uid) return // guard against logout race
      const docs = snapshot.docs.map((d) => ({ uid: d.id, ...(d.data() as any) }))
      setMembersLive(docs)
      setMembersLoading(false)
      setPresenceLoading(false)

      const me = docs.find((m) => m.uid === user.uid)
      if (me) {
        const isRecentChange = justChangedStatusAt && Date.now() - justChangedStatusAt < 1500
        if (!isRecentChange) {
          setIsHome(me.status === 'home')
        }
        setMyStatusSource(me.statusSource ?? me.source ?? me.status_source ?? null)
      }
    },
    (err) => {
      if (user?.uid) { // prevent error spam after logout
        console.warn('members collection snapshot error', err)
      }
      setMembersLive([])
      setMembersLoading(false)
      setPresenceLoading(false)
    }
  )

  return () => unsub()
}, [user?.uid, familyId, justChangedStatusAt])


  const handlePresenceChange = async (newStatus: 'home' | 'away') => {
    if (!user || !familyId) return

    const ref = doc(firestore, 'families', familyId, 'members', user.uid)

    await setDoc(ref, {
      status: newStatus,
      statusSource: 'manual',
      updatedAt: serverTimestamp(),
      name: (user as any).name ?? 'Unknown',
      photoURL: (user as any).photoURL ?? null,
    }, { merge: true })

    // optimistic update + debounce sync
    setIsHome(newStatus === 'home')
    setJustChangedStatusAt(Date.now())
  }


  function formatUpdatedAt(ts: Timestamp | Date | number | undefined) {
    if (!ts) return 'Unknown time'
    const date =
      ts instanceof Timestamp ? ts.toDate() :
        typeof ts === 'number' ? new Date(ts) :
          ts
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
    <main className="max-w-2xl mx-auto p-6 space-y-6">
      <CreateFamilyModal open={createOpen} onOpenChange={setCreateOpen} />
      <JoinFamilyModal open={joinOpen} onOpenChange={setJoinOpen} />

      <FamilyPicker
        familyId={familyId}
        onFamilyChange={(id) => selectFamily(id)}
        families={families}
        loading={familiesLoading}
      />

      {/* Who's Home Card */}
      <Card>
        <CardHeader>
          <CardTitle>Who's Home</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {presenceLoading || familiesLoading ? (
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
                <Button onClick={() => setCreateOpen(true)}>Create Family</Button>
                <Button variant="outline" onClick={() => setJoinOpen(true)}>Join Family</Button>
              </div>
            </div>
          ) : !familyId ? (
            <p className="text-muted-foreground text-sm">Select a family to see who's home.</p>
          ) : (
            // Render using the live members list
            (() => {
              const members = membersLive
              const loading = membersLoading

              // normalize presence fields and provide fallbacks (important!)
              const presenceMap = new Map(
                members.map((m) => {
                  // accept different possible field names written by other code paths
                  const statusSource = (m.statusSource ?? m.source ?? m.status_source) || null
                  const updatedAt = (m.updatedAt ?? m.updated_at ?? m.lastUpdated ?? null) as any
                  const photoURL = (m.photoURL ?? m.photo ?? null) as string | null
                  const name = (m.name ?? m.displayName ?? 'Unknown') as string


                  return [
                    m.uid,
                    {
                      status: m.status ?? null,
                      statusSource,
                      updatedAt,
                      photoURL,
                      name,
                    },
                  ]
                })
              )

              if (loading) {
                return (
                  <>
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
                return <p className="text-muted-foreground text-sm">No members yet.</p>
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
                              className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2 px-2 py-1 rounded-md ${isCurrentUser ? 'bg-muted/10' : ''
                                }`}
                            >
                              <div className="flex items-center gap-3 min-h-[48px]">
                                {presence.photoURL ? (
                                  <img
                                    src={presence.photoURL}
                                    alt={presence.name}
                                    className="h-8 w-8 rounded-full object-cover"
                                  />
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
                                          <motion.span
                                            key="home"
                                            initial={{ opacity: 0, scale: 0.85 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            exit={{ opacity: 0, scale: 0.85 }}
                                            transition={{ duration: 0.18 }}
                                            className="flex items-center text-green-600"
                                            title="home"
                                          >
                                            <Home className="w-4 h-4" />
                                          </motion.span>
                                        )}
                                        {presence.status === 'away' && (
                                          <motion.span
                                            key="away"
                                            initial={{ opacity: 0, scale: 0.85 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            exit={{ opacity: 0, scale: 0.85 }}
                                            transition={{ duration: 0.18 }}
                                            className="flex items-center text-gray-500"
                                            title="away"
                                          >
                                            <DoorOpen className="w-4 h-4" />
                                          </motion.span>
                                        )}
                                        {!presence.status && (
                                          <motion.span
                                            key="unknown"
                                            initial={{ opacity: 0, scale: 0.85 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            exit={{ opacity: 0, scale: 0.85 }}
                                            transition={{ duration: 0.18 }}
                                            className="inline-block h-2 w-2 rounded-full bg-gray-300"
                                            title="unknown"
                                          />
                                        )}
                                      </AnimatePresence>
                                    </div>
                                  </div>
                                  <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
                                    <span className="capitalize">{presence.status ?? 'unknown'}</span>
                                    {presence.statusSource && (
                                      <span>• {presence.statusSource === 'geo' ? 'Auto' : 'Manual'}</span>
                                    )}
                                    {updatedDate && <span>• {formatDistanceToNow(updatedDate, { addSuffix: true })}</span>}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                {/* Pill display */}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="text-[10px] px-2 py-0.5 rounded bg-muted text-muted-foreground border border-muted-foreground/10 cursor-default">
                                      {presence.statusSource === 'geo'
                                        ? 'Auto'
                                        : presence.statusSource === 'manual'
                                          ? 'Manual'
                                          : '—'}
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
                                <HelpCircleHint
                                  title={presence.statusSource === 'geo'
                                    ? 'Auto'
                                    : presence.statusSource === 'manual'
                                      ? 'Manual'
                                      : '—'}>
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
                                </HelpCircleHint>

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
                            <motion.li
                              key={a.uid}
                              layout
                              transition={{ duration: 0.25 }}
                              className="flex items-center justify-between"
                            >
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

      {/* Deliveries Today Card */}
      <Card>
        <CardHeader>
          <CardTitle>Deliveries Today</CardTitle>
        </CardHeader>
        <CardContent>
          {presenceLoading || familiesLoading ? (
            <>
              <Skeleton className="h-4 w-full mb-2" />
              <Skeleton className="h-4 w-5/6" />
            </>
          ) : (
            <HomeDeliveriesToday
              familyId={familyId}
              presenceLoading={presenceLoading}
              familiesLoading={familiesLoading}
              showAllUsers={true}
            />
          )}
        </CardContent>
      </Card>

      {/* Presence Buttons */}
      <div className="flex gap-4">
        {(presenceLoading || familiesLoading) ? (
          <>
            <Skeleton className="h-10 flex-1 rounded-md" />
            <Skeleton className="h-10 flex-1 rounded-md" />
          </>
        ) : (
          <>
            <div className="flex gap-4">
              {/* HOME button */}
              {myStatusSource === 'geo' ? (
                <span className="flex-1">
                  <Button
                    variant={isHome ? 'default' : 'outline'}
                    onClick={() => handlePresenceChange('home')}
                    className="w-full"
                    disabled={true}
                  >
                    <Home className="w-4 h-4 mr-2" />
                    I’m Home
                  </Button>
                </span>
              ) : (
                <Button
                  variant={isHome ? 'default' : 'outline'}
                  onClick={() => handlePresenceChange('home')}
                  className="flex-1"
                  disabled={presenceLoading || familiesLoading}
                >
                  <Home className="w-4 h-4 mr-2" />
                  I’m Home
                </Button>
              )}

              {/* AWAY button */}
              {myStatusSource === 'geo' ? (
                <><span className="flex-1">
                  <Button
                    variant={isHome === false ? 'default' : 'outline'}
                    onClick={() => handlePresenceChange('away')}
                    className="w-full"
                    disabled={true}
                  >
                    <DoorOpen className="w-4 h-4 mr-2" />
                    I’m Out
                  </Button>
                </span><HelpCircleHint title="Auto-set status">
                    <div className="space-y-2">
                      <p>Your presence is updated automatically using your location.</p>
                      <p>
                        To change this, visit{' '}
                        <Link href="/settings" className="text-blue-600 hover:underline">
                          Settings →
                        </Link>
                      </p>
                    </div>
                  </HelpCircleHint></>
              ) : (
                <Button
                  variant={isHome === false ? 'default' : 'outline'}
                  onClick={() => handlePresenceChange('away')}
                  className="flex-1"
                >
                  <DoorOpen className="w-4 h-4 mr-2" />
                  I’m Out
                </Button>
              )}
            </div>

          </>
        )}
      </div>
    </main>
  )
}
