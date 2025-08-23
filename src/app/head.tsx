// src/app/head.tsx
export default function Head() {
  return (
    <>
      <title>Abot Ko Na</title>
      <meta name="description" content="Realtime family delivery + presence tracking" />

      {/* ✅ PWA Meta + Manifest */}
      <link rel="manifest" href="/site.webmanifest" />
      <meta name="theme-color" content="#2563eb" />
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    </>
  )
}

