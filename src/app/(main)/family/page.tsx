'use client'

import { Suspense } from 'react'
import FamilyPickerPage from './FamilyPickerPage'

export default function FamilyJoinPage() {
  return (
    <Suspense fallback={<div className="max-w-xl mx-auto p-6 text-center">Loading…</div>}>
      <FamilyPickerPage />
    </Suspense>
  )
}
