'use client';

export const AUTH_EVENT_KEY = 'inventory-auth-event';

export type ApiError = Error & {
  status?: number;
  payload?: unknown;
};

export function isAuthStatus(status: number | undefined): boolean {
  return status === 401 || status === 403;
}

export function broadcastAuthChanged(reason: 'logout' | 'denied' = 'logout') {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    AUTH_EVENT_KEY,
    JSON.stringify({ reason, at: Date.now() }),
  );
}

export function getApiErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'error' in data) {
    const error = (data as { error?: unknown }).error;
    if (typeof error === 'string' && error.trim()) return error;
  }
  return fallback;
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  const data = (await res.json().catch(() => null)) as T;
  if (!res.ok) {
    const err = new Error(
      getApiErrorMessage(data, `Request failed (${res.status})`),
    ) as ApiError;
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

export async function readErrorMessage(
  res: Response,
  fallback = 'เกิดข้อผิดพลาด',
): Promise<string> {
  const data = await res.json().catch(() => null);
  return getApiErrorMessage(data, fallback);
}
