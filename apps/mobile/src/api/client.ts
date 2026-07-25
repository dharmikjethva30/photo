/**
 * The API client.
 *
 * Owns three things that are easy to get subtly wrong:
 *   - attaching the access token
 *   - refreshing exactly ONCE when several requests 401 together
 *   - turning problem+json into a typed error the UI can branch on
 */
import Constants from 'expo-constants'
import { clearSession, getSession, setSession } from '../auth/session'
import { ApiError } from './errors'
import type { ProblemDetails, Session } from './types'

/**
 * The emulator is a separate machine: `localhost` there is the emulator itself, so
 * the host Mac is 10.0.2.2. That is the default in app.config.ts; a physical device
 * needs the LAN IP via EXPO_PUBLIC_API_BASE_URL.
 */
export const API_BASE_URL: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? 'http://10.0.2.2:8080'

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Skip the Authorization header — sign-in and refresh must not send one. */
  anonymous?: boolean
  signal?: AbortSignal
}

/**
 * The single-flight refresh promise.
 *
 * WHY THIS MATTERS: the server treats a refresh token as single-use and revokes the
 * whole token family when it sees one reused. A screen that fires five parallel
 * requests on a cold start produces five 401s; without this, five concurrent
 * refreshes race, four of them present a token that has already been rotated, and
 * the server correctly concludes it is under attack and signs the user out.
 *
 * So: whoever gets there first refreshes, everyone else awaits the same promise.
 */
let inFlightRefresh: Promise<Session | null> | null = null

async function refreshSession(): Promise<Session | null> {
  if (inFlightRefresh) return inFlightRefresh

  inFlightRefresh = (async () => {
    const current = await getSession()
    if (!current?.refreshToken) return null

    try {
      const res = await fetch(`${API_BASE_URL}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      })
      if (!res.ok) {
        // The refresh token is spent, revoked or expired. Nothing to salvage.
        await clearSession()
        return null
      }
      const session = (await res.json()) as Session
      await setSession(session)
      return session
    } catch {
      // A network failure is NOT a reason to destroy the session — the token may
      // still be valid. Leave it and let the caller surface the network error.
      return null
    } finally {
      inFlightRefresh = null
    }
  })()

  return inFlightRefresh
}

async function parseProblem(res: Response): Promise<ApiError> {
  let problem: ProblemDetails | undefined
  try {
    const body = await res.json()
    if (body && typeof body === 'object' && 'type' in body) {
      problem = body as ProblemDetails
    }
  } catch {
    // Not problem+json — a proxy error page, or an empty body.
  }
  return new ApiError(res.status, problem)
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, anonymous = false, signal } = opts

  const send = async (token?: string): Promise<Response> => {
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (token) headers.Authorization = `Bearer ${token}`

    return fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      // Never follow the image redirect here; those go through expo-image.
      redirect: 'follow',
    })
  }

  let token: string | undefined
  if (!anonymous) {
    // Coalesce null to undefined: a restored session has a refresh token but no
    // access token until the first refresh, and `null` would set a literal
    // "Bearer null" header.
    token = (await getSession())?.accessToken ?? undefined
  }

  let res: Response
  try {
    res = await send(token)
  } catch (cause) {
    throw ApiError.network(cause)
  }

  // One retry after a refresh. Only one: a second 401 means the fresh token is
  // also rejected, which is a real auth failure rather than an expiry.
  if (res.status === 401 && !anonymous) {
    const refreshed = await refreshSession()
    if (refreshed) {
      try {
        res = await send(refreshed.accessToken)
      } catch (cause) {
        throw ApiError.network(cause)
      }
    }
  }

  if (!res.ok) throw await parseProblem(res)

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** Requests that must not carry a token: sign-in and refresh. */
export const anonRequest = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, { method: 'POST', body, anonymous: true })

/**
 * A GET that must not carry a token — the public invite preview. It backs the join
 * landing, which a not-yet-signed-in user reaches by following a shared link, so it
 * must not trigger the 401-refresh path a normal GET would.
 */
export const anonGet = <T>(path: string): Promise<T> =>
  request<T>(path, { method: 'GET', anonymous: true })
