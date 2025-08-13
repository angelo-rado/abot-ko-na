'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { HomeIcon, UsersIcon, Loader2, Plus, ChevronRight, CalendarDays } from 'lucide-react'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  Timestamp,
} from 'firebase/firestore'
import { formatDistanceToNow } from 'date-fns'

import { useAuth } from '@/lib/useAuth'
import { firestore } from '@/lib/firebase'
import { useOnlineStatus } from '@/lib/hooks/useOnlinestatus'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import JoinFamilyModal from '@/app/components/JoinFamilyModal'
import CreateFamilyModal from '@/app/components/CreateFamilyModal'

type Family = {
  id: string
  name?: string
  createdBy?: string
  createdAt?: Date | null
  memberCount?: number
}

const LOCAL_FAMILY_KEY = 'abot:selectedFamily'

function toDate(v: any): Date | null {
  if (!v) return null
  if (v instanceof Date) return v
  if (typeof v?.toDate === 'function') return v.toDate()
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

export default function FamilyPickerPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const search = useSearchParams()
  const isOnline = useOnlineStatus()
  const joinedFlag = useMemo(() => search.get('joined') === '1', [search])

  const [owned, setOwned] = useState<Family[] | undefined>()
  const [joined, setJoined] = useState<Family[] | undefined>()
  const [loading, setLoading] = useState(true)
  const [joinOpen, setJoinOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const cleanedJoinedToast = useRef(false)

  // toast once on successful join
  useEffect(() => {
    if (cleanedJoinedToast.current) return
    if (joinedFlag) {
      toast.success('Joined family!')
      const url = new URL(window.location.href)
      url.searchParams.delete('joined')
      router.replace(url.toString(), { scroll: false })
      cleanedJoinedToast.current = true
    }
  }, [joinedFlag, router])

  // load "owned" families
  useEffect(() => {
    if (authLoading || !user?.uid) return
    const q = query(collection(firestore, 'families'), where('createdBy', '==', user.uid))
    const unsub = onSnapshot(q, async (snap) => {
      const base: Family[] = snap.docs.map(d => {
        const data = d.data() as any
        return {
          id: d.id,
          name: typeof data?.name === 'string' ? data.name : undefined,
          createdBy: typeof data?.createdBy === 'string' ? data.createdBy : undefined,
          createdAt: toDate(data?.createdAt ?? data?.created_on ?? data?.created_at) // tolerate different fields
        }
      })
      setOwned(base)

      // hydrate member counts
      try {
        const counts = await Promise.all(base.map(async f => {
          const col = collection(firestore, 'families', f.id, 'members')
          const s = await getDocs(col)
          return { id: f.id, memberCount: s.size }
        }))
        setOwned(prev => (prev ?? []).map(f => {
          const c = counts.find(x => x.id === f.id)?.memberCount
          return { ...f, memberCount: c ?? f.memberCount }
        }))
      } catch {}
    }, (err) => {
      console.error('[family] owned onSnapshot error', err)
      toast.error('Failed to load your families.')
      setOwned([])
    })
    return () => unsub()
  }, [authLoading, user?.uid])

  // load "joined" families via users/{uid}.joinedFamilies
  useEffect(() => {
    if (authLoading || !user?.uid) return
    const userRef = doc(firestore, 'users', user.uid)
    const unsub = onSnapshot(userRef, async (snap) => {
      try {
        const data = snap.data() as any
        const ids: string[] = Array.isArray(data?.joinedFamilies) ? data.joinedFamilies : []
        if (ids.length === 0) {
          setJoined([])
          setLoading(false)
          return
        }
        const families: Family[] = await Promise.all(ids.map(async (fid) => {
          try {
            const fSnap = await getDoc(doc(firestore, 'families', fid))
            if (!fSnap.exists()) return null
            const fData = fSnap.data() as any
            return {
              id: fSnap.id,
              name: typeof fData?.name === 'string' ? fData.name : undefined,
              createdBy: typeof fData?.createdBy === 'string' ? fData.createdBy : undefined,
              createdAt: toDate(fData?.createdAt ?? fData?.created_on ?? fData?.created_at)
            }
          } catch (e) {
            console.warn('[family] failed to hydrate family', fid, e)
            return null
          }
        })).then(xs => xs.filter(Boolean) as Family[])
        setJoined(families)

        // hydrate member counts
        try {
          const counts = await Promise.all(families.map(async f => {
            const col = collection(firestore, 'families', f.id, 'members')
            const s = await getDocs(col)
            return { id: f.id, memberCount: s.size }
          }))
          setJoined(prev => (prev ?? []).map(f => {
            const c = counts.find(x => x.id === f.id)?.memberCount
            return { ...f, memberCount: c ?? f.memberCount }
          }))
        } catch {}
      } catch (e) {
        console.error('[family] users doc hydrate failed', e)
        setJoined([])
      } finally {
        setLoading(false)
      }
    }, (err) => {
      console.error('[family] users doc listen failed', err)
      setJoined([])
      setLoading(false)
    })
    return () => unsub()
  }, [authLoading, user?.uid])

  const renderFamilyCard = (f: Family) => {
    const created = f.createdAt ? formatDistanceToNow(f.createdAt, { addSuffix: true }) : null
    const isOwner = f.createdBy === user?.uid
    return (
      <motion.div
        key={f.id}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      >
        <Card
          role="button"
          tabIndex={0}
          aria-label={`Open ${f.name || 'family'}`}
          className="group hover:shadow-md transition-shadow cursor-pointer"
          onClick={() => {
            localStorage.setItem(LOCAL_FAMILY_KEY, f.id)
            router.push(`/family/${f.id}`)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              localStorage.setItem(LOCAL_FAMILY_KEY, f.id)
              router.push(`/family/${f.id}`)
            }
          }}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div className="min-w-0">
              <CardTitle className="text-base font-semibold truncate">
                {f.name || 'Untitled Family'}
              </CardTitle>
              <div className="mt-1 text-xs text-muted-foreground flex items-center gap-3">
                {typeof f.memberCount === 'number' && (
                  <span className="inline-flex items-center gap-1">
                    <UsersIcon className="w-3.5 h-3.5" />
                    {f.memberCount} {f.memberCount === 1 ? 'member' : 'members'}
                  </span>
                )}
                {created && (
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="w-3.5 h-3.5" />
                    {created}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{isOwner ? 'Owner' : 'Member'}</Badge>
              <ChevronRight className="w-5 h-5 opacity-60 group-hover:opacity-100 transition-opacity" />
            </div>
          </CardHeader>
        </Card>
      </motion.div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Your Families</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setJoinOpen(true)}>Join</Button>
          <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-1" /> Create</Button>
        </div>
      </div>

      <Tabs defaultValue="owned" className="w-full">
        <TabsList className="grid grid-cols-2">
          <TabsTrigger value="owned" className="flex items-center gap-2"><HomeIcon className="w-4 h-4" /> Owned</TabsTrigger>
          <TabsTrigger value="joined" className="flex items-center gap-2"><UsersIcon className="w-4 h-4" /> Joined</TabsTrigger>
        </TabsList>

        <TabsContent value="owned" className="mt-4">
          {authLoading || loading ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
          ) : (owned && owned.length > 0) ? (
            <AnimatePresence initial={false}>
              {owned.map(renderFamilyCard)}
            </AnimatePresence>
          ) : (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                You haven’t created a family yet.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="joined" className="mt-4">
          {authLoading || loading ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
          ) : (joined && joined.length > 0) ? (
            <AnimatePresence initial={false}>
              {joined
                ?.filter(f => f.createdBy !== user?.uid)
                .map(renderFamilyCard)}
            </AnimatePresence>
          ) : (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                You haven’t joined any families yet.
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <JoinFamilyModal open={joinOpen} onOpenChange={setJoinOpen} />
      <CreateFamilyModal open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
