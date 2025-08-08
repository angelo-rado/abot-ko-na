// app/layout.tsx
import './globals.css'
import { Inter } from 'next/font/google'
import { cn } from '@/lib/utils'
import type { Metadata } from 'next'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Abot Ko Na',
  description: 'Realtime family delivery + presence tracking',
  icons: {
    icon: [
      { url: '/maskable_icon_x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/maskable_icon_x128.png', sizes: '128x128', type: 'image/png' },
      { url: '/maskable_icon_x512.png', sizes: '512x512', type: 'image/png' },
      { url: 'maskable_icon_x96.png',   sizes: '96x96',   type: 'image/png' },
      { url: 'maskable_icon_x72.png',   sizes: '72x72',   type: 'image/png' },
      { url: '/maskable_icon_x384.png', sizes: '384x384', type: 'image/png' },
      { url: '/maskable_icon_x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icon-192.png',
    shortcut: '/icon-192.png',
  },

}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={cn(inter.className, 'bg-background text-foreground')}>
        {children}
      </body>
    </html>
  )
}


