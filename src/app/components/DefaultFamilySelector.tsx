'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/useAuth'
import { firestore } from '@/lib/firebase'
import {
  collectionGroup,
  documentId,
  doc,
  getDoc,
  onSnapshot,
  query,
  updateDoc,
  setDoc,
  where,
} from 'firebase/firestore'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'

type Family = { id: string; name?: string }
const LOCAL_FAMILY_KEY = 'abot:selectedFamily'

export default function DefaultFamilySelector() {
  const { user } = useAuth()
  const [families, setFamilies] = useState<Family[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [preferred, setPreferred] = useState<string | null>(null)

  // Hydrate families from membership: families/{id}/members/{uid}
  useEffect(() => {
    if (!user?.uid) {
      setFamilies([])
      setLoading(false)
      return
    }

    setLoading(true)
    const q = query(collectionGroup(firestore, 'members'), where(documentId(), '==', user.uid))
    const unsub = onSnapshot(q, async (snap) => {
      const ids = Array.from(
        new Set(
          snap.docs
            .map((d) => d.ref.parent.parent?.id)
            .filter((v): v is string => typeof v === 'string' && v.length > 0)
        )
      )

      const out: Family[] = []
      await Promise.all(
        ids.map(async (id) => {
          try {
            const fam = await getDoc(doc(firestore, 'families', id))
            if (fam.exists()) {
              const data = fam.data() as any
              out.push({ id, name: typeof data?.name === 'string' ? data.name : undefined })
            } else {
              out.push({ id })
            }
          } catch {
            out.push({ id })
          }
        })
      )

      out.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      setFamilies(out)
      setLoading(false)
    })

    return () => unsub()
  }, [user?.uid])

  // Load preferred family (localStorage first, then server)
  useEffect(() => {
    if (!user?.uid) return
    try {
      const ls = localStorage.getItem(LOCAL_FAMILY_KEY)
      if (ls) {
        setPreferred(ls)
        return
      }
    } catch {}
    ;(async () => {
      try {
        const u = await getDoc(doc(firestore, 'users', user.uid))
        const pf = (u.exists() ? (u.data() as any).preferredFamily : null) ?? null
        setPreferred(pf)
        if (pf) try { localStorage.setItem(LOCAL_FAMILY_KEY, pf) } catch {}
      } catch {}
    })()
  }, [user?.uid])

  // Persist helper
  const persistPreferred = async (next: string | null) => {
    if (!user?.uid) return
    setSaving(true)
    try {
      setPreferred(next)
      try {
        if (next) localStorage.setItem(LOCAL_FAMILY_KEY, next)
        else localStorage.removeItem(LOCAL_FAMILY_KEY)
      } catch {}

      const userRef = doc(firestore, 'users', user.uid)
      await updateDoc(userRef, { preferredFamily: next }).catch(async () => {
        await setDoc(userRef, { preferredFamily: next }, { merge: true })
      })
      toast.success(next ? 'Default family updated' : 'Default family cleared')
    } catch (e) {
      toast.error('Could not update default family')
    } finally {
      setSaving(false)
    }
  }

  const canClear = useMemo(() => families.length > 1 && !!preferred, [families.length, preferred])

  return (
    <section className="rounded-lg border p-4 space-y-3 bg-background">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Default family</Label>
        {saving && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" aria-hidden />}
      </div>

      {loading ? (
        <div className="h-10 bg-muted/20 rounded w-full animate-pulse" />
      ) : families.length === 0 ? (
        <p className="text-xs text-muted-foreground">You haven’t joined any families yet.</p>
      ) : (
        <div className="flex items-center gap-2">
          <Select
            value={preferred ?? ''}
            onValueChange={(val) => persistPreferred(val === '' ? null : val)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose default…" />
            </SelectTrigger>
            <SelectContent>
              {/* Optional "None" when user has multiple families */}
              {families.length > 1 && (
                <SelectItem value="">— None —</SelectItem>
              )}
              {families.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name || f.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {canClear && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => persistPreferred(null)}
              disabled={saving}
              title="Clear default"
            >
              Clear
            </Button>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        This sets which family opens by default and is used across the app.
      </p>
    </section>
  )
}
