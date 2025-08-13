'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  arrayRemove,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
} from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { useAuth } from '@/lib/useAuth'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

type Family = {
  id: string
  name?: string | null
  createdBy?: string | null
}

type MemberRow = {
  uid: string
  name?: string | null
  email?: string | null
  role?: string | null
}

const LOCAL_FAMILY_KEY = 'abot:selectedFamily'

export const dynamic = 'force-dynamic'

export default function FamilyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const search = useSearchParams()
  const joinedFlag = useMemo(() => search.get('joined') === '1', [search])

  const [family, setFamily] = useState<Family | null | undefined>()
  const [members, setMembers] = useState<MemberRow[] | undefined>()
  const [busy, setBusy] = useState<string | null>(null)

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
      setFamily({ id: snap.id, name: data?.name ?? null, createdBy: data?.createdBy ?? null })
    }, (err) => {
      console.error('[family] family doc error', err)
      setFamily(null)
    })
    return () => unsub()
  }, [id])

  // members subcollection
  useEffect(() => {
    if (!id) { setMembers(undefined); return }
    const colRef = collection(firestore, 'families', String(id), 'members')
    const unsub = onSnapshot(colRef, async (snap) => {
      const base = snap.docs.map(d => ({ uid: d.id, ...(d.data() as any) } as MemberRow))
      // hydrate from users/{uid}
      const enriched = await Promise.all(base.map(async (row) => {
        try {
          const uSnap = await getDoc(doc(firestore, 'users', row.uid))
          if (!uSnap.exists()) return row
          const u = uSnap.data() as any
          return {
            ...row,
            name: typeof u?.displayName === 'string' ? u.displayName : row.name ?? null,
            email: typeof u?.email === 'string' ? u.email : row.email ?? null,
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

  const isOwner = user && family?.createdBy === user.uid

  async function handleRemoveMember(targetUid: string) {
    if (!user || !id) return
    if (targetUid !== user.uid && !isOwner) {
      toast.error('Only the owner can remove other members.')
      return
    }
    setBusy(targetUid)
    try {
      // remove from subcollection
      await deleteDoc(doc(firestore, 'families', String(id), 'members', targetUid))
      // update users/{uid}.joinedFamilies
      await setDoc(doc(firestore, 'users', targetUid), { joinedFamilies: arrayRemove(String(id)) }, { merge: true })
      if (targetUid === user.uid) {
        // if leaving self, clear local selection and go back
        if (localStorage.getItem(LOCAL_FAMILY_KEY) === String(id)) {
          localStorage.removeItem(LOCAL_FAMILY_KEY)
        }
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

  if (family === undefined || members === undefined) {
    return (
      <div className="max-w-2xl mx-auto p-6 text-muted-foreground flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
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

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{family.name || 'Untitled Family'}</h1>
        {isOwner && <Badge variant="outline">Owner</Badge>}
      </div>
      <Separator />
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Members</h2>
        <ul className="divide-y rounded-md border">
          {members!.map(m => (
            <li key={m.uid} className="flex items-center justify-between p-3 text-sm">
              <div className="min-w-0">
                <div className="font-medium truncate">{m.name || m.email || m.uid}</div>
                <div className="text-muted-foreground truncate">{m.email || '—'}</div>
              </div>
              <div className="flex items-center gap-2">
                {m.uid === family.createdBy && <Badge variant="secondary">Owner</Badge>}
                {(isOwner || m.uid === user?.uid) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === m.uid}
                    onClick={() => handleRemoveMember(m.uid)}
                  >
                    {busy === m.uid ? 'Removing…' : (m.uid === user?.uid ? 'Leave' : 'Remove')}
                  </Button>
                )}
              </div>
            </li>
          ))}
          {members!.length === 0 && (
            <li className="p-3 text-muted-foreground">No members yet.</li>
          )}
        </ul>
      </section>
    </div>
  )
}
