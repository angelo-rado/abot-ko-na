'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  writeBatch,
  arrayRemove,
} from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { useAuth } from '@/lib/useAuth'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

type Family = { id: string; name?: string; createdBy?: string }
type Member = { uid: string; name?: string | null; email?: string | null; role?: string | null }

export const dynamic = 'force-dynamic'

export default function FamilyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const search = useSearchParams()
  const joinedFlag = useMemo(() => search.get('joined') === '1', [search])

  const { user, loading: authLoading } = useAuth()
  const [family, setFamily] = useState<Family | null | undefined>(undefined) // undefined = loading

  const [members, setMembers] = useState<Member[] | undefined>(undefined) // undefined = loading
  const [workingUid, setWorkingUid] = useState<string | null>(null)

  // Auth gate
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login')
    }
  }, [authLoading, user, router])

  // Live family doc
  useEffect(() => {
    if (!id) { setFamily(null); return }
    const ref = doc(firestore, 'families', id)
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) { setFamily(null); return }
      const d = snap.data() as any
      setFamily({ id: snap.id, name: d?.name ?? 'Family', createdBy: d?.createdBy ?? '' })
    }, () => setFamily(null))
    return () => unsub()
  }, [id])

  // Members list (from subcollection), hydrate names from users/{uid}
  useEffect(() => {
    if (!id) { setMembers([]); return }
    const membersRef = collection(firestore, 'families', id, 'members')
    const unsub = onSnapshot(membersRef, async (snap) => {
      const rows = snap.docs.map(d => ({ uid: d.id, ...(d.data() as any) }))
      // hydrate names/emails from users collection
      const hydrated = await Promise.all(rows.map(async (m) => {
        try {
          const u = await getDoc(doc(firestore, 'users', m.uid))
          const ud = u.exists() ? u.data() as any : {}
          return {
            uid: m.uid,
            role: m.role ?? ud.role ?? null,
            name: ud.displayName ?? ud.name ?? null,
            email: ud.email ?? null,
          }
        } catch {
          return { uid: m.uid, role: m.role ?? null, name: null, email: null }
        }
      }))
      setMembers(hydrated)
    }, () => setMembers([]))
    return () => unsub()
  }, [id])

  const isOwner = !!(family && user && family.createdBy === user.uid)

  async function removeMember(targetUid: string) {
    if (!family || !id || !user) return
    const removingSelf = targetUid === user.uid

    if (!isOwner && !removingSelf) {
      toast.error('Only the family owner can remove other members.')
      return
    }

    if (isOwner && family.createdBy === targetUid) {
      toast.error('Owner cannot remove themselves. Transfer ownership first.')
      return
    }

    setWorkingUid(targetUid)
    try {
      const batch = writeBatch(firestore)
      const memberRef = doc(firestore, 'families', id, 'members', targetUid)
      const familyRef = doc(firestore, 'families', id)

      // Remove the subcollection doc
      batch.delete(memberRef)
      // Also remove from the top-level array to keep queries in sync
      batch.update(familyRef, { members: arrayRemove(targetUid) })

      await batch.commit()

      if (removingSelf) {
        toast.success('You left the family.')
        // Optionally clear local preferred family here if you store it
        try { localStorage.removeItem('abot:selectedFamily') } catch {}
        router.replace('/family?left=1')
      } else {
        toast.success('Member removed.')
      }
    } catch (err) {
      console.error('[family/removeMember] failed', err)
      toast.error('Failed to remove member.')
    } finally {
      setWorkingUid(null)
    }
  }

  if (authLoading || family === undefined) {
    return (
      <main className="max-w-xl mx-auto p-6">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Loading family…</span>
        </div>
      </main>
    )
  }

  if (family === null) {
    return (
      <main className="max-w-xl mx-auto p-6 space-y-3">
        <h1 className="text-lg font-semibold">Family not found</h1>
        <p className="text-sm text-muted-foreground">
          The link may be invalid or the family was removed.
        </p>
        <Button type="button" onClick={() => router.replace('/family')}>Back to Families</Button>
      </main>
    )
  }

  return (
    <main className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{family.name ?? 'Family'}</h1>
        {joinedFlag && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400">
            Joined successfully.
          </p>
        )}
        <Separator />
      </div>

      {/* Members */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Members</h2>
        {members === undefined ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading members…
          </div>
        ) : members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No members yet.</p>
        ) : (
          <ul className="divide-y rounded border">
            {members.map((m) => {
              const isSelf = user?.uid === m.uid
              const canRemove = isOwner || isSelf
              return (
                <li key={m.uid} className="flex items-center justify-between p-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {m.name ?? m.uid}
                      {family.createdBy === m.uid && (
                        <span className="ml-2 text-xs text-muted-foreground">(Owner)</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {m.email ?? m.uid}
                    </div>
                  </div>
                  <div>
                    {canRemove ? (
                      <Button
                        type="button"
                        variant={isSelf ? 'outline' : 'destructive'}
                        size="sm"
                        disabled={workingUid === m.uid}
                        onClick={() => removeMember(m.uid)}
                      >
                        {workingUid === m.uid ? (
                          <span className="flex items-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" /> Working…
                          </span>
                        ) : isSelf ? 'Leave' : 'Remove'}
                      </Button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Shortcuts */}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => router.replace('/deliveries')}>
          Go to Deliveries
        </Button>
        <Button type="button" variant="outline" onClick={() => router.replace('/family')}>
          Back to Family List
        </Button>
      </div>
    </main>
  )
}
