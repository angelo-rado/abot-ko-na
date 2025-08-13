'use client'
import Providers from '@/app/providers'

export default function JoinRouteLayout({ children }: { children: React.ReactNode }) {
  // Ensure auth/theme/providers are available on /family/join
  return <Providers>{children}</Providers>
}
