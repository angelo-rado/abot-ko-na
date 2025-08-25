'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { doc, getDoc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { useAuth } from '@/lib/useAuth'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'

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
  const autoPresence = (myMemberDoc?.statusSource === 'geo')

  // === NEW: live geolocation permission probe ===
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
        // react to changes (e.g., user flips browser/site permission)
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
      setGeoState('granted') // immediate UI update; Permissions API watcher will keep it in sync afterwards
      return true
    } catch (e: any) {
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
      } catch (err) {
        console.warn('[PresenceSettings] error validating preferredFamily', err)
        setResolvedFamilyId(null)
      }
    }, (err) => {
      console.warn('[PresenceSettings] user snapshot error', err)
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
    }, (err) => {
      console.warn('[PresenceSettings] member onSnapshot error', err)
      setMyMemberDoc(null)
      setMemberLoading(false)
      setLoaded(true)
    })

    return () => unsub()
  }, [resolvedFamilyId, user?.uid])

  // Toggle auto presence — uses boolean result from permission request to avoid stale reads
  const handleToggleAuto = useCallback(async (next: boolean) => {
    if (!user?.uid) {
      toast('Sign in to change presence settings.')
      return
    }
    if (!resolvedFamilyId) {
      toast('Select a family first.')
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
      const memberRef = doc(firestore, 'families', resolvedFamilyId, 'members', user.uid)
      const newSource = next ? 'geo' : 'manual'
      const writeData: any = {
        statusSource: newSource,
        updatedAt: serverTimestamp(),
        name: (user as any).name ?? (user as any).displayName ?? 'Unknown',
        photoURL: (user as any).photoURL ?? null,
      }
      await setDoc(memberRef, writeData, { merge: true })
      setMyMemberDoc(prev => ({ ...(prev ?? {}), statusSource: newSource } as MemberDoc))
      toast.success(`Auto presence ${next ? 'enabled' : 'disabled'}`)
    } catch (err) {
      console.error('[PresenceSettings] toggle write failed', err)
      toast.error('Failed to change auto presence')
    } finally {
      setSavingAuto(false)
    }
  }, [user?.uid, resolvedFamilyId, loaded, memberLoading, savingAuto, geoState, requestLocationPermission])

  // Manual status writer (kept)
  const setStatusManual = useCallback(async (status: 'home' | 'away') => {
    if (!user?.uid || !resolvedFamilyId) return
    if (!loaded || memberLoading) return
    if (autoPresence) {
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
  }, [user?.uid, resolvedFamilyId, autoPresence, loaded, memberLoading, savingStatus])

  // Disable logic
  const canToggleByPermission = geoState !== 'denied'
  const toggleDisabled = savingAuto || !loaded || memberLoading || !user?.uid || !resolvedFamilyId || !canToggleByPermission
  const manualButtonsDisabled = autoPresence || savingStatus || !loaded || memberLoading || !user?.uid || !resolvedFamilyId

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium">Auto presence</div>
          <div className="text-xs text-muted-foreground">
            Use location to set your presence automatically
          </div>
        </div>

        {(!loaded || memberLoading) ? (
          <Skeleton className="h-6 w-12" />
        ) : (
          <Switch
            checked={autoPresence}
            onCheckedChange={(v) => handleToggleAuto(Boolean(v))}
            disabled={toggleDisabled}
            aria-label="Auto presence toggle"
          />
        )}
      </div>

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
          {autoPresence
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
