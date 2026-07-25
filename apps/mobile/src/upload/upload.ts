/**
 * The upload flow: declare → PUT to S3 → complete.
 *
 * Bytes never pass through our API (docs/adr/0003). This module is the client half
 * of that protocol.
 *
 * Uses expo-file-system's CURRENT API (`File` + `UploadTask`), not the legacy
 * `FileSystem.uploadAsync`. The new one reports real `bytesSent / totalBytes`, which
 * is what lets the UI show genuine progress rather than an animated guess.
 */
import { File, UploadTask } from 'expo-file-system'
import { request } from '../api/client'
import type { DeclareUploadResult } from '../api/types'
import { uploadInParts } from './multipart'

export interface PickedAsset {
  /** A local file:// URI for the ORIGINAL bytes. */
  uri: string
  fileName?: string | null
  mimeType?: string | null
  width?: number
  height?: number
  /** Milliseconds since epoch, from the asset's own metadata where available. */
  creationTime?: number | null
  /** A stable local identifier, used as the idempotency key. */
  assetId?: string | null
}

/**
 * Upload one asset.
 *
 * Returns the media id in every non-throwing case, including when the server reports
 * the upload was already complete — a retry must be a success, not an error.
 */
export async function uploadAsset(
  albumID: string,
  asset: PickedAsset,
  onBytes?: (fraction: number) => void,
  shouldCancel?: () => boolean,
): Promise<{ mediaId: string }> {
  const file = new File(asset.uri)
  if (!file.exists) throw new Error('That photo is no longer available on this device.')

  const byteSize = file.size ?? 0
  if (byteSize <= 0) throw new Error('That photo appears to be empty.')

  const contentType = normaliseMime(asset.mimeType, asset.fileName)

  // The idempotency key. Prefer the OS asset id so re-picking the same photo after a
  // failed attempt resumes rather than duplicating; fall back to filename plus size,
  // which is stable enough for a retry within one session.
  const clientMediaId = asset.assetId ?? `${asset.fileName ?? 'photo'}-${byteSize}`

  const declared = await request<DeclareUploadResult>(`/v1/albums/${albumID}/uploads`, {
    method: 'POST',
    body: {
      clientMediaId,
      contentType,
      byteSize,
      originalFilename: asset.fileName ?? undefined,
      width: asset.width,
      height: asset.height,
      captureTime: asset.creationTime ? new Date(asset.creationTime).toISOString() : undefined,
      // The device's CURRENT UTC offset — not necessarily the offset at capture time,
      // but far better than assuming UTC for a feed ordered by capture time across
      // members in different timezones.
      timezoneOffsetMin: -new Date().getTimezoneOffset(),
    },
  })

  // Already uploaded and verified. The server deliberately withholds a fresh
  // presigned URL here so verified bytes cannot be replaced.
  if (declared.alreadyUploaded) {
    return { mediaId: declared.mediaId }
  }

  if (declared.mode === 'multipart') {
    if (!declared.partSize || !declared.partCount) {
      throw new Error('The server described a multipart upload without a part plan.')
    }
    await uploadInParts(
      file,
      {
        mediaId: declared.mediaId,
        partSize: declared.partSize,
        partCount: declared.partCount,
      },
      { onProgress: onBytes, shouldCancel },
    )
  } else if (declared.upload) {
    // PUT straight to S3 with EXACTLY the headers that were signed. Adding or omitting
    // one changes the canonical request and S3 answers 403 SignatureDoesNotMatch.
    const task = new UploadTask(file, declared.upload.url, {
      httpMethod: 'PUT',
      headers: declared.upload.headers,
      onProgress: p => {
        if (p.totalBytes > 0) onBytes?.(p.bytesSent / p.totalBytes)
      },
    })

    const res = await task.uploadAsync()
    if (res.status !== 200) {
      throw new Error(`Storage rejected the upload (${res.status}).`)
    }
  } else {
    throw new Error('The server returned no way to upload this file.')
  }

  // No body, for either mode. The server reads the mode from the upload session and
  // gets the multipart part list from S3 itself, so this call needs nothing but the id
  // — which is what lets an upload be finished by a process that has forgotten
  // everything else. It HEADs the object and checks size and checksum against what was
  // declared; that check is the trust boundary.
  await request(`/v1/uploads/${declared.mediaId}/complete`, { method: 'POST', body: {} })

  return { mediaId: declared.mediaId }
}

// The old uploadBatch lived here — a sequential in-modal loop. It is gone: batches now
// go through the persistent queue (src/upload/queue.ts) drained by UploadQueueProvider,
// so an upload survives leaving the screen and an app kill. uploadAsset above is the
// single per-file primitive both the queue processor and any future caller share.

/**
 * Resolve a content type.
 *
 * The picker's mimeType is sometimes absent or generic, and the server enforces an
 * allowlist, so inferring from the extension beats sending something it will reject.
 * HEIC matters most: it is the iPhone default.
 */
function normaliseMime(
  mime: string | null | undefined,
  fileName: string | null | undefined,
): string {
  if (mime && mime !== 'application/octet-stream') return mime.toLowerCase()

  const ext = (fileName ?? '').toLowerCase().split('.').pop() ?? ''
  switch (ext) {
    case 'heic':
      return 'image/heic'
    case 'heif':
      return 'image/heif'
    case 'png':
      return 'image/png'
    case 'mov':
      return 'video/quicktime'
    case 'mp4':
      return 'video/mp4'
    default:
      return 'image/jpeg'
  }
}
