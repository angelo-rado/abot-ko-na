/* eslint-disable */
'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { HomeIcon, UsersIcon, Loader2, Plus, ChevronRight, CalendarDays } from 'lucide-react'
import {
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore'
import { formatDistanceToNow } from 'date-fns'

import { useAuth } from '@/lib/useAuth'
import { firestore } from '@/lib/firebase'
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
  const joinedFlag = search.get('joined') === '1'

  const cleanedJoinedToast = useRef<boolean>(false)

  const [families, setFamilies] = useState<Family[]>([])
  const [loading, setLoading] = useState(true)
  const [joinOpen, setJoinOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  // one-time “joined!” toast + URL cleanup
  useEffect(() => {
    if (cleanedJoinedToast.current) return
    if (joinedFlag && typeof window !== 'undefined') {
      toast.success('Joined family!')
      const url = new URL(window.location.href)
      url.searchParams.delete('joined')
      router.replace(url.toString(), { scroll: false })
      cleanedJoinedToast.current = true
    }
  }, [joinedFlag, router])

  // Authoritative membership query:
  // families where array field `members` contains my UID
  useEffect(() => {
    if (authLoading || !user?.uid) return
    setLoading(true)

    const qFamilies = query(
      collection(firestore, 'families'),
      where('members', 'array-contains', user.uid)
    )

    const unsub = onSnapshot(
      qFamilies,
      async (snap) => {
        try {
          const base: Family[] = snap.docs.map((d) => {
            const data = d.data() as any
            return {
              id: d.id,
              name: typeof data?.name === 'string' ? data.name : undefined,
              createdBy: typeof data?.createdBy === 'string' ? data.createdBy : undefined,
              createdAt: toDate(data?.createdAt ?? data?.created_on ?? data?.created_at),
            }
          })

          // hydrate member counts (best-effort)
          const withCounts = await Promise.all(
            base.map(async (f) => {
              try {
                const memSnap = await getDocs(collection(firestore, 'families', f.id, 'members'))
                return { ...f, memberCount: memSnap.size }
              } catch {
                return f
              }
            })
          )

          // sort: owned first by name, then joined by name
          withCounts.sort((a, b) => {
            const aOwned = a.createdBy === user.uid
            const bOwned = b.createdBy === user.uid
            if (aOwned !== bOwned) return aOwned ? -1 : 1
            return (a.name || '').localeCompare(b.name || '')
          })

          setFamilies(withCounts)
        } finally {
          setLoading(false)
        }
      },
      (err) => {
        console.error('[family] membership onSnapshot error', err)
        toast.error('Failed to load your families.')
        setFamilies([])
        setLoading(false)
      }
    )

    return () => unsub()
  }, [authLoading, user?.uid])

  const owned = families.filter((f) => f.createdBy === user?.uid)
  const joined = families.filter((f) => f.createdBy !== user?.uid)

  // ✅ Navigate to family page (do NOT set default here; Settings controls default)
  const goToFamily = useCallback(
    async (fid: string) => {
      router.push(`/family/${fid}`)
    },
    [router]
  )

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
          onClick={() => goToFamily(f.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              goToFamily(f.id)
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
          ) : owned.length > 0 ? (
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
          ) : joined.length > 0 ? (
            <AnimatePresence initial={false}>
              {joined.map(renderFamilyCard)}
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

