'use client'

import { useEffect, useState, useMemo } from 'react'
import { useAuth } from '@/lib/useAuth'
import { firestore } from '@/lib/firebase'
import {
  doc,
  getDoc,
  updateDoc,
  setDoc,
  collectionGroup,
  onSnapshot,
  query,
  where,
  documentId,
} from 'firebase/firestore'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Star } from 'lucide-react'

type Family = { id: string; name?: string }

type FamilyPickerProps = {
  familyId: string | null
  onFamilyChange: (id: string | null) => void
  families: Family[]               // external list still supported
  loading?: boolean
}

const LOCAL_FAMILY_KEY = 'abot:selectedFamily'

export default function FamilyPicker({
  familyId,
  onFamilyChange,
  families,
  loading = false,
}: FamilyPickerProps) {
  const { user } = useAuth()
  const [preferredFamily, setPreferredFamily] = useState<string | null>(null)
  const [settingDefault, setSettingDefault] = useState(false)

  // 🔄 Self-hydration when external families are empty/outdated
  const [hydratedFamilies, setHydratedFamilies] = useState<Family[] | null>(null)

  // choose which list to show: prop wins when provided; fallback to hydrated
  const availableFamilies = useMemo<Family[]>(() => {
    if (families && families.length > 0) return families
    return hydratedFamilies ?? []
  }, [families, hydratedFamilies])

  // === Hydrate from membership subcollection when needed ===
  useEffect(() => {
    if (!user?.uid) { setHydratedFamilies(null); return }
    if (families && families.length > 0) { setHydratedFamilies(null); return } // parent controls list

    const q = query(collectionGroup(firestore, 'members'), where(documentId(), '==', user.uid))
    const unsub = onSnapshot(q, async (snap) => {
      const ids = Array.from(
        new Set(
          snap.docs
            .map((d) => d.ref.parent.parent?.id)
            .filter((v): v is string => typeof v === 'string' && v.length > 0)
        )
      )

      // fetch family names (best-effort)
      const out: Family[] = []
      await Promise.all(
        ids.map(async (id) => {
          try {
            const fam = await getDoc(doc(firestore, 'families', id))
            if (fam.exists()) {
              const data = fam.data() as any
              out.push({ id, name: typeof data?.name === 'string' ? data.name : undefined })
            } else {
              out.push({ id }) // still listable by id
            }
          } catch {
            out.push({ id })
          }
        })
      )

      out.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      setHydratedFamilies(out)
    })

    return () => unsub()
  }, [user?.uid, families])

  // === Load preferred family from LS or user doc on mount ===
  useEffect(() => {
    let cancelled = false

    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem(LOCAL_FAMILY_KEY) : null
      if (stored && !cancelled) {
        setPreferredFamily(stored)
        return
      }
    } catch {}

    ;(async () => {
      if (!user?.uid || cancelled) return
      try {
        const userRef = doc(firestore, 'users', user.uid)
        const snap = await getDoc(userRef)
        if (snap.exists()) {
          const data = snap.data() as Record<string, any>
          if (data?.preferredFamily) {
            if (!cancelled) {
              setPreferredFamily(data.preferredFamily as string)
              try { localStorage.setItem(LOCAL_FAMILY_KEY, data.preferredFamily as string) } catch {}
            }
          }
        }
      } catch {}
    })()

    return () => { cancelled = true }
  }, [user?.uid])

  // === Propagate preferredFamily to parent once available ===
  useEffect(() => {
    if (!preferredFamily) return
    if (familyId) return // parent already chose

    if (availableFamilies.some(f => f.id === preferredFamily)) {
      onFamilyChange(preferredFamily)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    preferredFamily,
    familyId,
    // depend on a stable signature of availableFamilies
    // (avoids reruns from referential changes)
    availableFamilies.length,
    availableFamilies.map(f => f.id).join('|'),
  ])

  // === Auto-pick when the user has exactly one family and no preferred ===
  useEffect(() => {
    if (!user?.uid) return
    if (preferredFamily) return
    if (!availableFamilies || availableFamilies.length !== 1) return

    const only = availableFamilies[0]
    persistPreferredFamily(only.id).then(() => {
      onFamilyChange(only.id)
    }).catch((err) => {
      console.warn('Failed to persist default for single family', err)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableFamilies, user?.uid]) // don't include preferredFamily to avoid loops

  // === Helper: persist preferred family locally + server ===
  const persistPreferredFamily = async (id: string | null) => {
    setPreferredFamily(id)
    try {
      if (id) localStorage.setItem(LOCAL_FAMILY_KEY, id)
      else localStorage.removeItem(LOCAL_FAMILY_KEY)
    } catch {}

    if (!user?.uid) return
    setSettingDefault(true)
    try {
      const userRef = doc(firestore, 'users', user.uid)
      await updateDoc(userRef, { preferredFamily: id }).catch(async () => {
        await setDoc(userRef, { preferredFamily: id }, { merge: true })
      })
    } catch (err) {
      console.warn('Could not persist preferredFamily to Firestore', err)
    } finally {
      setSettingDefault(false)
    }
  }

  if (loading && (families?.length ?? 0) === 0 && (hydratedFamilies?.length ?? 0) === 0) {
    return (
      <div className="mb-4">
        <label className="text-sm text-muted-foreground">Family Picker:</label>
        <div className="mt-2">
          <div className="h-10 bg-muted/20 rounded w-full animate-pulse" />
        </div>
      </div>
    )
  }

  if (!availableFamilies || availableFamilies.length === 0) return null

  return (
    <div className="mb-4">
      <label className="text-sm text-muted-foreground">Family Picker:</label>

      <Select
        value={familyId ?? ''}
        onValueChange={(val) => onFamilyChange(val === '' ? null : val)}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select Family" />
        </SelectTrigger>

        <SelectContent>
          {availableFamilies.map((f) => {
            const isDefault = preferredFamily === f.id
            return (
              <SelectItem key={f.id} value={f.id}>
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <span className="truncate">{f.name ?? 'Unnamed Family'}</span>
                    {isDefault && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground border border-muted-foreground/10">
                              Default
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <p>This is your default family</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation()
                        e.preventDefault()

                        if (isDefault) {
                          if (availableFamilies.length === 1) {
                            console.log('[FamilyPicker] Only one family exists — cannot unset default')
                            return
                          }
                          await persistPreferredFamily(null)
                          return
                        }

                        await persistPreferredFamily(f.id)
                        onFamilyChange(f.id)
                      }}
                      disabled={settingDefault}
                      aria-label={isDefault ? 'Unset default family' : 'Set as default family'}
                      className="p-1 rounded hover:bg-muted/50"
                    >
                      {isDefault ? (
                        <Star className="w-4 h-4 text-yellow-500" />
                      ) : (
                        <Star className="w-4 h-4 text-muted-foreground/70" />
                      )}
                    </button>
                  </div>
                </div>
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
    </div>
  )
}
