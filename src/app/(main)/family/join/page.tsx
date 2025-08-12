import { Suspense } from 'react'
import FamilyJoinPageContent from './FamilyJoinPageContent'
import PageErrorBoundary from './PageErrorBoundary'

export const dynamic = 'force-dynamic'

export default function FamilyJoinPage() {
  return (
    <PageErrorBoundary>
      <Suspense fallback={<div className="max-w-xl mx-auto p-6 text-center">Loading…</div>}>
        <FamilyJoinPageContent />
      </Suspense>
    </PageErrorBoundary>
  )
}
