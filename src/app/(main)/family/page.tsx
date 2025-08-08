'use client'

import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore'
import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import {
  HomeIcon,
  PlusIcon,
  UsersIcon,
  Loader2,
} from 'lucide-react'

import { useAuth } from '@/lib/useAuth'
import { firestore } from '@/lib/firebase'
import { useOnlineStatus } from '@/lib/hooks/useOnlinestatus'

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import FamilyCreatedSuccess from '@/app/components/FamilyCreatedSuccess'
import JoinFamilyModal from '@/app/components/JoinFamilyModal'
import CreateFamilyModal from '@/app/components/CreateFamilyModal'

type Family = {
  id: string
  name: string
  createdBy: string
  memberCount?: number
  [key: string]: any
}

export default function FamilyPickerPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const isOnline = useOnlineStatus()

  const [ownedFamilies, setOwnedFamilies] = useState<Family[]>([])
  const [joinedFamilies, setJoinedFamilies] = useState<Family[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [createdFamily, setCreatedFamily] = useState<Family | null>(null)

  const createdFamilyId = searchParams.get('created')
  const lastSeenCreatedId = useRef<string | null>(null)
  const memberUnsubsRef = useRef<Map<string, () => void>>(new Map())
  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login')
    }
  }, [authLoading, user, router])

  useEffect(() => {
    if (!user) return

    setLoading(true)

    const ownedQ = query(
      collection(firestore, 'families'),
      where('createdBy', '==', user.uid)
    )
    const joinedQ = query(
      collection(firestore, 'families'),
      where('members', 'array-contains', user.uid)
    )

    const unsubOwned = onSnapshot(ownedQ, (snap) => {
      const families = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
      families.forEach(f => ensureMemberCountListener(f.id))
      setOwnedFamilies(families)
      setLoading(false)
    })

    const unsubJoined = onSnapshot(joinedQ, (snap) => {
      const families = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
      families.forEach(f => ensureMemberCountListener(f.id))
      setJoinedFamilies(families)
      setLoading(false)
    })

    // Handle ?created
    let unsubCreated: (() => void) | undefined
    if (createdFamilyId && createdFamilyId !== lastSeenCreatedId.current) {
      const createdRef = doc(firestore, 'families', createdFamilyId)
      unsubCreated = onSnapshot(createdRef, (snap) => {
        if (snap.exists()) {
          const data = { id: snap.id, ...(snap.data() as any) }
          setCreatedFamily(data)
          lastSeenCreatedId.current = data.id
        }
        // Remove param
        const newParams = new URLSearchParams(searchParams.toString())
        newParams.delete('created')
        router.replace(`/family?${newParams.toString()}`, { scroll: false })
      })
    }

    return () => {
      unsubOwned()
      unsubJoined()
      if (unsubCreated) unsubCreated()
      memberUnsubsRef.current.forEach(u => u())
      memberUnsubsRef.current.clear()
    }
  }, [user?.uid, createdFamilyId, router, searchParams])

  const ensureMemberCountListener = (familyId: string) => {
    if (memberUnsubsRef.current.has(familyId)) return

    try {
      const membersRef = collection(firestore, 'families', familyId, 'members')
      const unsub = onSnapshot(membersRef, (snap) => {
        setOwnedFamilies(prev =>
          prev.map(f => f.id === familyId ? { ...f, memberCount: snap.size } : f)
        )
        setJoinedFamilies(prev =>
          prev.map(f => f.id === familyId ? { ...f, memberCount: snap.size } : f)
        )
      })
      memberUnsubsRef.current.set(familyId, unsub)
    } catch (err) {
      console.warn('member listener error:', err)
    }
  }

  const renderSkeleton = () =>
    [...Array(2)].map((_, i) => (
      <Card key={i} className="animate-pulse">
        <CardHeader className="flex gap-3 items-center">
          <Skeleton className="w-5 h-5 rounded-full" />
          <Skeleton className="w-32 h-5" />
        </CardHeader>
      </Card>
    ))

  const renderEmptyState = ({
    icon: Icon,
    title,
    description,
    cta,
  }: {
    icon: React.ReactNode
    title: string
    description: string
    cta: React.ReactNode
  }) => (
    <div className="text-center py-10 space-y-2">
      <div className="flex justify-center">{Icon}</div>
      <h3 className="text-md font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
      <div className="mt-4">{cta}</div>
    </div>
  )

  const renderFamilyCard = (family: Family) => (
    <motion.div
      key={family.id}
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="hover:shadow-sm transition">
        <CardHeader className="flex flex-row justify-between items-center">
          <div className="flex items-center gap-2">
            {family.createdBy === user?.uid ? (
              <HomeIcon className="w-5 h-5 text-muted-foreground" />
            ) : (
              <UsersIcon className="w-5 h-5 text-muted-foreground" />
            )}
            <CardTitle className="text-base font-medium">{family.name}</CardTitle>
            <Badge variant="secondary">
              {family.createdBy === user?.uid ? 'Owner' : 'Member'}
            </Badge>
            {typeof family.memberCount === 'number' && (
              <Badge variant="outline">
                {family.memberCount} member{family.memberCount !== 1 ? 's' : ''}
              </Badge>
            )}
          </div>
          <Link href={`/family/${family.id}`}>
            <Button variant="outline" size="sm">Open</Button>
          </Link>
        </CardHeader>
      </Card>
    </motion.div>
  )

  const [joinOpen, setJoinOpen] = useState(false)

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!user) return null

  return (

    <div className="max-w-xl mx-auto px-4 pt-6 pb-32 relative">
      <JoinFamilyModal open={joinOpen} onOpenChange={setJoinOpen} />
      {createdFamily && (
        <div className="mb-4">
          <FamilyCreatedSuccess
            familyName={createdFamily.name}
            familyId={createdFamily.id}
          />
        </div>
      )}

      <div className="sticky top-0 z-10 bg-white pt-2 pb-4">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-xl font-semibold">Your Families</h1>
          <Button size="sm" onClick={() => setShowModal(true)}>
            + Create
          </Button>
        </div>

        <Tabs defaultValue="created">
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="created">
              <HomeIcon className="w-4 h-4 mr-1" />
              Created
            </TabsTrigger>
            <TabsTrigger value="joined">
              <UsersIcon className="w-4 h-4 mr-1" />
              Joined
            </TabsTrigger>
          </TabsList>

          <CreateFamilyModal open={createOpen} onOpenChange={setCreateOpen} />

          <TabsContent value="created" className="space-y-2 pt-4">
            {loading ? renderSkeleton() : (
              <AnimatePresence>
                {ownedFamilies.length === 0
                  ? renderEmptyState({
                    icon: <HomeIcon className="w-6 h-6 text-muted-foreground" />,
                    title: 'No families yet',
                    description: 'Start by creating a new family group.',
                    cta: <Button onClick={() => setShowModal(true)}>Create Family</Button>,
                  })
                  : ownedFamilies.map(renderFamilyCard)}
              </AnimatePresence>
            )}
          </TabsContent>

          <TabsContent value="joined" className="space-y-2 pt-4">
            {loading ? renderSkeleton() : (
              <AnimatePresence>
                {joinedFamilies.filter(f => f.createdBy !== user.uid).length === 0
                  ? renderEmptyState({
                    icon: <UsersIcon className="w-6 h-6 text-muted-foreground" />,
                    title: 'Not part of any family yet',
                    description: 'Join one via an invite link.',
                    cta: <Button variant="outline" onClick={() => setJoinOpen(true)}>Join a Family</Button>,
                  })
                  : joinedFamilies
                    .filter(f => f.createdBy !== user.uid)
                    .map(renderFamilyCard)}
              </AnimatePresence>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
