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
  manualLockUntil?: number
  name?: string
  photoURL?: string | null
  [k: string]: any
}

type GeoState = 'granted' | 'prompt' | 'denied' | 'unknown'

export default function PresenceSettings({ familyId: propFamilyId }: { familyId?: string }) {
  const { user } = useAuth()
  const mountedRef = useRef(true)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])

  // resolvedFamilyId logic: prefer propFamilyId, otherwise resolve from users/{uid}.preferredFamily
  const [resolvedFamilyId, setResolvedFamilyId] = useState<string | null>(propFamilyId ?? null)
  const [serverPreferredResolved, setServerPreferredResolved] = useState<boolean>(false)

  // states for loading & saving
  const [loaded, setLoaded] = useState<boolean>(false)
  const [savingAuto, setSavingAuto] = useState<boolean>(false)

  // member doc state
  const [myMemberDoc, setMyMemberDoc] = useState<MemberDoc | null>(null)
  const [memberLoading, setMemberLoading] = useState<boolean>(true)
  const [savingStatus, setSavingStatus] = useState<boolean>(false)

  // derive autoPresence from member doc
  const autoPresenceMember = (myMemberDoc?.statusSource === 'geo')

  // === user-level auto presence (GLOBAL) ===
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

  // === live geolocation permission probe ===
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
        // @ts-ignore - PermissionName typing varies across TS lib versions
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

  // Resolve familyId from user's preferredFamily if not provided (single-shot)
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
      if (!snap.exists()) {
        setResolvedFamilyId(null)
        return
      }
      const data = snap.data() as any
      const preferred: string | null = data?.preferredFamily ?? null
      if (!preferred) {
        setResolvedFamilyId(null)
        return
      }
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

  // Subscribe to my member doc
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

  // GLOBAL: write user flag and propagate to all families
  const setUserAutoPresenceFlag = useCallback(async (uid: string, enabled: boolean) => {
    await setDoc(doc(firestore, 'users', uid), {
      autoPresence: enabled,
      autoPresenceUpdatedAt: serverTimestamp(),
    }, { merge: true })
  }, [])

  const propagatePresenceToAllFamilies = useCallback(async (uid: string, source: 'geo' | 'manual', name?: string | null, photoURL?: string | null) => {
    const q = fsQuery(collectionGroup(firestore, 'members'), where(documentId(), '==', uid))
    const snaps = await getDocs(q)
    if (snaps.empty) return
    const batch = writeBatch(firestore)
    snaps.forEach(s => {
      batch.set(s.ref, {
        statusSource: source,
        updatedAt: serverTimestamp(),
        ...(name ? { name } : {}),
        ...(photoURL ? { photoURL } : {}),
      }, { merge: true })
    })
    await batch.commit()
  }, [])

  // Toggle auto presence — now GLOBAL
  const handleToggleAuto = useCallback(async (next: boolean) => {
    if (!user?.uid) {
      toast('Sign in to change presence settings.')
      return
    }
    if (!loaded || memberLoading) return
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
      // 1) Set user-level flag
      await setUserAutoPresenceFlag(user.uid, next)

      // 2) Propagate to all families where this user is a member
      const displayName = (user as any).name ?? (user as any).displayName ?? 'Unknown'
      const photoURL = (user as any).photoURL ?? null
      await propagatePresenceToAllFamilies(user.uid, next ? 'geo' : 'manual', displayName, photoURL)

      // 3) (Optional) Ensure current family member reflects change immediately
      if (resolvedFamilyId) {
        const memberRef = doc(firestore, 'families', resolvedFamilyId, 'members', user.uid)
        await setDoc(memberRef, {
          statusSource: next ? 'geo' : 'manual',
          updatedAt: serverTimestamp(),
          name: displayName,
          photoURL,
        }, { merge: true })
      }

      toast.success(`Auto presence ${next ? 'enabled' : 'disabled'} for all families`)
    } catch (err) {
      console.error('[PresenceSettings] toggle write failed', err)
      toast.error('Failed to change auto presence')
    } finally {
      setSavingAuto(false)
    }
  }, [user?.uid, loaded, memberLoading, savingAuto, geoState, requestLocationPermission, setUserAutoPresenceFlag, propagatePresenceToAllFamilies, resolvedFamilyId])

  // Manual status writer (kept as is — still per-family)
  const setStatusManual = useCallback(async (status: 'home' | 'away') => {
    if (!user?.uid || !resolvedFamilyId) return
    if (!loaded || memberLoading) return
    if ((userAutoPresence ?? autoPresenceMember) === true) {
      toast('Turn off auto-presence to set manually.')
      return
    }
    if (savingStatus) return

    setSavingStatus(true)
    try {
      const memberRef = doc(firestore, 'families', resolvedFamilyId, 'members', user.uid)
      const writeData: any = {
        status,
        statusSource: 'manual',
        updatedAt: serverTimestamp(),
        name: (user as any).name ?? (user as any).displayName ?? 'Unknown',
        photoURL: (user as any).photoURL ?? null,
      }
      await setDoc(memberRef, writeData, { merge: true })
      setMyMemberDoc(prev => ({ ...(prev ?? {}), status, statusSource: 'manual' } as MemberDoc))
      toast.success(`Status set to ${status === 'home' ? "I'm home" : "I'm out"}`)
    } catch (err) {
      console.error('setStatusManual', err)
      toast.error('Failed to update status')
    } finally {
      setSavingStatus(false)
    }
  }, [user?.uid, resolvedFamilyId, loaded, memberLoading, savingStatus, userAutoPresence, autoPresenceMember])

  // Disable logic — allow toggle once:
  //  - user is known
  //  - member doc load finished
  //  - permission isn't 'denied'
  //  - we've finished resolving preferred family (even if none set)
  const toggleDisabled =
    savingAuto ||
    !loaded ||
    memberLoading ||
    !user?.uid ||
    (geoState === 'denied') ||
    !serverPreferredResolved

  const manualButtonsDisabled =
    (userAutoPresence ?? autoPresenceMember) || savingStatus || !loaded || memberLoading || !user?.uid || !resolvedFamilyId

  const globalAutoChecked = (userAutoPresence ?? autoPresenceMember) === true

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium">Auto presence</div>
          <div className="text-xs text-muted-foreground">
            Use location to set your presence automatically (applies to all families)
          </div>
        </div>

        {(!loaded || memberLoading) ? (
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

      {/* Hint when no default family is set */}
      {serverPreferredResolved && !resolvedFamilyId && (
        <div className="text-xs text-muted-foreground">
          No default family set.{' '}
          <Link href="/family" className="underline">Choose a family</Link> to see per-family presence.
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

      {/* Manual presence UI (disabled if auto) */}
      <div className="space-y-2">
        <div className="text-sm font-medium">Manual presence</div>
        <div className="text-xs text-muted-foreground">
          {globalAutoChecked
            ? 'Auto-presence is enabled — manual controls are disabled. Turn off auto-presence to set manually.'
            : 'Set your presence manually.'}
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
