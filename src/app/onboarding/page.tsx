'use client'

import { Suspense } from 'react'
import OnboardingPage from './_OnBoardingPage' // your existing component

export default function Page() {
  return (
      <Suspense fallback={<div className="p-6 text-center">Loading...</div>}>
        <OnboardingPage />
      </Suspense>
  )
}
