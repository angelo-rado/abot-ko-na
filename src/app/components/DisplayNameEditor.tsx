'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/useAuth'
import { firestore } from '@/lib/firebase'
import {
  doc,
  getDoc,
  updateDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { getAuth, updateProfile } from 'firebase/auth'
import { useOnlineStatus } from '@/lib/hooks/useOnlinestatus'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'

function normalizeName(raw: string) {
  // trim + collapse internal whitespace
  return raw.replace(/\s+/g, ' ').trim()
}
function isValidName(name: string) {
  // 2–40 chars, allow letters/numbers/space/.-’ (smart apostrophe and straight)
  if (name.length < 2 || name.length > 40) return false
  return /^[A-Za-z0-9 .'\-]+$/.test(name)
}

export default function DisplayNameEditor() {
  const { user } = useAuth()
  const authed = !!user?.uid
  const online = useOnlineStatus()
  const auth = getAuth()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [serverName, setServerName] = useState<string>('') // canonical name from users/{uid} (or auth)
  const [draft, setDraft] = useState<string>('')

  const initialLoadedRef = useRef(false)

  // Load current name (prefer users/{uid}.displayName || .name, fallback to auth)
  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!user?.uid) {
        setLoading(false)
        return
      }
      try {
        // start with auth name
        const authName =
          (auth.currentUser?.displayName ?? '') ||
          (user as any)?.name ||
          ''
        if (alive) {
          setServerName(authName)
          setDraft(authName)
        }

        // hydrate from users doc if present
        const snap = await getDoc(doc(firestore, 'users', user.uid))
        if (alive && snap.exists()) {
          const data = snap.data() as any
          const fromDoc = (data?.displayName ?? data?.name ?? '') as string
          if (fromDoc && fromDoc !== authName) {
            setServerName(fromDoc)
            setDraft(fromDoc)
          }
        }
      } catch {
        // ignore
      } finally {
        if (alive) {
          setLoading(false)
          initialLoadedRef.current = true
        }
      }
    })()
    return () => { alive = false }
  }, [user?.uid, auth])

  const changed = normalizeName(draft) !== normalizeName(serverName)
  const disabled = !authed || !online || saving || !initialLoadedRef.current

  async function save() {
    const next = normalizeName(draft)
    if (!authed) return
    if (!isValidName(next)) {
      toast.error('Name must be 2–40 characters and use letters, numbers, spaces, period, hyphen or apostrophe.')
      return
    }

    setSaving(true)
    try {
      // 1) Auth profile
      if (auth.currentUser) {
        await updateProfile(auth.currentUser, { displayName: next })
      }

      // 2) Firestore users doc
      const userRef = doc(firestore, 'users', user!.uid)
      await updateDoc(userRef, {
        displayName: next,
        name: next,
        updatedAt: serverTimestamp(),
      }).catch(async () => {
        await setDoc(userRef, {
          displayName: next,
          name: next,
          updatedAt: serverTimestamp(),
        }, { merge: true })
      })

      setServerName(next)
      setDraft(next)
      toast.success('Display name updated')
    } catch (e) {
      console.error('update display name failed', e)
      toast.error('Could not update display name.')
    } finally {
      setSaving(false)
    }
  }

  function resetToGoogle() {
    const googleName =
      (auth.currentUser?.displayName ?? '') ||
      (user as any)?.name ||
      ''
    setDraft(googleName)
  }

  return (
    <section className="rounded-lg border p-4 space-y-3 bg-background">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Display name</Label>
        {(loading || saving) && (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" aria-hidden />
        )}
      </div>

      {loading ? (
        <div className="h-10 bg-muted/20 rounded w-full animate-pulse" />
      ) : (
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Your name"
            inputMode="text"
            maxLength={40}
            className="sm:flex-1"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={resetToGoogle}
              disabled={!authed || saving}
              title="Reset to Google profile name"
            >
              Use Google
            </Button>
            <Button
              type="button"
              onClick={save}
              disabled={disabled || !changed}
            >
              Save
            </Button>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        This name appears across the app and in notifications.
      </p>
      {!online && (
        <p className="text-xs text-amber-600 mt-1">
          You’re offline. Reconnect to save changes.
        </p>
      )}
    </section>
  )
}

