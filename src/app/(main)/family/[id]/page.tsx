'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  doc, onSnapshot, collection, onSnapshot as onColSnapshot,
  updateDoc, deleteDoc, arrayRemove, getDoc
} from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { useAuth } from '@/lib/useAuth'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

type Family = { id: string; name?: string; createdBy?: string; members?: string[] }
type MemberRow = { uid: string; displayName?: string; email?: string }

export const dynamic = 'force-dynamic'

export default function FamilyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const search = useSearchParams()
  const joinedFlag = useMemo(() => search.get('joined') === '1', [search])

  const { user, loading: authLoading } = useAuth()
  const [family, setFamily] = useState<Family | null | undefined>(undefined)
  const [members, setMembers] = useState<MemberRow[] | undefined>(undefined)
  const [workingUid, setWorkingUid] = useState<string | null>(null)

  // Auth gate
  useEffect(() => {
    if (!authLoading && !user) router.replace('/login')
  }, [authLoading, user, router])

  // Live family doc
  useEffect(() => {
    if (!id) { setFamily(null); return }
    const ref = doc(firestore, 'families', id)
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) { setFamily(null); return }
      const d = snap.data() as any
      setFamily({
        id: snap.id,
        name: d?.name ?? 'Family',
        createdBy: d?.createdBy ?? '',
        members: Array.isArray(d?.members) ? d.members : undefined,
      })
    }, () => setFamily(null))
    return () => unsub()
  }, [id])

  // Live members subcollection + hydrate names/emails
  useEffect(() => {
    if (!id) { setMembers(undefined); return }
    const colRef = collection(firestore, 'families', id, 'members')
    const unsub = onColSnapshot(colRef, async (snap) => {
      // base list from subcollection doc IDs
      const base = snap.docs.map(d => ({ uid: d.id } as MemberRow))
      // hydrate from users/{uid}
      const enriched = await Promise.all(base.map(async (row) => {
        try {
          const uSnap = await getDoc(doc(firestore, 'users', row.uid))
          if (uSnap.exists()) {
            const u = uSnap.data() as any
            return {
              uid: row.uid,
              displayName: u.displayName ?? u.name ?? '',
              email: u.email ?? '',
            }
          }
        } catch {}
        return row
      }))
      setMembers(enriched)
    }, (err) => {
      console.warn('[family/members] listener error', err)
      setMembers([])
    })
    return () => unsub()
  }, [id])

  const isOwner = !!(user?.uid && family?.createdBy === user.uid)

  async function removeMember(targetUid: string) {
    if (!id || !user?.uid) return
    const self = targetUid === user.uid

    if (!self && !isOwner) {
      toast.error('Only the owner can remove other members.')
      return
    }

    setWorkingUid(targetUid)
    try {
      // 1) delete subcollection membership doc
      await deleteDoc(doc(firestore, 'families', id, 'members', targetUid)).catch(() => {})

      // 2) keep top-level members array in sync if you use it
      try {
        await updateDoc(doc(firestore, 'families', id), { members: arrayRemove(targetUid) })
      } catch {} // ok if field not present / no permission

      toast.success(self ? 'You left the family.' : 'Member removed.')
      if (self) router.replace('/family')
    } catch (err) {
      console.error('removeMember error', err)
      toast.error('Failed to remove member.')
    } finally {
      setWorkingUid(null)
    }
  }

  if (authLoading || family === undefined || members === undefined) {
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

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Members</h2>

        <div className="rounded-md border divide-y bg-background">
          {members.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No members yet.</div>
          ) : (
            members.map((m) => {
              const isSelf = m.uid === user?.uid
              const ownerRow = m.uid === family.createdBy
              return (
                <div key={m.uid} className="flex items-center justify-between p-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {m.displayName || m.uid}
                      </span>
                      {ownerRow && <Badge variant="secondary">Owner</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {m.email || m.uid}
                    </div>
                  </div>

                  <div>
                    {isSelf ? (
                      // Leave button (self)
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => removeMember(m.uid)}
                        disabled={workingUid === m.uid}
                      >
                        {workingUid === m.uid ? 'Leaving…' : 'Leave'}
                      </Button>
                    ) : (
                      // Remove button (owner only)
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => removeMember(m.uid)}
                        disabled={!isOwner || workingUid === m.uid}
                      >
                        {workingUid === m.uid ? 'Removing…' : 'Remove'}
                      </Button>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>

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
