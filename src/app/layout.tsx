import './globals.css'
import { Inter } from 'next/font/google'
import { cn } from '@/lib/utils'
import type { Metadata } from 'next'
import Providers from './providers'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Abot Ko Na',
  description: 'Realtime family delivery + presence tracking',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' }, // Tab favicon (required)
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png', // iOS home screen
    shortcut: '/favicon.ico',
  },
  manifest: '/site.webmanifest', // PWA manifest
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={cn(inter.className, 'bg-background text-foreground antialiased')}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
