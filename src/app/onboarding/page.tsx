import { Suspense } from 'react'
import OnBoardingPage from './_OnBoardingPage'

export const dynamic = 'force-dynamic'

export default function OnboardingRoute() {
  return (
    <Suspense fallback={<div className="p-6 text-center">Loading…</div>}>
      <OnBoardingPage />
    </Suspense>
  )
}
