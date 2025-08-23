'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { enqueue, isOnline as isNetOnline } from '@/lib/offline'
import {
  doc, getDoc, updateDoc, collection, getDocs, deleteDoc,
  writeBatch, serverTimestamp, onSnapshot, arrayRemove
} from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Trash, ArrowUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import SetFamilyHomeLocation from './SetFamilyHomeLocation'
import DeleteFamilyButton from './DeleteFamilyButton'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/lib/useAuth'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

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

const LOCAL_FAMILY_KEY = 'abot:selectedFamily'

function initials(name?: string | null, uid?: string) {
  if (!name && uid) return uid.slice(0, 2).toUpperCase()
  if (!name) return '👤'
  return name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase()
}

export default function ManageFamilyDialog({ family, open, onOpenChange }: Props) {
  const { user } = useAuth()
  const router = useRouter()

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const [editingName, setEditingName] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [members, setMembers] = useState<Member[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const [myRole, setMyRole] = useState<string | null>(null)
  const isOwner = Boolean(family && (family.owner ?? family.createdBy) === user?.uid)
  const isAdmin = myRole === 'admin'

  const profileCacheRef = useRef<Record<string, { name?: string; email?: string; photoURL?: string }>>({})

  const membersUnsubRef = useRef<(() => void) | null>(null)
  const myRoleUnsubRef = useRef<(() => void) | null>(null)

  // (Un)subscribe based on open/family.id; keep hook order stable
  useEffect(() => {
    if (!open || !family?.id) {
      if (membersUnsubRef.current) { try { membersUnsubRef.current() } catch {} ; membersUnsubRef.current = null }
      if (myRoleUnsubRef.current) { try { myRoleUnsubRef.current() } catch {} ; myRoleUnsubRef.current = null }
      setMembers([])
      setMembersLoading(false)
      setMyRole(null)
      return
    }

    // Members realtime
    const membersRef = collection(firestore, 'families', family.id, 'members')
    setMembersLoading(true)
    membersUnsubRef.current = onSnapshot(membersRef, async (snap) => {
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

      const toFetch = docs.filter(m => !m.name && !m.photoURL && !m.email).map(m => m.id)
      await Promise.all(toFetch.map(async uid => {
        if (profileCacheRef.current[uid]) return
        try {
          const snap = await getDoc(doc(firestore, 'users', uid))
          if (snap.exists()) {
            const u = snap.data() as any
            profileCacheRef.current[uid] = {
              name: u?.name ?? u?.displayName,
              email: u?.email,
              photoURL: u?.photoURL ?? u?.photo
            }
          } else {
            profileCacheRef.current[uid] = {}
          }
        } catch { profileCacheRef.current[uid] = {} }
      }))

      const enriched = docs.map(m => ({
        ...m,
        name: m.name ?? profileCacheRef.current[m.id]?.name,
        email: m.email ?? profileCacheRef.current[m.id]?.email,
        photoURL: m.photoURL ?? profileCacheRef.current[m.id]?.photoURL
      }))

      const ownerId = family?.owner ?? family?.createdBy ?? null
      const sorted = enriched.slice().sort((a, b) => {
        if (a.id === ownerId) return -1
        if (b.id === ownerId) return 1
        return (a.name ?? '').toLowerCase().localeCompare((b.name ?? '').toLowerCase())
      }).map(m => ({ ...m, __isOwner: m.id === ownerId }))

      if (mountedRef.current) {
        setMembers(sorted)
        setMembersLoading(false)
      }
    }, () => {
      if (mountedRef.current) {
        setMembersLoading(false)
        toast.error('Failed to subscribe to members')
      }
    })

    // My role realtime
    if (user?.uid) {
      const myRef = doc(firestore, 'families', family.id, 'members', user.uid)
      myRoleUnsubRef.current = onSnapshot(myRef, (snap) => {
        if (!mountedRef.current) return
        if (family && family.createdBy === user.uid) setMyRole('owner')
        else setMyRole(snap.exists() ? ((snap.data() as any)?.role ?? 'member') : null)
      })
    }

    return () => {
      if (membersUnsubRef.current) { try { membersUnsubRef.current() } catch {} ; membersUnsubRef.current = null }
      if (myRoleUnsubRef.current) { try { myRoleUnsubRef.current() } catch {} ; myRoleUnsubRef.current = null }
    }
  }, [open, family?.id, family?.createdBy, user?.uid])

  const toggleRole = async (memberId: string, currentRole: string | null | undefined) => {
    if (!family?.id || !user?.uid) return
    const ownerId = family.owner ?? family.createdBy ?? null
    if (ownerId && memberId === ownerId) { toast('Owner role cannot be changed', { icon: '⚠️' }); return }
    if (!isOwner && !isAdmin) { toast.error('You do not have permission to change roles'); return }

    const nextRole = currentRole === 'admin' ? 'member' : 'admin'
    setBusy(true)
    setMembers(prev => prev.map(m => m.id === memberId ? { ...m, role: nextRole } : m))
    try {
      await updateDoc(doc(firestore, 'families', family.id, 'members', memberId), { role: nextRole })
      toast.success(`Role updated to ${nextRole}`)
    } catch (err) {
      console.error('toggleRole failed', err)
      toast.error('Failed to update role')
      setMembers(prev => prev.map(m => m.id === memberId ? { ...m, role: currentRole } : m))
    } finally { setBusy(false) }
  }

  const removeMember = async (memberId: string) => {
    if (typeof navigator !== 'undefined' && !isNetOnline()) {
      if (!family?.id) return
      try {
        setMembers(prev => prev.filter(m => m.id !== memberId))
        await enqueue({ op: 'removeMember', familyId: family.id, payload: { familyId: family.id, uid: memberId } })
        toast("Member will be removed when you're back online", { icon: '📶' })
        return
      } catch {}
    }

    if (!family?.id || !user?.uid) return
    const ownerId = family.owner ?? family.createdBy ?? null
    if (ownerId && memberId === ownerId) { toast('Cannot remove the owner', { icon: '⚠️' }); return }
    if (!isOwner && !isAdmin) { toast.error('You do not have permission to remove members'); return }

    setBusy(true)
    const prev = members
    setMembers(prev => prev.filter(m => m.id !== memberId))

    try {
      await deleteDoc(doc(firestore, 'families', family.id, 'members', memberId))
      try { await updateDoc(doc(firestore, 'families', family.id), { members: arrayRemove(memberId) }) } catch {}
      toast.success('Member removed')
    } catch (err) {
      console.error('removeMember failed', err)
      toast.error('Failed to remove member')
      setMembers(prev)
    } finally { setBusy(false) }
  }

  const handleSaveName = async () => {
    if (!family?.id) return
    if (!isOwner) { toast.error('Only the owner can rename the family'); return }
    if ((editingName ?? '').trim() === (family?.name ?? '').trim()) { onOpenChange(false); return }
    setIsSaving(true)
    try {
      await updateDoc(doc(firestore, 'families', family.id), {
        name: editingName.trim(),
        updatedAt: serverTimestamp(),
      })
      toast.success('Family name updated')
      onOpenChange(false)
    } catch (err) {
      console.error('Failed to update family name', err)
      toast.error('Failed to save name')
    } finally { setIsSaving(false) }
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
    <Dialog
      key={family?.id ?? 'no-family'}
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          if (membersUnsubRef.current) { try { membersUnsubRef.current() } catch {} ; membersUnsubRef.current = null }
          if (myRoleUnsubRef.current) { try { myRoleUnsubRef.current() } catch {} ; myRoleUnsubRef.current = null }
        }
        onOpenChange(v)
      }}
    >
      <DialogContent className="sm:max-w-2xl" aria-describedby={undefined}>
        {/* Single provider here to keep list stable */}
        <TooltipProvider delayDuration={200}>
          <DialogHeader>
            <DialogTitle>Manage {family?.name ?? 'family'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {renderReadOnlyBanner()}

            {/* Family name editor */}
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

            {/* Set home location */}
            {(isOwner || isAdmin) && family?.id && (
              <div>
                <SetFamilyHomeLocation familyId={family.id} />
              </div>
            )}

            {/* Members list */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium">Members</h3>
                <div className="text-xs text-muted-foreground">
                  {membersLoading ? 'Loading…' : `${members.length} member${members.length !== 1 ? 's' : ''}`}
                </div>
              </div>

              <div className="space-y-2 max-h-64 overflow-auto">
                {membersLoading ? (
                  <>
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-muted" />
                          <div><div className="h-4 w-36 bg-muted rounded" /></div>
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
                          <Avatar className="h-8 w-8">
                            {m.photoURL
                              ? <AvatarImage src={m.photoURL} alt={m.name ?? m.id} />
                              : <AvatarFallback>{initials(m.name, m.id)}</AvatarFallback>}
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

            {/* Danger zone — use dedicated button (stable AlertDialog internally) */}
            {isOwner && family && (
              <div>
                <h4 className="text-sm font-medium mb-2">Danger zone</h4>
                <p className="text-xs text-muted-foreground mb-3">
                  Deleting the family will remove the family and its members from it. This action is irreversible.
                </p>
                <div className="flex gap-2">
                  <DeleteFamilyButton family={family} onClose={() => onOpenChange(false)} />
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (membersUnsubRef.current) { try { membersUnsubRef.current() } catch {} ; membersUnsubRef.current = null }
                if (myRoleUnsubRef.current) { try { myRoleUnsubRef.current() } catch {} ; myRoleUnsubRef.current = null }
                onOpenChange(false)
              }}
            >
              Close
            </Button>
          </DialogFooter>
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  )
}

