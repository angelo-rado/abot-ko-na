'use client'

import { useEffect, useState } from 'react'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { useAuth } from '@/lib/useAuth'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'

type Prefs = {
  delivery: boolean
  presence: boolean
  enroute: boolean
  quietHoursEnabled: boolean
  quietHoursStart: string
  quietHoursEnd: string
}

const DEFAULTS: Prefs = {
  delivery: true,
  presence: true,
  enroute: true,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
}

const TYPE_ROWS: { key: 'delivery' | 'presence' | 'enroute'; label: string; desc: string }[] = [
  { key: 'delivery', label: 'Deliveries', desc: 'New, in-transit, and daily delivery alerts.' },
  { key: 'presence', label: 'Home & away', desc: 'When a family member arrives or leaves home.' },
  { key: 'enroute', label: 'On my way', desc: 'When someone broadcasts they’re heading home.' },
]

export default function NotificationPreferences() {
  const { user } = useAuth()
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!user?.uid) return
    const ref = doc(firestore, 'users', user.uid)
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const p = (snap.data()?.notificationPrefs ?? {}) as Partial<Prefs>
        setPrefs({ ...DEFAULTS, ...p })
        setLoaded(true)
      },
      () => setLoaded(true)
    )
    return () => unsub()
  }, [user?.uid])

  const save = async (patch: Partial<Prefs>) => {
    if (!user?.uid) return
    const next = { ...prefs, ...patch }
    setPrefs(next) // optimistic
    try {
      await setDoc(doc(firestore, 'users', user.uid), { notificationPrefs: next }, { merge: true })
    } catch {
      toast.error('Could not save preference')
    }
  }

  if (!loaded) {
    return <Skeleton className="h-24 w-full rounded-md" />
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {TYPE_ROWS.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <Label className="text-sm font-medium">{row.label}</Label>
              <p className="text-xs text-muted-foreground">{row.desc}</p>
            </div>
            <Switch
              checked={prefs[row.key]}
              onCheckedChange={(v) => save({ [row.key]: v })}
              aria-label={`Toggle ${row.label} notifications`}
            />
          </div>
        ))}
      </div>

      <div className="rounded-md border p-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Label className="text-sm font-medium">Quiet hours</Label>
            <p className="text-xs text-muted-foreground">Silence pushes overnight (your local time).</p>
          </div>
          <Switch
            checked={prefs.quietHoursEnabled}
            onCheckedChange={(v) => save({ quietHoursEnabled: v })}
            aria-label="Toggle quiet hours"
          />
        </div>
        {prefs.quietHoursEnabled && (
          <div className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">From</span>
              <input
                type="time"
                value={prefs.quietHoursStart}
                onChange={(e) => save({ quietHoursStart: e.target.value })}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">to</span>
              <input
                type="time"
                value={prefs.quietHoursEnd}
                onChange={(e) => save({ quietHoursEnd: e.target.value })}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </label>
          </div>
        )}
      </div>
    </div>
  )
}
