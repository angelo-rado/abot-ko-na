'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/useAuth'
import { firestore } from '@/lib/firebase'
import { collection, doc, getDoc, updateDoc, setDoc } from 'firebase/firestore'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Star } from 'lucide-react'

type Family = {
  id: string
  name?: string
}

type FamilyPickerProps = {
  familyId: string | null
  onFamilyChange: (id: string | null) => void
  families: Family[]
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

  // load preferred family from localStorage or user's doc on mount
  useEffect(() => {
    let cancelled = false

    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem(LOCAL_FAMILY_KEY) : null
      if (stored) {
        console.log('[FamilyPicker] found preferredFamily in localStorage', stored)
        setPreferredFamily(stored)
        return
      }
    } catch (err) {
      // ignore private mode errors
    }

    ;(async () => {
      if (!user?.uid || cancelled) return
      try {
        const userRef = doc(firestore, 'users', user.uid)
        const snap = await getDoc(userRef)
        if (snap.exists()) {
          const data = snap.data() as Record<string, any>
          if (data?.preferredFamily) {
            console.log('[FamilyPicker] found preferredFamily in user doc', data.preferredFamily)
            setPreferredFamily(data.preferredFamily as string)
            try { localStorage.setItem(LOCAL_FAMILY_KEY, data.preferredFamily as string) } catch {}
          }
        }
      } catch (err) {
        console.warn('Could not load preferredFamily from server', err)
      }
    })()

    return () => { cancelled = true }
  }, [user?.uid])

  // If preferredFamily is found locally (or from user doc) AND the parent hasn't selected a family yet,
  // propagate it up so the rest of the app uses it.
  useEffect(() => {
    if (!preferredFamily) return
    if (familyId) {
      // parent already selected something — don't override
      return
    }
    // Ensure preferredFamily exists in provided families before switching
    if (families && families.length > 0 && families.some(f => f.id === preferredFamily)) {
      console.log('[FamilyPicker] propagating preferredFamily to parent', preferredFamily)
      onFamilyChange(preferredFamily)
    } else {
      // families not loaded yet or preferred not found — wait until families arrive
      console.log('[FamilyPicker] preferredFamily present but families not ready or preferred not found yet', { preferredFamily, familiesCount: families?.length ?? 0 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferredFamily, familyId, families])

  // If user only has 1 family and there is no preferred yet, auto-set it (and select it)
  useEffect(() => {
    if (!user?.uid) return
    if (preferredFamily) return
    if (!families || families.length !== 1) return

    const only = families[0]
    // set as preferred and switch dashboard
    persistPreferredFamily(only.id).then(() => {
      onFamilyChange(only.id)
    }).catch((err) => {
      console.warn('Failed to persist default for single family', err)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [families, user?.uid]) // don't include preferredFamily to avoid loops

  // helper to persist preferred family locally + server
  const persistPreferredFamily = async (id: string | null) => {
    // update local state immediately for snappy UI
    setPreferredFamily(id)

    try {
      if (id) localStorage.setItem(LOCAL_FAMILY_KEY, id)
      else localStorage.removeItem(LOCAL_FAMILY_KEY)
    } catch (err) {
      // ignore local storage errors
    }

    if (!user?.uid) return
    setSettingDefault(true)
    try {
      const userRef = doc(firestore, 'users', user.uid)
      // write null to the doc if id === null (best-effort)
      await updateDoc(userRef, { preferredFamily: id }).catch(async () => {
        await setDoc(userRef, { preferredFamily: id }, { merge: true })
      })
    } catch (err) {
      console.warn('Could not persist preferredFamily to Firestore', err)
    } finally {
      setSettingDefault(false)
    }
  }

  if (loading) {
    // skeleton placeholder while families load
    return (
      <div className="mb-4">
        <label className="text-sm text-muted-foreground">Family Picker:</label>
        <div className="mt-2">
          <div className="h-10 bg-muted/20 rounded w-full animate-pulse" />
        </div>
      </div>
    )
  }

  if (!families || families.length === 0) return null

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
          {families.map((f) => {
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
                        // prevent selecting the item — only set default
                        e.stopPropagation()
                        e.preventDefault()

                        if (isDefault) {
                          // If there's only one family, we don't allow unsetting (keeps UI stable)
                          if (families.length === 1) {
                            console.log('[FamilyPicker] Only one family exists — cannot unset default')
                            return
                          }
                          // unset default
                          await persistPreferredFamily(null)
                          return
                        }

                        // set default and switch dashboard immediately
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
