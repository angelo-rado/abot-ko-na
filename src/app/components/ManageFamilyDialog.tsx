'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { enqueue, isOnline as isNetOnline } from '@/lib/offline'
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  getDocs,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  onSnapshot,
  arrayRemove,
} from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Trash, ArrowUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import SetFamilyHomeLocation from './SetFamilyHomeLocation'
import DeleteFamilyButton from './DeleteFamilyButton'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/lib/useAuth'
// ✅ use shadcn tooltip wrapper, not radix primitives
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useRouter } from 'next/navigation'

type Family = {
  id: string
  name?: string
  createdBy?: string
  owner?: string
  createdAt?: any
  homeLocation?: { lat: number; lng: number }
  [k: string]: any
}

type Member = {
  id: string
  name?: string
  email?: string
  photoURL?: string
  role?: string | null
  addedAt?: any
  __isOwner?: boolean
}

type Props = {
  family: Family | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function ManageFamilyDialog({ family, open, onOpenChange }: Props) {
  const { user } = useAuth()
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const [editingName, setEditingName] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [members, setMembers] = useState<Member[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const router = useRouter()

  // current user's role in this family (owner | admin | member | null)
  const [myRole, setMyRole] = useState<string | null>(null)
  const isOwner = Boolean(family && (family.owner ?? family.createdBy) === user?.uid)
  const isAdmin = myRole === 'admin'
  const canManage = isOwner || isAdmin
  const LOCAL_FAMILY_KEY = 'abot:selectedFamily'

  // profile cache to avoid repeated users/{uid} reads
  const profileCacheRef = useRef<Record<string, { name?: string; email?: string; photoURL?: string }>>({})

  // Realtime listener unsubs
  const membersUnsubRef = useRef<(() => void) | null>(null)
  const myRoleUnsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (open && family?.id) {
      setEditingName(family.name ?? '')
      startMembersRealtime()
      startMyRoleRealtime()
    } else {
      // closed: cleanup
      stopMembersRealtime()
      stopMyRoleRealtime()
      setMembers([])
      setMembersLoading(false)
      setMyRole(null)
    }
    return () => {
      stopMembersRealtime()
      stopMyRoleRealtime()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, family?.id])

  const stopMembersRealtime = () => {
    if (membersUnsubRef.current) {
      try { membersUnsubRef.current() } catch { }
      membersUnsubRef.current = null
    }
  }

  const stopMyRoleRealtime = () => {
    if (myRoleUnsubRef.current) {
      try { myRoleUnsubRef.current() } catch { }
      myRoleUnsubRef.current = null
    }
  }

  const fetchProfileOnce = async (uid: string) => {
    const cache = profileCacheRef.current
    if (cache[uid]) return cache[uid]
    try {
      const snap = await getDoc(doc(firestore, 'users', uid))
      if (snap.exists()) {
        const d = snap.data() as any
        const p = { name: d?.name ?? d?.displayName, email: d?.email, photoURL: d?.photoURL ?? d?.photo }
        cache[uid] = p
        return p
      }
    } catch (err) {
      console.warn('fetchProfileOnce failed for', uid, err)
    }
    cache[uid] = {}
    return cache[uid]
  }

  // start realtime members subscription
  const startMembersRealtime = useCallback(() => {
    if (!family?.id) return
    stopMembersRealtime()
    setMembersLoading(true)

    const membersRef = collection(firestore, 'families', family.id, 'members')
    const unsub = onSnapshot(membersRef, async (snap) => {
      if (!mountedRef.current) return
      const docs: Member[] = snap.docs.map(d => {
        const data = d.data() as any
        return {
          id: d.id,
          role: data?.role ?? null,
          name: data?.name ?? undefined,
          email: data?.email ?? undefined,
          photoURL: data?.photoURL ?? undefined,
          addedAt: data?.addedAt ?? data?.createdAt ?? null,
          ...data,
        } as Member
      })

      // find which profiles are missing
      const toFetch = docs.filter(m => !m.name && !m.photoURL && !m.email).map(m => m.id)
      await Promise.all(toFetch.map(async uid => {
        const p = await fetchProfileOnce(uid)
        const idx = docs.findIndex(x => x.id === uid)
        if (idx >= 0) docs[idx] = { ...docs[idx], name: p.name, email: p.email, photoURL: p.photoURL }
      }))

      const ownerId = family?.owner ?? family?.createdBy ?? null
      const sorted = docs.slice().sort((a, b) => {
        if (a.id === ownerId) return -1
        if (b.id === ownerId) return 1
        return (a.name ?? '').toLowerCase().localeCompare((b.name ?? '').toLowerCase())
      }).map(m => ({ ...m, __isOwner: m.id === ownerId }))

      if (mountedRef.current) {
        setMembers(sorted)
        setMembersLoading(false)
      }
    }, (err) => {
      console.warn('members realtime error', err)
      if (mountedRef.current) {
        setMembersLoading(false)
        toast.error('Failed to subscribe to members')
      }
    })

    membersUnsubRef.current = unsub
  }, [family?.id])

  // start realtime subscription for current user's member doc
  const startMyRoleRealtime = useCallback(() => {
    if (!family?.id || !user?.uid) return
    stopMyRoleRealtime()

    const myRef = doc(firestore, 'families', family.id, 'members', user.uid)
    const unsub = onSnapshot(myRef, (snap) => {
      if (!mountedRef.current) return
      if (snap.exists()) {
        const md = snap.data() as any
        if (family && family.createdBy === user.uid) {
          setMyRole('owner')
        } else {
          setMyRole(md?.role ?? 'member')
        }
      } else {
        if (family && family.createdBy === user.uid) setMyRole('owner')
        else setMyRole(null)
      }
    }, (err) => {
      console.warn('myRole subscription error', err)
    })

    myRoleUnsubRef.current = unsub
  }, [family?.id, user?.uid, family?.createdBy])

  // Toggle role optimistically
  const toggleRole = async (memberId: string, currentRole: string | null | undefined) => {
    if (!family?.id || !user?.uid) return
    const ownerId = family.owner ?? family.createdBy ?? null
    if (ownerId && memberId === ownerId) {
      toast('Owner role cannot be changed', { icon: '⚠️' })
      return
    }
    if (!isOwner && !isAdmin) {
      toast.error('You do not have permission to change roles')
      return
    }

    const nextRole = currentRole === 'admin' ? 'member' : 'admin'
    setBusy(true)

    // optimistic update
    setMembers(prev => prev.map(m => m.id === memberId ? { ...m, role: nextRole } : m))

    try {
      const memberRef = doc(firestore, 'families', family.id, 'members', memberId)
      await updateDoc(memberRef, { role: nextRole })
      toast.success(`Role updated to ${nextRole}`)
      // realtime listener will confirm authoritative state
    } catch (err) {
      console.error('toggleRole failed', err)
      toast.error('Failed to update role')
      // revert optimistic
      setMembers(prev => prev.map(m => m.id === memberId ? { ...m, role: currentRole } : m))
    } finally {
      setBusy(false)
    }
  }

  // Remove member (owner/admin). No client writes to users/{uid} (rules block it) — server does the cleanup.
  const removeMember = async (memberId: string) => {
    // OFFLINE: queue removal and optimistically update UI
    if (typeof navigator !== 'undefined' && !isNetOnline()) {
      if (!family?.id) return
      try {
        setMembers(prev => prev.filter(m => m.id !== memberId))
        await enqueue({ op: 'removeMember', familyId: family.id, payload: { familyId: family.id, uid: memberId } })
        toast("Member will be removed when you're back online", { icon: '📶' })
        return
      } catch { }
    }

    if (!family?.id || !user?.uid) return
    const ownerId = family.owner ?? family.createdBy ?? null
    if (ownerId && memberId === ownerId) {
      toast('Cannot remove the owner', { icon: '⚠️' })
      return
    }
    if (!isOwner && !isAdmin) {
      toast.error('You do not have permission to remove members')
      return
    }

    setBusy(true)
    const prev = members
    setMembers(prev => prev.filter(m => m.id !== memberId))

    try {
      // 1) authoritative: delete membership doc
      await deleteDoc(doc(firestore, 'families', family.id, 'members', memberId))

      // 2) best-effort: maintain families/{id}.members array (helps queries)
      try {
        await updateDoc(doc(firestore, 'families', family.id), {
          members: arrayRemove(memberId),
        })
      } catch (e) {
        console.warn('arrayRemove on family doc failed (non-fatal)', e)
      }

      // 3) DO NOT mutate users/{memberId} here (rules forbid). Cloud Function
      //    onFamilyMemberRemoved handles user doc cleanup with admin rights.

      toast.success('Member removed')
    } catch (err) {
      console.error('removeMember failed', err)
      toast.error('Failed to remove member')
      setMembers(prev) // revert optimistic
    } finally {
      setBusy(false)
    }
  }

  // Owner-only delete family
  const handleDeleteFamily = async () => {
    if (!family?.id) return
    if (!isOwner) {
      toast.error('Only the owner can delete the family')
      return
    }
    setDeleting(true)
    try {
      const familyId = family.id

      // Best-effort: delete common subcollections
      const subcols = ['members', 'deliveries', 'presence', 'tokens'] as const
      for (const sub of subcols) {
        const snap = await getDocs(collection(firestore, 'families', familyId, sub))
        if (!snap.empty) {
          const batch = writeBatch(firestore)
          snap.docs.forEach(d => batch.delete(d.ref))
          await batch.commit()
        }
      }

      // Delete family doc last
      await deleteDoc(doc(firestore, 'families', familyId))

      // Clear client-selected family and redirect out of the detail route
      try {
        if (localStorage.getItem(LOCAL_FAMILY_KEY) === familyId) {
          localStorage.removeItem(LOCAL_FAMILY_KEY)
        }
      } catch { }

      toast.success('Family deleted')
      onOpenChange(false)
      router.replace('/family?deleted=1')
      router.refresh()
    } catch (err) {
      console.error('Failed to delete family', err)
      toast.error('Failed to delete family')
    } finally {
      setDeleting(false)
    }
  }

  const handleSaveName = async () => {
    if (!family?.id) return
    if (!isOwner) {
      toast.error('Only the owner can rename the family')
      return
    }
    if ((editingName ?? '').trim() === (family.name ?? '').trim()) {
      onOpenChange(false)
      return
    }
    setIsSaving(true)
    try {
      const famRef = doc(firestore, 'families', family.id)
      await updateDoc(famRef, {
        name: editingName.trim(),
        updatedAt: serverTimestamp(),
      })
      toast.success('Family name updated')
      onOpenChange(false)
    } catch (err) {
      console.error('Failed to update family name', err)
      toast.error('Failed to save name')
    } finally {
      setIsSaving(false)
    }
  }

  const renderReadOnlyBanner = () => {
    if (isOwner || isAdmin) return null
    return (
      <div className="rounded-md bg-muted/5 p-3 text-sm text-muted-foreground">
        You are a family member and have read-only access to this dialog.
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { stopMembersRealtime(); stopMyRoleRealtime() } onOpenChange(v) }}>
      {/* ✅ Silence Radix warning by adding aria-describedby={undefined} */}
      <DialogContent className="sm:max-w-2xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Manage {family?.name ?? 'family'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {renderReadOnlyBanner()}

          {/* Family name editor — only owner can rename */}
          {isOwner ? (
            <div>
              <label className="text-sm font-medium block mb-2">Family name</label>
              <div className="flex gap-2">
                <Input value={editingName} onChange={(e) => setEditingName(e.target.value)} />
                <Button type="button" onClick={handleSaveName} disabled={isSaving || editingName.trim() === ''}>
                  {isSaving ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <label className="text-sm font-medium block mb-2">Family name</label>
              <div className="text-sm">{family?.name}</div>
            </div>
          )}

          {/* Set home location — owner & admin */}
          {(isOwner || isAdmin) && family?.id && (
            <div>
              <SetFamilyHomeLocation familyId={family.id} />
            </div>
          )}

          {/* Members list */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium">Members</h3>
              <div className="text-xs text-muted-foreground">{membersLoading ? 'Loading…' : `${members.length} member${members.length !== 1 ? 's' : ''}`}</div>
            </div>

            <div className="space-y-2 max-h-64 overflow-auto">
              {membersLoading ? (
                <>
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-muted" />
                        <div>
                          <div className="h-4 w-36 bg-muted rounded" />
                        </div>
                      </div>
                      <div className="h-8 w-24 bg-muted rounded" />
                    </div>
                  ))}
                </>
              ) : members.length === 0 ? (
                <div className="text-sm text-muted-foreground">No members yet</div>
              ) : (
                members.map((m) => {
                  const ownerId = family?.owner ?? family?.createdBy ?? null
                  const isMemberOwner = ownerId && m.id === ownerId
                  const canChangeRole = (isOwner || isAdmin) && !isMemberOwner
                  const canRemove = (isOwner || isAdmin) && !isMemberOwner

                  return (
                    <div key={m.id} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar>
                          {m.photoURL ? <AvatarImage src={m.photoURL} alt={m.name ?? 'Member'} /> : <AvatarFallback>{(m.name ?? '?').split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase()}</AvatarFallback>}
                        </Avatar>
                        <div className="min-w-0">
                          <div className="font-medium truncate flex items-center gap-2">
                            <span>{m.name ?? 'Unnamed'}</span>
                            {isMemberOwner ? (
                              <Badge variant="secondary">Owner</Badge>
                            ) : m.role ? (
                              <Badge variant="outline">{m.role}</Badge>
                            ) : null}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">{m.email}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {canChangeRole ? (
                          <button
                            type="button"
                            className={cn('inline-flex items-center gap-2 text-sm px-2 py-1 rounded', 'bg-muted/10')}
                            onClick={() => toggleRole(m.id, m.role)}
                            title={m.role === 'admin' ? 'Demote to member' : 'Promote to admin'}
                            disabled={busy}
                          >
                            <ArrowUpDown className="w-4 h-4" />
                            <span>{m.role ?? 'member'}</span>
                          </button>
                        ) : (
                          <div className="text-xs text-muted-foreground px-2 py-1">—</div>
                        )}

                        {canRemove ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeMember(m.id)}
                                  aria-label={`Remove ${m.name ?? 'member'}`}
                                  disabled={busy}
                                >
                                  <Trash className="w-4 h-4 text-destructive" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent className="bg-destructive text-white px-3 py-1.5 rounded text-xs shadow-md" sideOffset={8}>
                                <p>Kick Member</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <div className="w-8" />
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Danger zone: delete only visible to owner */}
          {isOwner && (
            <div>
              <h4 className="text-sm font-medium mb-2">Danger zone</h4>
              <p className="text-xs text-muted-foreground mb-3">Deleting the family will remove the family and its members from it. This action is irreversible.</p>

              <div className="flex gap-2">
                {family ? (
                  <DeleteFamilyButton family={family} onClose={() => onOpenChange(false)} />
                ) : (
                  <Button type="button" variant="destructive" onClick={() => setConfirmDeleteOpen(true)} disabled={deleting}>
                    {deleting ? 'Deleting…' : 'Delete family'}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => { stopMembersRealtime(); stopMyRoleRealtime(); onOpenChange(false) }}>Close</Button>
        </DialogFooter>
      </DialogContent>

      {/* Fallback confirm delete dialog if DeleteFamilyButton isn't used */}
      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        {/* ✅ Silence warning here too */}
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Delete family?</DialogTitle>
          </DialogHeader>
          <div>
            <p className="text-sm text-muted-foreground">
              Are you sure you want to permanently delete <strong>{family?.name}</strong>? This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end mt-4">
              <Button type="button" variant="outline" onClick={() => setConfirmDeleteOpen(false)}>Cancel</Button>
              <Button type="button" variant="destructive" onClick={handleDeleteFamily} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete family'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}
