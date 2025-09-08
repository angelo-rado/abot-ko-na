// next.config.js

const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: false,
  skipWaiting: true,
})

/** @type {import('next').NextConfig} */
const nextConfig = withPWA({
  experimental: {
    serverActions: true,
  },
})

module.exports = nextConfig