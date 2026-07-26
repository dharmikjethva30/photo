/**
 * Server-side calls to the photu API.
 *
 * These run on the Next server (in a Server Component or route handler), never in the
 * browser, so they use an INTERNAL base URL that can reach the API directly —
 * `localhost:8080` in dev, a private service address in prod. The browser never talks
 * to the API from these pages; the landing is server-rendered and static-feeling.
 */

const API_BASE = process.env.API_INTERNAL_URL ?? 'http://localhost:8080'

/** The public invite preview shape, mirroring the Go handler's previewView. */
export interface InvitePreview {
  code: string
  albumId: string
  albumTitle: string
  privacyMode: 'open' | 'face' | 'private'
  albumState: 'active' | 'locked' | 'archived'
  coverMediaId?: string
  valid: boolean
  invalidReason?: 'revoked' | 'expired' | 'full'
}

/**
 * Fetch an invite preview. Returns null for a code the API does not recognise (404),
 * so the caller can render a clean "invalid link" page rather than a 500.
 *
 * `no-store`: an invite's validity (revoked, spent) changes under us, and a landing
 * page that caches "valid" after the owner revoked it would be actively misleading.
 */
export async function getInvitePreview(code: string): Promise<InvitePreview | null> {
  try {
    const res = await fetch(`${API_BASE}/v1/invites/${encodeURIComponent(code)}`, {
      cache: 'no-store',
    })
    if (res.status === 404) return null
    if (!res.ok) return null
    return (await res.json()) as InvitePreview
  } catch {
    // The API is unreachable. Treat as "cannot resolve" rather than crashing the page.
    return null
  }
}
