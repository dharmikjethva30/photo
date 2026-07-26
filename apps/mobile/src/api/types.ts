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
  /**
   * Uploads that are not yet viewable. POST /complete returns while an item is
   * still `uploaded`; the media worker generates renditions moments later. While
   * this is non-zero the client polls, otherwise a freshly uploaded photo looks
   * lost until the user pulls to refresh.
   */
  processingCount?: number
}

export interface AlbumMember {
  userId: string
  displayName: string
  role: 'owner' | 'member'
}

/** An invite as the owner sees it, from POST/GET /v1/albums/{id}/invites. */
export interface Invite {
  id: string
  code: string
  /** The shareable link, WebBaseURL/a/<code> — what goes in a message or a QR. */
  url: string
  channel: 'link' | 'qr' | 'contact' | 'share_sheet' | 'sms'
  useCount: number
  maxUses?: number
  expiresAt?: string
  createdAt: string
}

/**
 * The PUBLIC invite preview, from GET /v1/invites/{code} (unauthenticated). Just
 * enough for the join landing; never members or media.
 */
export interface InvitePreview {
  code: string
  albumId: string
  albumTitle: string
  privacyMode: PrivacyMode
  albumState: AlbumState
  coverMediaId?: string
  valid: boolean
  /** Present only when invalid: 'revoked' | 'expired' | 'full'. */
  invalidReason?: string
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

// --- faces & subject controls (M4-M5) --------------------------------------

/** GET /v1/me/face-consent. Drives the biometric consent gate. */
export interface FaceConsent {
  currentVersion: string
  granted: boolean
  grantedVersion?: string
  grantedAt?: string
  /** True until the user has agreed to the CURRENT copy version. */
  needsConsent: boolean
}

/** A reference selfie, from GET/POST /v1/me/face-references. */
export interface FaceReference {
  id: string
  createdAt: string
  /** The embedding exists — the face worker has processed it. */
  processed: boolean
}

/** POST /v1/me/face-references — the presigned single-PUT plan for a selfie. */
export interface DeclareReferenceResult {
  referenceId: string
  upload: {
    url: string
    headers: Record<string, string>
    expiresAt: string
  }
}

/** One pending auto-suggestion, from GET /v1/albums/{id}/my-suggested-tags. */
export interface SuggestedTag {
  tagId: string
  mediaId: string
  /** Stable thumb URL (302s to a presigned one), same as the feed. */
  thumbUrl: string
  /** Normalised [0,1] face box, for highlighting which face is meant. */
  bbox: { x: number; y: number; w: number; h: number }
  similarity?: number
}

export type GrantScope = 'single_media' | 'all_media_of_grantor'

/** A grant the caller has issued, from GET /v1/albums/{id}/grants. */
export interface Grant {
  grantId: string
  scope: GrantScope
  granteeUserId: string
  mediaId?: string
  createdAt: string
}

export interface DeclareUploadResult {
  mediaId: string
  mode?: 'single' | 'multipart'
  /** Present only when mode is 'single'. */
  upload?: {
    url: string
    headers: Record<string, string>
    expiresAt: string
  }
  /**
   * Present only when mode is 'multipart'. Deliberately WITHOUT part URLs: signing a
   * part requires that part's sha256, and at declare time the client has not read a
   * byte. It posts checksums to /uploads/{id}/parts to get URLs. See docs/adr/0003.
   */
  uploadId?: string
  partSize?: number
  partCount?: number
  alreadyUploaded?: boolean
}

/** One signed part URL, from POST /v1/uploads/{id}/parts. */
export interface PresignedPart {
  partNumber: number
  url: string
  /**
   * The checksum this URL was signed for. It MUST be sent as x-amz-checksum-sha256;
   * the URL is unusable without it, because the value is inside the signature.
   */
  sha256: string
  expiresAt: string
}

/**
 * From GET /v1/uploads/{id}. Server-computed from S3's own ListParts, which is why it
 * can be trusted after an app kill when local bookkeeping cannot.
 */
export interface ResumeState {
  mediaId: string
  state: 'pending' | 'uploaded' | 'ready' | 'failed'
  mode: 'single' | 'multipart'
  partSize?: number
  partCount?: number
  completed: { partNumber: number; etag: string; sha256?: string }[]
  missing: number[]
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
