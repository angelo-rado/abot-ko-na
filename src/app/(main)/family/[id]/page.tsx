// src/app/family/[id]/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import {
  arrayRemove,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc
} from 'firebase/firestore'
import { formatDistanceToNow } from 'date-fns'
import { Users as UsersIcon, CalendarDays, Loader2 } from 'lucide-react'

import { firestore } from '@/lib/firebase'
import { useAuth } from '@/lib/useAuth'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { toast } from 'sonner'
import InviteModal from '@/app/components/InviteModal'
import ManageFamilyDialog from '@/app/components/ManageFamilyDialog'
import JoinedToastOnce from '../_components/JoinedToastOnce'

// shadcn AlertDialog for "Leave" confirmation
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Skeleton } from '@/components/ui/skeleton'

type Family = {
  id: string
  name?: string
  createdBy?: string
  createdAt?: Date | null
}

type MemberRow = {
  uid: string
  name?: string | null
  role?: string | null
  photoURL?: string | null
}

const LOCAL_FAMILY_KEY = 'abot:selectedFamily'

export const dynamic = 'force-dynamic'

function toDate(v: any): Date | null {
  if (!v) return null
  if (v instanceof Date) return v
  if (typeof v?.toDate === 'function') return v.toDate()
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

function initials(name?: string | null, uid?: string) {
  if (!name && uid) return uid.slice(0, 2).toUpperCase()
  if (!name) return '👤'
  return name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase()
}

export default function FamilyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuth()
  const search = useSearchParams()
  const joinedFlag = search.get('joined') === '1'

  const [family, setFamily] = useState<Family | null | undefined>()
  const [members, setMembers] = useState<MemberRow[] | undefined>()
  const [busy, setBusy] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)

  // joined toast
  useEffect(() => {
    if (!joinedFlag) return
    toast.success('Welcome to the family!')
    const url = new URL(window.location.href)
    url.searchParams.delete('joined')
    router.replace(url.toString(), { scroll: false })
  }, [joinedFlag, router])

  // family doc
  useEffect(() => {
    if (!id) { setFamily(undefined); return }
    const ref = doc(firestore, 'families', String(id))
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) { setFamily(null); return }
      const data = snap.data() as any
      setFamily({
        id: snap.id,
        name: typeof data?.name === 'string' ? data.name : undefined,
        createdBy: typeof data?.createdBy === 'string' ? data.createdBy : undefined,
        createdAt: toDate(data?.createdAt ?? data?.created_on ?? data?.created_at),
      })
    }, (err) => {
      console.error('[family] family doc error', err)
      setFamily(null)
    })
    return () => unsub()
  }, [id])

  // helper to pick a nice display name / photo
  function pickNameFrom(obj: any): string | null {
    if (!obj) return null
    return obj.displayName || obj.fullName || obj.name || obj?.profile?.displayName || obj?.profile?.name || null
  }
  function pickPhotoFrom(obj: any): string | null {
    if (!obj) return null
    return obj.photoURL || obj?.profile?.photoURL || null
  }

  // members subcollection
  useEffect(() => {
    if (!id) { setMembers(undefined); return }
    const colRef = collection(firestore, 'families', String(id), 'members')
    const unsub = onSnapshot(colRef, async (snap) => {
      const base = snap.docs.map(d => ({ uid: d.id, ...(d.data() as any) } as MemberRow))
      const enriched = await Promise.all(base.map(async (row) => {
        try {
          const uSnap = await getDoc(doc(firestore, 'users', row.uid))
          if (!uSnap.exists()) return row
          const u = uSnap.data() as any
          return {
            ...row,
            name: pickNameFrom(u) ?? row.name ?? null,
            photoURL: pickPhotoFrom(u) ?? row.photoURL ?? null,
          } as MemberRow
        } catch {
          return row
        }
      }))
      setMembers(enriched)
    }, (err) => {
      console.error('[family] members subcol error', err)
      setMembers([])
    })
    return () => unsub()
  }, [id])

  // If my member doc is missing name/photo, gently hydrate it (prevents others seeing raw UID)
  useEffect(() => {
    if (!id || !user || !members?.some(m => m.uid === user.uid)) return
    const me = members.find(m => m.uid === user.uid)!
    if (!me.name || !me.photoURL) {
      setDoc(
        doc(firestore, 'families', String(id), 'members', user.uid),
        {
          uid: user.uid,
          name: pickNameFrom(user) ?? user.email ?? user.uid,
          photoURL: (user as any)?.photoURL ?? null,
        },
        { merge: true }
      ).catch(() => {})
    }
  }, [id, user, members])

  const isOwner = !!(user && family?.createdBy === user.uid)
  const isMember = !!(user && members?.some((m) => m.uid === user.uid))
  const memberCount = members?.length ?? 0

  async function handleRemoveMember(targetUid: string) {
    if (!user || !id) return

    // Only the owner can remove others; anyone can remove themselves
    const removingSelf = targetUid === user.uid
    if (!removingSelf && !isOwner) {
      toast.error('Only the owner can remove other members.')
      return
    }

    setBusy(targetUid)
    try {
      // 1) Remove subcollection member doc
      await deleteDoc(doc(firestore, 'families', String(id), 'members', targetUid))

      // 2) Update the family doc's members array
      await updateDoc(doc(firestore, 'families', String(id)), {
        members: arrayRemove(targetUid),
      }).catch(() => { /* ignore if field missing */ })

      // 3) Update the user's doc when they remove themselves
      if (removingSelf) {
        const uref = doc(firestore, 'users', targetUid)
        await setDoc(
          uref,
          { joinedFamilies: arrayRemove(String(id)) },
          { merge: true }
        ).catch(() => {})

        // If this was their default family, clear preferredFamily
        try {
          const usnap = await getDoc(uref)
          const preferred = usnap.exists() ? (usnap.data() as any)?.preferredFamily : null
          if (preferred === String(id)) {
            await updateDoc(uref, { preferredFamily: null }).catch(() =>
              setDoc(uref, { preferredFamily: null }, { merge: true })
            )
          }
        } catch {}

        // Clear legacy local key
        try { if (localStorage.getItem(LOCAL_FAMILY_KEY) === String(id)) localStorage.removeItem(LOCAL_FAMILY_KEY) } catch {}

        toast.success('You left the family.')
        router.replace('/family')
      } else {
        toast.success('Member removed.')
      }
    } catch (e: any) {
      console.error('[family] remove member failed', e)
      toast.error(e?.message || 'Failed to remove member.')
    } finally {
      setBusy(null)
    }
  }

  if (!id) return null

  // ----- Improved loading UX: full-page skeletons -----
  if (family === undefined || members === undefined) {
    return (
      <div className="max-w-2xl mx-auto p-4 space-y-6" aria-busy="true">
        <div className="flex items-start justify-between gap-3">
          <Button variant="ghost" size="icon" disabled className="shrink-0">
            <ChevronLeft className="w-5 h-5" />
          </Button>

          <div className="min-w-0 flex-1">
            <Skeleton className="h-7 w-56" />
            <div className="mt-2 flex items-center gap-3">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-36" />
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>

        <Separator />

        <section className="space-y-3">
          <Skeleton className="h-5 w-24" />
          <ul className="divide-y rounded-md border overflow-hidden">
            {Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="flex items-center justify-between p-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
                <Skeleton className="h-6 w-16" />
              </li>
            ))}
          </ul>
        </section>
      </div>
    )
  }

  if (family === null) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <p className="text-muted-foreground">This family no longer exists or you don’t have access.</p>
        <Button className="mt-4" onClick={() => router.push('/family')}>Back to Families</Button>
      </div>
    )
  }

  const created = family.createdAt ? formatDistanceToNow(family.createdAt, { addSuffix: true }) : null

  return (
    <>
      <JoinedToastOnce />
      <div className="max-w-2xl mx-auto p-4 space-y-6">
        <div className="flex items-start justify-between gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()} aria-label="Back" className="shrink-0">
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold truncate">{family.name || 'Untitled Family'}</h1>
            <div className="mt-1 text-xs text-muted-foreground flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <UsersIcon className="w-3.5 h-3.5" />
                {memberCount} {memberCount === 1 ? 'member' : 'members'}
              </span>
              {created && (
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="w-3.5 h-3.5" />
                  {created}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Owner actions */}
            {isOwner && (
              <>
                <Button variant="outline" onClick={() => setInviteOpen(true)}>Invite</Button>
                <Button onClick={() => setManageOpen(true)}>Manage</Button>
              </>
            )}

            {/* Member-only action: Leave */}
            {!isOwner && isMember && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    onClick={(e) => e.stopPropagation()}
                    disabled={busy === user?.uid}
                    title="Leave this family"
                  >
                    {busy === user?.uid ? 'Leaving…' : 'Leave'}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Leave this family?</AlertDialogTitle>
                    <AlertDialogDescription>
                      You’ll be removed from <strong>{family.name || 'this family'}</strong>. You can rejoin later if invited.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={busy === user?.uid}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => handleRemoveMember(user!.uid)}
                      disabled={busy === user?.uid}
                    >
                      Yes, leave
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>

        <Separator />

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Members</h2>
          <ul className="divide-y rounded-md border overflow-hidden">
            {members!.map(m => {
              const owner = m.uid === family.createdBy
              const role = owner ? 'Owner' : (m.role || 'Member')
              return (
                <li key={m.uid} className="flex items-center justify-between p-3 text-sm">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar className="h-8 w-8">
                      {m.photoURL ? (
                        <AvatarImage src={m.photoURL} alt={m.name ?? m.uid} />
                      ) : (
                        <AvatarFallback>{initials(m.name, m.uid)}</AvatarFallback>
                      )}
                    </Avatar>
                    <div className="min-w-0">
                      <div className="font-medium truncate">{m.name || m.uid}</div>
                      <div className="mt-1">
                        <Badge variant={owner ? 'secondary' : 'outline'} className="text-[10px]">
                          {role}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
            {members!.length === 0 && (
              <li className="p-3 text-muted-foreground">No members yet.</li>
            )}
          </ul>
        </section>

        {isOwner && (
          <>
            <InviteModal
              open={inviteOpen}
              onOpenChange={setInviteOpen}
              familyId={String(id)}
              familyName={family?.name ?? undefined}
            />
            <ManageFamilyDialog
              open={manageOpen}
              onOpenChange={setManageOpen}
              family={family}
            />
          </>
        )}
      </div>
    </>
  )
}
