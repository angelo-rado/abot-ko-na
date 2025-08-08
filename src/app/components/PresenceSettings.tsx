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

export default function PresenceSettings({ familyId: propFamilyId }: { familyId?: string }) {
  const { user } = useAuth()
  const mountedRef = useRef(true)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])

  // resolvedFamilyId logic: prefer propFamilyId, otherwise resolve from users/{uid}.preferredFamily
  const [resolvedFamilyId, setResolvedFamilyId] = useState<string | null>(propFamilyId ?? null)
  const [serverPreferredResolved, setServerPreferredResolved] = useState<boolean>(false)

  // states for loading & saving
  const [loaded, setLoaded] = useState<boolean>(false) // true once we've read member doc (or confirmed missing)
  const [savingAuto, setSavingAuto] = useState<boolean>(false)

  // member doc state (doc-level)
  // NOTE: start memberLoading as `true` to avoid flash of enabled controls on first render
  const [myMemberDoc, setMyMemberDoc] = useState<MemberDoc | null>(null)
  const [memberLoading, setMemberLoading] = useState<boolean>(true)
  const [savingStatus, setSavingStatus] = useState<boolean>(false)

  // derive autoPresence from member doc
  const autoPresence = (myMemberDoc?.statusSource === 'geo')

  // Add these helper functions (outside the component)
  async function checkLocationPermission(): Promise<boolean> {
    try {
      const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName })
      return status.state === 'granted'
    } catch (err) {
      console.warn('[Presence] Permissions API unsupported or failed', err)
      return false
    }
  }

  async function requestLocationPermission(): Promise<boolean> {
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        () => resolve(true),
        (err) => {
          console.warn('[Presence] Geolocation permission denied', err)
          resolve(false)
        }
      )
    })
  }

  // Resolve familyId from user's preferredFamily if not provided (single-shot)
  useEffect(() => {
    if (!user?.uid || propFamilyId) {
      // if prop given, make sure resolvedFamilyId is that
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
      // validate family exists
      try {
        const famRef = doc(firestore, 'families', preferred)
        const famSnap = await getDoc(famRef)
        if (!mountedRef.current) return
        if (famSnap.exists()) {
          setResolvedFamilyId(preferred)
          try { localStorage.setItem('abot:selectedFamily', preferred) } catch { }
        } else {
          setResolvedFamilyId(null)
          try { localStorage.removeItem('abot:selectedFamily') } catch { }
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

  // Subscribe to my member doc (doc-level) so we get latest statusSource quickly
  useEffect(() => {
    // mark loading state clearly whenever resolvedFamilyId or user changes
    if (!user?.uid || !resolvedFamilyId) {
      setMyMemberDoc(null)
      setMemberLoading(false)
      // mark loaded true so the switch isn't stuck if there's no family selected
      setLoaded(true)
      return
    }

    setMemberLoading(true)
    setLoaded(false)
    const memberRef = doc(firestore, 'families', resolvedFamilyId, 'members', user.uid)

    // Attach onSnapshot for live updates
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

  // Handler to toggle auto presence. It will be disabled until `loaded === true` and it's not currently saving.
  const handleToggleAuto = useCallback(async (next: boolean) => {
    if (!user?.uid) {
      toast('Sign in to change presence settings.')
      return
    }
    if (!resolvedFamilyId) {
      toast('Select a family first.')
      return
    }
    if (!loaded || memberLoading) {
      console.debug('[PresenceSettings] toggle clicked while loading — ignored')
      return
    }
    if (savingAuto) {
      console.debug('[PresenceSettings] toggle clicked while savingAuto — ignored')
      return
    }

    // If enabling auto-presence, confirm location access first
    if (next) {
      const alreadyGranted = await checkLocationPermission()
      if (!alreadyGranted) {
        const granted = await requestLocationPermission()

        if (!granted) {
          const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

          if (isMobile) {
            toast.error('Location access denied. Please enable location in your device settings.', {
              action: {
                label: 'How?',
                onClick: () => {
                  if (/Android/i.test(navigator.userAgent)) {
                    // Android: attempt to open location settings (will work in some PWAs / WebViews)
                    window.open('intent://settings#Intent;scheme=android.settings.LOCATION_SOURCE_SETTINGS;end')
                  } else {
                    // iOS: show helpful alert (iOS blocks direct settings links)
                    alert('To enable location on iOS:\n\n1. Open Settings\n2. Scroll to Safari (or your browser)\n3. Tap Location\n4. Set to “While Using the App”')
                  }
                }
              }
            })
          } else {
            toast.error('Location permission is required for auto presence.')
          }

          return
        }
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
  }, [user?.uid, resolvedFamilyId, loaded, memberLoading, savingAuto])


  // Manual status writer (used by home page buttons). Keep here for reference — not touched now.
  const setStatusManual = useCallback(async (status: 'home' | 'away') => {
    // Defensive guards
    if (!user?.uid || !resolvedFamilyId) return
    if (!loaded || memberLoading) {
      console.debug('[PresenceSettings] setStatusManual called while loading — ignored')
      return
    }
    // If autoPresence is true, prevent manual write — UI should disable buttons
    if (autoPresence) {
      toast('Turn off auto-presence to set manually.')
      return
    }
    if (savingStatus) {
      console.debug('[PresenceSettings] setStatusManual called while savingStatus — ignored')
      return
    }

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

  // UI: disable the toggle while we haven't loaded the member doc OR while saving,
  // and also while we don't have a user/family
  const toggleDisabled = savingAuto || !loaded || memberLoading || !user?.uid || !resolvedFamilyId
  // Disable manual buttons while auto/on saving/loading, and when no user/family
  const manualButtonsDisabled = autoPresence || savingStatus || !loaded || memberLoading || !user?.uid || !resolvedFamilyId

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">Auto presence</div>
          <div className="text-xs text-muted-foreground">Use location to set your presence automatically</div>
        </div>

        {/* show skeleton until we know loaded; switch disabled while saving or not loaded */}
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
        {autoPresence && (
          <div className="text-xs text-muted-foreground mt-1">
            Location access is required to determine presence automatically.
          </div>
        )}
      </div>

      {/* Manual presence UI (kept but will be disabled if auto is on) */}
      <div className="space-y-2">
        <div className="text-sm font-medium">Manual presence</div>
        <div className="text-xs text-muted-foreground">
          {autoPresence
            ? 'Auto-presence is enabled — manual controls are disabled. Turn off auto-presence to set manually.'
            : 'Set your presence manually.'}
        </div>

        <div className="flex gap-2 mt-2">
          <Button
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
