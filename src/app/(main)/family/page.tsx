'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  getDoc,
} from 'firebase/firestore'
import Link from 'next/link'
import {
  Button,
  buttonVariants,
} from '@/components/ui/button'
import {
  Card,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { PlusIcon, HomeIcon, UsersIcon, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

import { firestore } from '@/lib/firebase'
import { useAuth } from '@/lib/useAuth'
import FamilyCreatedSuccess from '@/app/components/FamilyCreatedSuccess'
import CreateFamilyModal from '@/app/components/CreateFamilyModal'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { useOnlineStatus } from '@/lib/hooks/useOnlinestatus'

type Family = {
  id: string
  name: string
  createdBy: string
  memberCount?: number
  [k: string]: any
}

export default function FamilyPickerPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [ownedFamilies, setOwnedFamilies] = useState<Family[]>([])
  const [joinedFamilies, setJoinedFamilies] = useState<Family[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const createdFamilyId = searchParams.get('created')
  const [createdFamily, setCreatedFamily] = useState<Family | null>(null)

  // map of familyId => unsubscribe for members snapshot (so we can keep live member counts)
  const memberUnsubsRef = useRef<Map<string, () => void>>(new Map())
  const lastSeenCreatedId = useRef<string | null>(null)
  const isOnline = useOnlineStatus()
    if (!isOnline) {
      return <p className="text-center text-red-500">You're offline — cached content only.</p>
    }

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/')
    }
  }, [authLoading, user, router])

  useEffect(() => {
    if (!user) {
      setOwnedFamilies([])
      setJoinedFamilies([])
      setLoading(false)
      return
    }

    setLoading(true)

    // Owned families listener
    const ownedQ = query(
      collection(firestore, 'families'),
      where('createdBy', '==', user.uid)
    )
    const unsubOwned = onSnapshot(ownedQ, (snap) => {
      const families = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
      // Attach live member counts for owned families
      families.forEach((f: Family) => ensureMemberCountListener(f.id))
      setOwnedFamilies(families)
      setLoading(false)
    }, (err) => {
      console.warn('owned families snapshot error', err)
      setOwnedFamilies([])
      setLoading(false)
    })

    // Joined families listener (array-contains). It will also include owned families,
    // so we filter owned out when rendering the joined tab.
    const joinedQ = query(
      collection(firestore, 'families'),
      where('members', 'array-contains', user.uid)
    )
    const unsubJoined = onSnapshot(joinedQ, (snap) => {
      const families = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
      // Attach member-count listeners and then update joined state (owner will be filtered out in UI)
      families.forEach((f: Family) => ensureMemberCountListener(f.id))
      setJoinedFamilies(families)
      setLoading(false)
    }, (err) => {
      console.warn('joined families snapshot error', err)
      setJoinedFamilies([])
      setLoading(false)
    })

    // If createdFamilyId present, watch it once and clear param
    let unsubCreated: (() => void) | undefined

    if (createdFamilyId && createdFamilyId !== lastSeenCreatedId.current) {
      const createdRef = doc(firestore, 'families', createdFamilyId)
      unsubCreated = onSnapshot(
        createdRef,
        (snap) => {
          if (snap.exists()) {
            const data = { id: snap.id, ...(snap.data() as any) }
            setCreatedFamily(data)
            lastSeenCreatedId.current = data.id
          } else {
            setCreatedFamily(null)
          }

          // Remove query param after use
          const newParams = new URLSearchParams(searchParams.toString())
          newParams.delete('created')
          router.replace(`/family?${newParams.toString()}`, { scroll: false })
        },
        (err) => {
          console.warn('created family snapshot error', err)
        }
      )
    }


    return () => {
      unsubOwned()
      unsubJoined()
      if (unsubCreated) unsubCreated()
      // cleanup member listeners
      memberUnsubsRef.current.forEach((u) => u())
      memberUnsubsRef.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, createdFamilyId])

  // Ensure we have exactly one members-subcollection listener per family id to track the count
  const ensureMemberCountListener = async (familyId: string) => {
    if (memberUnsubsRef.current.has(familyId)) return

    try {
      const membersRef = collection(firestore, 'families', familyId, 'members')
      const unsub = onSnapshot(membersRef, (snap) => {
        // update ownedFamilies / joinedFamilies with latest count
        setOwnedFamilies((prev) => prev.map((f) => (f.id === familyId ? ({ ...f, memberCount: snap.size }) : f)))
        setJoinedFamilies((prev) => prev.map((f) => (f.id === familyId ? ({ ...f, memberCount: snap.size }) : f)))
      }, (err) => {
        console.warn('member subcollection snapshot failed for', familyId, err)
      })

      memberUnsubsRef.current.set(familyId, unsub)
    } catch (err) {
      console.warn('Failed to attach member count listener for', familyId, err)
    }
  }

  const renderSkeleton = () => (
    <>
      {[...Array(2)].map((_, i) => (
        <Card key={i}>
          <CardHeader className="flex flex-row justify-between items-center">
            <div className="flex items-center gap-2 w-full">
              <Skeleton className="h-5 w-5 rounded-full" />
              <Skeleton className="h-5 w-40" />
            </div>
          </CardHeader>
        </Card>
      ))}
    </>
  )

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!user) return null

  // helpers to render a family card; we ensure joined tab excludes owned families
  const renderFamilyCard = (family: Family) => (
    <motion.div
      key={family.id}
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="hover:shadow transition">
        <CardHeader className="flex flex-row justify-between items-center">
          <div className="flex items-center gap-2">
            {family.createdBy === user.uid ? (
              <HomeIcon className="w-5 h-5 text-muted-foreground" />
            ) : (
              <UsersIcon className="w-5 h-5 text-muted-foreground" />
            )}
            <CardTitle>{family.name}</CardTitle>
            <Badge variant="secondary">
              {family.createdBy === user.uid ? 'Owner' : 'Member'}
            </Badge>
            {typeof family.memberCount === 'number' && (
              <Badge variant="outline">{family.memberCount} member{family.memberCount !== 1 ? 's' : ''}</Badge>
            )}
          </div>
          <Link href={`/family/${family.id}`}>
            <Button variant="outline" size="sm">Open</Button>
          </Link>
        </CardHeader>
      </Card>
    </motion.div>
  )

  return (
    <div className="max-w-xl mx-auto px-4 pt-6 pb-20 relative">
      {createdFamily && (
        <div className="mb-4">
          <FamilyCreatedSuccess
            familyName={createdFamily.name}
            familyId={createdFamily.id}
          />
        </div>
      )}

      <div className="sticky top-0 z-10 bg-white pt-2 pb-4">
        <h1 className="text-xl font-semibold mb-4">Your Families</h1>
        <Tabs defaultValue="created">
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="created">Created</TabsTrigger>
            <TabsTrigger value="joined">Joined</TabsTrigger>
          </TabsList>

          <TabsContent value="created" className="space-y-2 pt-4">
            {loading ? renderSkeleton() : (
              <AnimatePresence>
                {ownedFamilies.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center">
                    You haven’t created any families yet.
                  </p>
                ) : ownedFamilies.map(renderFamilyCard)}
              </AnimatePresence>
            )}
          </TabsContent>

          <TabsContent value="joined" className="space-y-2 pt-4">
            {loading ? renderSkeleton() : (
              <AnimatePresence>
                {/* Filter out owned families from joined list so it doesn't duplicate */}
                {joinedFamilies.filter(f => f.createdBy !== user.uid).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center">
                    You haven’t joined any families yet.
                  </p>
                ) : joinedFamilies
                  .filter(f => f.createdBy !== user.uid)
                  .map(renderFamilyCard)}
              </AnimatePresence>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <CreateFamilyModal open={showModal} onOpenChange={setShowModal} />

      <button
        onClick={() => setShowModal(true)}
        className={cn(
          buttonVariants({ variant: 'default', size: 'icon' }),
          'rounded-full fixed bottom-6 right-6 shadow-lg bg-primary text-white hover:bg-primary/90'
        )}
      >
        <PlusIcon className="w-5 h-5" />
      </button>
    </div>
  )
}
