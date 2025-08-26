'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  doc, getDoc, onSnapshot, setDoc, serverTimestamp,
  collectionGroup, query as fsQuery, where, documentId, getDocs, writeBatch,
} from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { useAuth } from '@/lib/useAuth'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import Link from 'next/link'

type MemberDoc = {
  status?: 'home' | 'away' | string
  statusSource?: string | null
  updatedAt?: any
  lastUpdated?: any
  manualLockUntil?: number
  name?: string
  photoURL?: string | null
  uid?: string
  autoPresence?: boolean
  [k: string]: any
}

type GeoState = 'granted' | 'prompt' | 'denied' | 'unknown'

/** Collect every membership doc for this uid (docId==uid, uid field, or users/{uid}.familiesJoined). */
async function robustFindMembershipRefs(uid: string) {
  const refs: any[] = []

  // A) /families/*/members/{docId == uid}
  const byId = await getDocs(fsQuery(collectionGroup(firestore, 'members'), where(documentId(), '==', uid)))
  byId.forEach(s => refs.push(s.ref))

  // B) /families/*/members/* where field uid == uid
  const byField = await getDocs(fsQuery(collectionGroup(firestore, 'members'), where('uid', '==', uid)))
  byField.forEach(s => {
    if (!refs.some(r => r.path === s.ref.path)) refs.push(s.ref)
  })

  // C) fallback: users/{uid}.familiesJoined (array of familyIds)
  if (refs.length === 0) {
    const u = await getDoc(doc(firestore, 'users', uid))
    const arr = (u.data()?.familiesJoined as string[] | undefined) || []
    arr.forEach(fid => refs.push(doc(firestore, 'families', fid, 'members', uid)))
  }

  return refs
}

export default function PresenceSettings({ familyId: propFamilyId }: { familyId?: string }) {
  const { user } = useAuth()
  const mountedRef = useRef(true)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])

  // We still resolve a family for manual controls, but the toggle is GLOBAL
  const [resolvedFamilyId, setResolvedFamilyId] = useState<string | null>(propFamilyId ?? null)
  const [serverPreferredResolved, setServerPreferredResolved] = useState<boolean>(false)

  // loading/saving
  const [loaded, setLoaded] = useState<boolean>(false)
  const [savingAuto, setSavingAuto] = useState<boolean>(false)

  // current family member (for manual controls + fallback)
  const [myMemberDoc, setMyMemberDoc] = useState<MemberDoc | null>(null)
  const [memberLoading, setMemberLoading] = useState<boolean>(true)
  const [savingStatus, setSavingStatus] = useState<boolean>(false)

  // user-level auto presence (GLOBAL flag)
  const [userAutoPresence, setUserAutoPresence] = useState<boolean | null>(null)
  useEffect(() => {
    if (!user?.uid) { setUserAutoPresence(null); return }
    const uref = doc(firestore, 'users', user.uid)
    const unsub = onSnapshot(uref, (snap) => {
      const data = snap.data() as any
      setUserAutoPresence(typeof data?.autoPresence === 'boolean' ? !!data.autoPresence : null)
    }, () => setUserAutoPresence(null))
    return () => unsub()
  }, [user?.uid])

  // live geolocation permission probe
  const [geoState, setGeoState] = useState<GeoState>('unknown')
  const [geoWorking, setGeoWorking] = useState(false)

  useEffect(() => {
    let alive = true
    async function probe() {
      try {
        if (typeof navigator === 'undefined' || !('permissions' in navigator)) {
          if (alive) setGeoState('prompt')
          return
        }
        // @ts-ignore
        const status: PermissionStatus = await (navigator as any).permissions.query({ name: 'geolocation' as any })
        if (!alive) return
        setGeoState(((status?.state as any) ?? 'unknown') as GeoState)
        status.onchange = () => {
          if (!alive) return
          setGeoState((((status as any).state as any) ?? 'unknown') as GeoState)
        }
      } catch {
        if (alive) setGeoState('prompt')
      }
    }
    probe()
    return () => { alive = false }
  }, [])

  const requestLocationPermission = useCallback(async (): Promise<boolean> => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      toast.error('Geolocation is not supported on this device/browser.')
      return false
    }
    setGeoWorking(true)
    try {
      await new Promise<void>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          () => resolve(),
          (err) => reject(err),
          { enableHighAccuracy: true, timeout: 15000 }
        )
      })
      toast.success('Location permission granted')
      setGeoState('granted')
      return true
    } catch {
      setGeoState('denied')
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
      if (isMobile) {
        toast.error('Location access denied. Please enable location in your device settings.', {
          action: {
            label: 'How?',
            onClick: () => {
              if (/Android/i.test(navigator.userAgent)) {
                window.open('intent://settings#Intent;scheme=android.settings.LOCATION_SOURCE_SETTINGS;end')
              } else {
                alert('To enable location on iOS:\n\n1) Open Settings\n2) Scroll to Safari (or your browser)\n3) Tap Location\n4) Set to “While Using the App”.')
              }
            }
          }
        })
      } else {
        toast.error('Location permission is required for auto presence.')
      }
      return false
    } finally {
      setGeoWorking(false)
    }
  }, [])

  // Resolve preferred family (manual controls live here)
  useEffect(() => {
    if (!user?.uid || propFamilyId) {
      if (propFamilyId) setResolvedFamilyId(propFamilyId)
      setServerPreferredResolved(true)
      return
    }
    let cancelled = false
    const userRef = doc(firestore, 'users', user.uid)
    const unsub = onSnapshot(userRef, async (snap) => {
      if (cancelled || !mountedRef.current) return
      setServerPreferredResolved(true)
      if (!snap.exists()) { setResolvedFamilyId(null); return }
      const data = snap.data() as any
      const preferred: string | null = data?.preferredFamily ?? null
      if (!preferred) { setResolvedFamilyId(null); return }
      try {
        const famRef = doc(firestore, 'families', preferred)
        const famSnap = await getDoc(famRef)
        if (!mountedRef.current) return
        if (famSnap.exists()) {
          setResolvedFamilyId(preferred)
          try { localStorage.setItem('abot:selectedFamily', preferred) } catch {}
        } else {
          setResolvedFamilyId(null)
          try { localStorage.removeItem('abot:selectedFamily') } catch {}
        }
      } catch {
        setResolvedFamilyId(null)
      }
    }, () => {
      setServerPreferredResolved(true)
    })
    return () => { cancelled = true; unsub() }
  }, [user?.uid, propFamilyId])

  // Subscribe to current-family member doc
  useEffect(() => {
    if (!user?.uid || !resolvedFamilyId) {
      setMyMemberDoc(null)
      setMemberLoading(false)
      setLoaded(true)
      return
    }

    setMemberLoading(true)
    setLoaded(false)
    const memberRef = doc(firestore, 'families', resolvedFamilyId, 'members', user.uid)

    const unsub = onSnapshot(memberRef, (snap) => {
      if (!mountedRef.current) return
      if (!snap.exists()) {
        setMyMemberDoc(null)
        setMemberLoading(false)
        setLoaded(true)
        return
      }
      const data = snap.data() as any

      // Backfill uid once for robust collectionGroup queries
      if (user?.uid && !data?.uid) {
        setDoc(memberRef, { uid: user.uid }, { merge: true }).catch(() => {})
      }

      setMyMemberDoc({ uid: snap.id, ...(data ?? {}) } as MemberDoc)
      setMemberLoading(false)
      setLoaded(true)
    }, () => {
      setMyMemberDoc(null)
      setMemberLoading(false)
      setLoaded(true)
    })

    return () => unsub()
  }, [resolvedFamilyId, user?.uid])

  // Chunked global propagation; sets both autoPresence + statusSource
  const propagatePresenceToAllFamilies = useCallback(async (uid: string, enabled: boolean) => {
    const refs = await robustFindMembershipRefs(uid)
    if (refs.length === 0) return 0

    const CHUNK = 400
    let written = 0
    for (let i = 0; i < refs.length; i += CHUNK) {
      const batch = writeBatch(firestore)
      const slice = refs.slice(i, i + CHUNK)
      slice.forEach(ref => {
        batch.set(ref, {
          autoPresence: enabled,
          statusSource: enabled ? 'geo' : 'manual',
          updatedAt: Date.now(),
          lastUpdated: serverTimestamp(),
          uid, // ensure present for future queries
        }, { merge: true })
      })
      await batch.commit()
      written += slice.length
    }

    if (typeof window !== 'undefined') {
      console.debug('[PresenceSettings] propagated to member docs:', refs.map(r => r.path))
    }
    return written
  }, [])

  // Toggle handler (GLOBAL)
  const handleToggleAuto = useCallback(async (next: boolean) => {
    if (!user?.uid) {
      toast('Sign in to change presence settings.')
      return
    }
    if (savingAuto) return

    if (next) {
      if (geoState === 'denied') {
        toast.error('Location is blocked. Enable it in your browser/site settings.')
        return
      }
      if (geoState !== 'granted') {
        const ok = await requestLocationPermission()
        if (!ok) return
      }
    }

    setSavingAuto(true)
    try {
      const displayName = (user as any).name ?? (user as any).displayName ?? 'Unknown'
      const photoURL = (user as any).photoURL ?? null

      // 1) Set user-level flag
      await setDoc(doc(firestore, 'users', user.uid), {
        autoPresence: next,
        autoPresenceUpdatedAt: serverTimestamp(),
        name: displayName,
        photoURL,
      }, { merge: true })

      // 2) Propagate to ALL memberships (sets both autoPresence + statusSource)
      const count = await propagatePresenceToAllFamilies(user.uid, next)

      // 3) Ensure current family reflects immediately (if visible)
      if (resolvedFamilyId) {
        await setDoc(doc(firestore, 'families', resolvedFamilyId, 'members', user.uid), {
          autoPresence: next,
          statusSource: next ? 'geo' : 'manual',
          updatedAt: Date.now(),
          lastUpdated: serverTimestamp(),
          name: displayName,
          photoURL,
          uid: user.uid,
        }, { merge: true })
      }

      toast.success(`Auto presence ${next ? 'enabled' : 'disabled'} · updated ${count} membership${count === 1 ? '' : 's'}`)
    } catch (err) {
      console.error('[PresenceSettings] toggle write failed', err)
      toast.error('Failed to change auto presence')
    } finally {
      setSavingAuto(false)
    }
  }, [user?.uid, geoState, requestLocationPermission, savingAuto, propagatePresenceToAllFamilies, resolvedFamilyId])

  // Manual (per-family)
  const setStatusManual = useCallback(async (status: 'home' | 'away') => {
    if (!user?.uid || !resolvedFamilyId) return
    if (savingStatus) return
    const autoOn = (userAutoPresence ?? myMemberDoc?.autoPresence ?? (myMemberDoc?.statusSource === 'geo')) === true
    if (autoOn) {
      toast('Turn off auto-presence to set manually.')
      return
    }

    setSavingStatus(true)
    try {
      const memberRef = doc(firestore, 'families', resolvedFamilyId, 'members', user.uid)
      await setDoc(memberRef, {
        status,
        statusSource: 'manual',
        updatedAt: Date.now(),
        lastUpdated: serverTimestamp(),
        name: (user as any).name ?? (user as any).displayName ?? 'Unknown',
        photoURL: (user as any).photoURL ?? null,
        uid: user.uid,
      }, { merge: true })
      toast.success(`Status set to ${status === 'home' ? "I'm home" : "I'm out"}`)
    } catch (err) {
      console.error('setStatusManual', err)
      toast.error('Failed to update status')
    } finally {
      setSavingStatus(false)
    }
  }, [user?.uid, resolvedFamilyId, savingStatus, userAutoPresence, myMemberDoc?.autoPresence, myMemberDoc?.statusSource])

  // Switch enabled state — global toggle doesn’t need a family
  const toggleDisabled = savingAuto || !user?.uid
  const manualButtonsDisabled =
    savingStatus || !user?.uid || !resolvedFamilyId ||
    (userAutoPresence ?? myMemberDoc?.autoPresence ?? (myMemberDoc?.statusSource === 'geo')) === true

  const globalAutoChecked =
    (userAutoPresence ??
      (myMemberDoc?.autoPresence === true ? true : undefined) ??
      (myMemberDoc?.statusSource === 'geo' ? true : false)
    ) === true

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium">Auto presence</div>
          <div className="text-xs text-muted-foreground">
            Use location to set your presence automatically (applies to all families)
          </div>
        </div>

        {user?.uid == null ? (
          <Skeleton className="h-6 w-12" />
        ) : (
          <Switch
            checked={globalAutoChecked}
            onCheckedChange={(v) => handleToggleAuto(Boolean(v))}
            disabled={toggleDisabled}
            aria-label="Auto presence toggle"
          />
        )}
      </div>

      {/* Hint when no default family is set (deep-links and focuses selector) */}
      {serverPreferredResolved && !resolvedFamilyId && (
        <div className="text-xs text-muted-foreground">
          No default family set.{' '}
          <button
            type="button"
            onClick={() => {
              try {
                if (typeof window === 'undefined') return
                if (window.location.pathname === '/settings') {
                  try { window.history.replaceState(null, '', '#default-family') } catch {}
                  window.dispatchEvent(new CustomEvent('focus-default-family'))
                } else {
                  window.location.href = '/settings#default-family'
                }
              } catch {}
            }}
            className="underline underline-offset-2"
          >
            Choose a family
          </button>
          .
        </div>
      )}

      {/* Permission helpers */}
      {geoState === 'denied' && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Location is blocked by the browser. Allow it in Site Settings to enable auto-presence.
        </p>
      )}
      {geoState !== 'granted' && (
        <Button type="button" variant="outline" size="sm" onClick={requestLocationPermission} disabled={geoWorking}>
          {geoWorking ? 'Requesting…' : 'Request location access'}
        </Button>
      )}

      {/* Manual presence (per-family) */}
      <div className="space-y-2">
        <div className="text-sm font-medium">Manual presence</div>
        <div className="text-xs text-muted-foreground">
          {globalAutoChecked
            ? 'Auto-presence is enabled — manual controls are disabled. Turn off auto-presence to set manually.'
            : resolvedFamilyId
              ? 'Set your presence manually for this family.'
              : 'Pick a family to set presence manually.'}
        </div>

        <div className="flex gap-2 mt-2">
          <Button
            type="button"
            onClick={() => setStatusManual('home')}
            disabled={manualButtonsDisabled}
            variant={myMemberDoc?.status === 'home' ? 'default' : 'outline'}
          >
            I&apos;m home
          </Button>
          <Button
            onClick={() => setStatusManual('away')}
            disabled={manualButtonsDisabled}
            variant={myMemberDoc?.status === 'away' ? 'default' : 'outline'}
          >
            I&apos;m out
          </Button>
        </div>
      </div>
    </div>
  )
}
