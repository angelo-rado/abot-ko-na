'use client'

import { Suspense } from 'react'
import FamilyJoinPageContent from './FamilyJoinPageContent'

export default function FamilyJoinPage() {
  return (
    <Suspense fallback={<div className="max-w-xl mx-auto p-6 text-center">Loading…</div>}>
      <FamilyJoinPageContent />
    </Suspense>
  )
}
