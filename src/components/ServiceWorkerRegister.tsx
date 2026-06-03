'use client';
import { useEffect } from 'react';

/**
 * Registers the PWA service worker (production only, to avoid caching during
 * local dev). Renders nothing. Failures are swallowed — the app works fine
 * without the SW; it only adds installability + an offline fallback page.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== 'production' ||
      typeof navigator === 'undefined' ||
      !('serviceWorker' in navigator)
    ) {
      return;
    }
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* registration is best-effort */
    });
  }, []);
  return null;
}
