// src/app/family/layout.tsx
'use client'
import Providers from '@/app/providers'

export default function JoinRouteLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>
}
