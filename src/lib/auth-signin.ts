// src/lib/auth-signin.ts
'use client'

import { signInWithPopup, signInWithRedirect } from 'firebase/auth'
import { auth, provider } from '@/lib/firebase'

/**
 * Only installed PWAs need the redirect flow (they block popups). Mobile
 * browsers can use a popup, which returns the credential via postMessage to
 * our own origin — avoiding the iOS Safari / ITP cross-domain redirect loop.
 */
function prefersRedirect(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
  const isStandalone =
    window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
    // iOS Safari "Add to Home Screen"
    (navigator as unknown as { standalone?: boolean }).standalone === true
  return isStandalone
}

/**
 * Sign in with Google, robust across environments:
 * - Mobile / installed PWA  → redirect (popups are unreliable / blocked there)
 * - Desktop                 → popup, falling back to redirect if it's blocked
 *
 * On the redirect path the page navigates away to Google and back; the auth
 * state is then picked up by the onAuthStateChanged listener in useAuth.
 */
export async function signInWithGoogle(): Promise<void> {
  if (prefersRedirect()) {
    await signInWithRedirect(auth, provider)
    return
  }

  try {
    await signInWithPopup(auth, provider)
  } catch (err) {
    const code = (err as { code?: string })?.code ?? ''
    if (
      code === 'auth/popup-blocked' ||
      code === 'auth/popup-closed-by-user' ||
      code === 'auth/cancelled-popup-request' ||
      code === 'auth/operation-not-supported-in-this-environment'
    ) {
      await signInWithRedirect(auth, provider)
      return
    }
    throw err
  }
}
