/**
 * Wire types for the photu API.
 *
 * Hand-written, mirroring the Go handlers in `services/api/internal/httpapi`.
 *
 * DEVIATION from docs/adr/0001, recorded honestly: the plan was to generate these
 * from `packages/api-contract/openapi.yaml` so drift is impossible. That spec does
 * not exist yet, so for now these are maintained by hand and the risk is real —
 * rename a JSON field in Go and nothing here complains until runtime. Generating
 * them is the next contract-level task.
 */

export interface Session {
  accessToken: string
  expiresAt: string
  refreshToken: string
  user: { id: string; displayName: string }
  isNewUser: boolean
}

export interface Me {
  id: string
  displayName: string
  email?: string
  /** Server-authoritative. The client must never decide this. */
  freeAlbumsUsed: number
  freeAlbumsTotal: number
}

export type AlbumState = 'active' | 'locked' | 'archived'
export type AlbumTemplate = 'trip' | 'wedding' | 'dinner' | 'birthday' | 'family' | 'other'
export type PrivacyMode = 'open' | 'face' | 'private'

export interface Album {
  id: string
  title: string
  template: AlbumTemplate
  state: AlbumState
  privacyMode: PrivacyMode
  ownerUserId: string
  windowEndsAt: string
  mediaCount: number
  memberCount: number
  coverMediaId: string | null
  createdAt: string
}

export interface AlbumMember {
  userId: string
  displayName: string
  role: 'owner' | 'member'
}

export interface FeedItem {
  id: string
  kind: 'photo' | 'video'
  captureTime: string
  width: number | null
  height: number | null
  durationMs: number | null
  uploaderId: string
  uploaderName: string
  /** Drives the face marker on a grid tile. */
  viewerAppears: boolean
  /**
   * STABLE urls that 302 to a short-lived presigned one. Cache by these, never by
   * the redirect target — a presigned URL's query string rotates on every request.
   */
  thumbUrl: string
  previewUrl: string
}

export interface FeedPage {
  items: FeedItem[]
  nextCursor?: string
}

export interface DeclareUploadResult {
  mediaId: string
  mode?: 'single' | 'multipart'
  upload?: {
    url: string
    headers: Record<string, string>
    expiresAt: string
  }
  alreadyUploaded?: boolean
}

/**
 * RFC 9457 problem details. `type` is a STABLE slug the UI switches on — it is part
 * of the API contract, so the server treats renaming one as breaking.
 */
export interface ProblemDetails {
  type: string
  title: string
  status: number
  detail?: string
  errors?: Record<string, string>
}

/** The error-type slugs the UI actually branches on. */
export const ERROR_TYPES = {
  unauthorized: 'unauthorized',
  freeAlbumsUsed: 'free_albums_exhausted',
  albumLocked: 'album_locked',
  windowClosed: 'upload_window_closed',
  validation: 'validation_failed',
  notFound: 'not_found',
} as const
