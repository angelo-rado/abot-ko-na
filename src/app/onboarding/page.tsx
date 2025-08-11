'use client'

import { Suspense } from 'react'
import Providers from '@/app/providers'
import OnboardingPage from './_OnBoardingPage' // your existing component

export default function Page() {
  return (
    <Providers>
      <Suspense fallback={<div className="p-6 text-center">Loading...</div>}>
        <OnboardingPage />
      </Suspense>
    </Providers>
  )
}
