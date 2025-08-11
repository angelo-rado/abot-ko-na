'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  doc,
  getDoc,
  updateDoc,
  arrayRemove,
  deleteDoc,
  collection,
  getDocs,
  setDoc,
  arrayUnion,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { useAuth } from '@/lib/useAuth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import InviteModal from '@/app/components/InviteModal'
import ManageFamilyDialog from '@/app/components/ManageFamilyDialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { motion, AnimatePresence } from 'framer-motion'
import { formatDistanceToNow } from 'date-fns'

type Member = {
  id: string
  name?: string
  email?: string
  photoURL?: string
  role?: string | null
  addedAt?: any
  __isOwner?: boolean
  // any other member-doc fields (status, statusSource, etc) allowed
  [k: string]: any
}

type Family = {
  id: string
  name?: string
  createdBy?: string
  createdAt?: any
  // other family fields allowed
  [k: string]: any
}

export default function FamilyDetailPage() {
  const { id } = useParams() as { id: string }
  const { user } = useAuth()
  const router = useRouter()

  const [family, setFamily] = useState<Family | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)

  const mountedRef = useRef(true)

  // modals + UI state
  const [isInviteOpen, setInviteOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [removeModalOpen, setRemoveModalOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null)
  const [leaveModalOpen, setLeaveModalOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // current user's role: 'owner' | 'admin' | 'member' | null/undefined
  const [myRole, setMyRole] = useState<string | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // convenience derived flags
  const isCreator = Boolean(user && family && user.uid === family.createdBy)
  const canManage = isCreator || myRole === 'admin'

  // Auto-close Manage dialog if privileges are lost while it's open
  useEffect(() => {
    if (manageOpen && !canManage) {
      setManageOpen(false)
      toast.info('Your admin access has been revoked')
    }
  }, [manageOpen, canManage])

  // Helper: fetch profile once (cached)
  const profileCacheRef = useRef<Record<string, { name?: string; email?: string; photoURL?: string }>>({})

  const fetchProfileOnce = async (uid: string) => {
    const cache = profileCacheRef.current
    if (cache[uid]) return cache[uid]
    try {
      const userSnap = await getDoc(doc(firestore, 'users', uid))
      if (userSnap.exists()) {
        const d = userSnap.data() as any
        const p = { name: d?.name ?? d?.displayName, email: d?.email, photoURL: d?.photoURL ?? d?.photo }
        cache[uid] = p
        return p
      }
    } catch (err) {
      console.warn('fetchProfileOnce failed', err)
    }
    cache[uid] = {}
    return cache[uid]
  }

  // Subscribe to family doc (for family-level fields) and members subcollection (real-time roles)
  useEffect(() => {
    if (!user) return
    setLoading(true)

    const familyRef = doc(firestore, "families", id)
    let hadFamily = false

    const unsubFamily = onSnapshot(
      familyRef,
      (snap) => {
        if (!mountedRef.current) return

        if (!snap.exists()) {
          if (hadFamily) {
            toast.error("Family not found")
            router.replace("/family")
          }
          return
        }

        hadFamily = true
        const f = { id: snap.id, ...(snap.data() as any) } as Family
        setFamily(f)

        // now that we know family exists, subscribe to members
        const membersRef = collection(firestore, "families", f.id, "members")

        const unsubMembers = onSnapshot(
          membersRef,
          async (msnap) => {
            if (!mountedRef.current) return

            const docs = msnap.docs.map((d) => {
              const data = d.data() as any
              return {
                id: d.id,
                role: data?.role ?? null,
                name: data?.name,
                email: data?.email,
                photoURL: data?.photoURL,
                addedAt: data?.addedAt ?? data?.createdAt ?? null,
                ...data,
              } as Member
            })

            // fill missing profile info
            const toFetch = docs.filter(m => !m.name && !m.photoURL && !m.email).map(m => m.id)
            await Promise.all(toFetch.map(async (uid) => {
              try {
                const p = await fetchProfileOnce(uid)
                const idx = docs.findIndex(x => x.id === uid)
                if (idx >= 0) docs[idx] = { ...docs[idx], ...p }
              } catch { }
            }))

            // sort with owner first
            const ownerId = f.createdBy ?? null
            const sorted = docs.slice().sort((a, b) => {
              if (a.id === ownerId) return -1
              if (b.id === ownerId) return 1
              return (a.name ?? "").localeCompare(b.name ?? "")
            }).map(m => ({ ...m, __isOwner: m.id === ownerId }))

            setMembers(sorted)

            const me = sorted.find(x => x.id === user.uid)
            if (me) {
              setMyRole(f.createdBy === user.uid ? "owner" : me.role ?? "member")
            } else {
              setMyRole(f.createdBy === user.uid ? "owner" : null)
            }

            setLoading(false)
          },
          (err) => {
            console.error("members onSnapshot error", err)
            toast.error("Failed to listen to members updates")
            setMembers([])
            setLoading(false)
          }
        )

        // cleanup members when family changes or component unmounts
        return () => unsubMembers()
      },
      (err) => {
        console.error("family onSnapshot error", err)
        toast.error("Failed to listen to family updates")
      }
    )

    return () => unsubFamily()
  }, [user, id])


  // Confirm remove modal opener
  const confirmRemove = (m: Member) => {
    setRemoveTarget(m)
    setRemoveModalOpen(true)
  }

  // Remove member (owner only)
  const handleRemoveMember = async () => {
    if (!removeTarget || !family || !user) return
    if (!isCreator) {
      toast.error('Only family owner can remove members')
      setRemoveModalOpen(false)
      return
    }
    if (removeTarget.id === family.createdBy) {
      toast.error('Cannot remove the family owner')
      setRemoveModalOpen(false)
      return
    }

    setBusy(true)
    try {
      // best-effort: remove from family.members array
      await updateDoc(doc(firestore, 'families', family.id), {
        members: arrayRemove(removeTarget.id),
      }).catch((err) => {
        console.warn('updateDoc arrayRemove failed', err)
      })

      // try delete subcollection doc (authoritative)
      try {
        await deleteDoc(doc(firestore, 'families', family.id, 'members', removeTarget.id))
      } catch (err) {
        console.warn('deleteDoc member subdoc failed', err)
      }

      // best-effort: remove family from user's familiesJoined
      try {
        await updateDoc(doc(firestore, 'users', removeTarget.id), {
          familiesJoined: arrayRemove(family.id),
        })
      } catch (err) {
        console.warn('update users.familiesJoined failed', err)
      }

      // optimistic update
      setMembers(prev => prev.filter(p => p.id !== removeTarget.id))
      toast.success('Member removed')
    } catch (err) {
      console.error('Failed to remove member', err)
      toast.error('Failed to remove member')
    } finally {
      setBusy(false)
      setRemoveModalOpen(false)
      setRemoveTarget(null)
    }
  }

  // Leave family (current user)
  const handleLeaveFamily = async () => {
    if (!family || !user) return
    setBusy(true)
    try {
      await updateDoc(doc(firestore, 'families', family.id), {
        members: arrayRemove(user.uid),
      }).catch((err) => {
        console.warn('arrayRemove on family doc failed', err)
      })

      try {
        await deleteDoc(doc(firestore, 'families', family.id, 'members', user.uid))
      } catch (err) {
        console.warn('delete member subdoc failed', err)
      }

      try {
        await updateDoc(doc(firestore, 'users', user.uid), {
          familiesJoined: arrayRemove(family.id),
        })
      } catch (err) {
        console.warn('update users.familiesJoined failed', err)
      }

      toast.success('You left the family')
      router.push('/family')
    } catch (err) {
      console.error('Failed to leave family', err)
      toast.error('Failed to leave family')
    } finally {
      setBusy(false)
      setLeaveModalOpen(false)
    }
  }

  // UI: skeleton while loading
  if (loading) {
    return (
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        <Skeleton className="h-8 w-3/5" />
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
          </CardHeader>
          <CardContent>
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-9 w-9 rounded-full" />
                  <div>
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-36 mt-1" />
                  </div>
                </div>
                <Skeleton className="h-8 w-20" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!family) {
    return (
      <div className="p-4 text-muted-foreground text-center mt-10">
        Family not found.
      </div>
    )
  }

  return (
    <>
      <div
        className="max-w-2xl mx-auto p-4 space-y-6"
      >
        {/* Header */}
        <header className="sticky top-0 z-10 backdrop-blur-sm bg-background/70 pb-2 border-b">
          <div className="flex justify-between items-center gap-4">
            <div>
              <h1 className="text-xl font-semibold">{family.name}</h1>
              <div className="text-xs text-muted-foreground">
                {family.createdAt ? `Created ${formatDistanceToNow(new Date(
                  family.createdAt.seconds ? family.createdAt.toDate() : family.createdAt
                ), { addSuffix: true })}` : null}
                {typeof members.length === 'number' && ` • ${members.length} member${members.length !== 1 ? 's' : ''}`}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => router.push('/family')}>Back</Button>

              {canManage ? (
                <>
                  <Button type="button" size="sm" onClick={(e) => { e.stopPropagation(); setInviteOpen(true) }} aria-label="Invite members">Invite</Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setManageOpen(true);
                    }}
                    aria-label="Manage family"
                  >
                    Manage
                  </Button>

                </>
              ) : (
                <Button type="button" size="sm" variant="destructive" onClick={(e) => { e.stopPropagation(); setLeaveModalOpen(true) }} aria-label="Leave family">Leave</Button>
              )}
            </div>
          </div>
        </header>

        {/* Members card */}
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {members.length === 0 ? (
              <p className="text-sm text-muted-foreground">No members yet</p>
            ) : (
              <div className="space-y-2">
                <AnimatePresence>
                  {members.map(member => (
                    <motion.div
                      key={member.id}
                      layout
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      className="flex items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar>
                          {member.photoURL ? (
                            <AvatarImage src={member.photoURL} alt={member.name ?? 'User'} />
                          ) : (
                            <AvatarFallback>
                              {(member.name ?? '?').split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          )}
                        </Avatar>

                        <div className="min-w-0">
                          <p className="font-medium truncate flex items-center gap-2">
                            <span>{member.name ?? 'Unnamed user'}</span>
                            {member.__isOwner && <Badge variant="secondary">Owner</Badge>}
                            {member.id === user?.uid && <span className="text-xs text-muted-foreground">(You)</span>}
                            {member.role && !member.__isOwner && <Badge variant="outline">{member.role}</Badge>}
                          </p>
                          <p className="text-sm text-muted-foreground truncate">{member.email}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {isCreator && member.id !== user?.uid ? (
                          <Button type="button" size="sm" variant="ghost" onClick={() => confirmRemove(member)} aria-label={`Remove ${member.name ?? 'member'}`}>Remove</Button>
                        ) : null}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Modals remain clickable */}
      <div className="pointer-events-auto">
        {canManage && (
          <InviteModal
            familyId={family.id}
            familyName={family.name}
            open={isInviteOpen}
            onOpenChange={setInviteOpen}
          />
        )}

        {canManage && (
          <ManageFamilyDialog family={family} open={manageOpen} onOpenChange={setManageOpen} />
        )}

        <Dialog open={removeModalOpen} onOpenChange={(v) => { if (!v) setRemoveTarget(null); setRemoveModalOpen(v) }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Remove member</DialogTitle>
            </DialogHeader>
            <div>
              <p className="text-sm text-muted-foreground">
                Remove <strong>{removeTarget?.name ?? 'this member'}</strong> from the family? This action cannot be undone.
              </p>
            </div>
            <DialogFooter>
              <div className="flex gap-2 w-full justify-end">
                <Button type="button" variant="outline" onClick={() => { setRemoveModalOpen(false); setRemoveTarget(null) }}>Cancel</Button>
                <Button type="button" variant="destructive" onClick={handleRemoveMember} disabled={busy}>
                  {busy ? 'Removing…' : 'Remove'}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={leaveModalOpen} onOpenChange={setLeaveModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Leave family</DialogTitle>
            </DialogHeader>
            <div>
              <p className="text-sm text-muted-foreground">
                Are you sure you want to leave <strong>{family.name}</strong>? You will lose access to this family's features.
              </p>
            </div>
            <DialogFooter>
              <div className="flex gap-2 w-full justify-end">
                <Button type="button" variant="outline" onClick={() => setLeaveModalOpen(false)}>Cancel</Button>
                <Button type="button" variant="destructive" onClick={handleLeaveFamily} disabled={busy}>
                  {busy ? 'Leaving…' : 'Leave family'}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  )

}
