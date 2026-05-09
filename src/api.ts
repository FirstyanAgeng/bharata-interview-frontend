import type { AuthSession } from './types'

const API_BASE = import.meta.env.VITE_API_URL?.replace(/\/$/, '') || ''

type FetchOptions = RequestInit & {
  token?: string | null
}

export function getApiBase() {
  return API_BASE
}

export function getSocketBase() {
  return API_BASE || window.location.origin
}

export function buildApiUrl(path: string) {
  return `${API_BASE}${path}`
}

export async function request<T>(path: string, options: FetchOptions = {}) {
  const headers = new Headers(options.headers || {})
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json')
  }
  if (options.token) {
    headers.set('Authorization', `Bearer ${options.token}`)
  }

  const response = await fetch(buildApiUrl(path), {
    ...options,
    headers,
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(payload?.error || 'Permintaan gagal')
  }

  return payload as T
}

export function saveSession(session: AuthSession | null) {
  if (!session) {
    localStorage.removeItem('stok-session')
    return
  }

  localStorage.setItem('stok-session', JSON.stringify(session))
}

export function loadSession(): AuthSession | null {
  const raw = localStorage.getItem('stok-session')
  if (!raw) return null

  try {
    return JSON.parse(raw) as AuthSession
  } catch {
    return null
  }
}
