import { ERROR_TYPES, type ProblemDetails } from './types'

/**
 * One error type for every API failure, so screens branch on a stable slug rather
 * than on an HTTP status or a message string.
 */
export class ApiError extends Error {
  readonly status: number
  readonly problem?: ProblemDetails

  constructor(status: number, problem?: ProblemDetails) {
    super(problem?.detail ?? problem?.title ?? `Request failed (${status})`)
    this.name = 'ApiError'
    this.status = status
    this.problem = problem
  }

  /** A transport failure — no HTTP response at all. Status 0 distinguishes it. */
  static network(cause: unknown): ApiError {
    const err = new ApiError(0, {
      type: 'network_error',
      title: 'Network error',
      status: 0,
      detail: "We couldn't reach photu. Check your connection and try again.",
    })
    err.cause = cause
    return err
  }

  get type(): string {
    return this.problem?.type ?? 'unknown'
  }

  get isNetwork(): boolean {
    return this.status === 0
  }

  get isUnauthorized(): boolean {
    return this.status === 401
  }

  /** The 4th-album paywall. */
  get isOutOfFreeAlbums(): boolean {
    return this.type === ERROR_TYPES.freeAlbumsUsed
  }

  get isAlbumClosed(): boolean {
    return this.type === ERROR_TYPES.albumLocked || this.type === ERROR_TYPES.windowClosed
  }

  /** Per-field validation messages, for form display. */
  get fieldErrors(): Record<string, string> {
    return this.problem?.errors ?? {}
  }
}
