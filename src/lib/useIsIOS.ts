// src/lib/useIsIOS.ts
'use client'
import { useEffect, useState } from 'react'

export function useIsIOS() {
  const [isIOS, setIsIOS] = useState(false)

  useEffect(() => {
    const ua = navigator.userAgent || ''
    const likelyIOS =
      /iP(hone|od|ad)/.test(ua) ||
      // iPadOS on M1/M2 shows "Macintosh" + touch
      (ua.includes('Macintosh') && 'ontouchend' in document)
    setIsIOS(likelyIOS)
    document.documentElement.toggleAttribute('data-platform-ios', likelyIOS)
  }, [])

  return isIOS
}
    