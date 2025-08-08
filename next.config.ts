// next.config.js

const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
  swSrc: 'firebase-messaging-sw.js', 
})

/** @type {import('next').NextConfig} */
const nextConfig = withPWA({
  experimental: {
    serverActions: true,
  },
  eslint: {
    ignoreDuringBuilds: true, // ✅ Bypass ESLint errors on Vercel builds
  },
})

module.exports = nextConfig
