// app/onboarding/page.tsx
import { Suspense } from 'react'
import OnboardingPage from './_OnBoardingPage'

export default function OnboardingPageWrapper() {
  return (
    <Suspense fallback={<div className="p-6 text-center text-sm text-muted-foreground">Loading onboarding…</div>}>
      <OnboardingPage />
    </Suspense>
  )
}
