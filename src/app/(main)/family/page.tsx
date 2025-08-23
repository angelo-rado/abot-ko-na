'use client'

import { Suspense } from 'react'
import FamilyPickerPage from './FamilyPickerPage'

export const dynamic = 'force-dynamic'

export default function FamilyPage() {
  return (
    <Suspense fallback={<div className="max-w-xl mx-auto p-6 text-center">Loading…</div>}>
      <FamilyPickerPage />
    </Suspense>
  )
}

