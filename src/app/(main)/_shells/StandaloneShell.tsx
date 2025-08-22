// app/(main)/_shells/StandaloneShell.tsx
'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import PullToRefresh from '@/app/components/PullToRefresh'

export default function StandaloneShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [refreshKey, setRefreshKey] = useState(0)

  const softRefresh = async () => {
    try { router.refresh() } catch {}
    try { window.dispatchEvent(new CustomEvent('abot-refresh')) } catch {}
    setRefreshKey((k) => k + 1)
    await new Promise((r) => setTimeout(r, 250))
  }

  return (
    <div id="main-scroll" className="h-[100dvh] overflow-y-auto overscroll-contain">
      <PullToRefresh
        getScrollEl={() => document.getElementById('main-scroll')}
        onRefresh={softRefresh}
        className="min-h-[100dvh]"
        safetyTimeoutMs={2500}
        minSpinMs={400}
      >
        {/* Force remount on refreshKey to re-run effects and snapshots */}
        <div key={refreshKey}>
          {children}
        </div>
      </PullToRefresh>
    </div>
  )
}
