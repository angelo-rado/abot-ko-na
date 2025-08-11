'use client'

import { Suspense } from 'react'
import FamilyPickerPageContent from './FamilyPickerPage'

export default function FamilyJoinPage() {
  return (
    <Suspense fallback={<div className="max-w-xl mx-auto p-6 text-center">Loading…</div>}>
      <FamilyPickerPageContent />
    </Suspense>
  )
}
