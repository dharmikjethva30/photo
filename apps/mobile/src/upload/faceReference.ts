/**
 * Enrol a reference selfie: declare → PUT to the facedata bucket → complete.
 *
 * The same three-call protocol as a photo upload (docs/adr/0003) — bytes go straight
 * to S3, never through our API — but against /v1/me/face-references, which presigns
 * into the isolated facedata bucket (its own KMS key, its own erasure path). Single
 * PUT only: a selfie is a few MB, never multipart.
 */
import { File, UploadTask } from 'expo-file-system'
import { request } from '../api/client'
import type { DeclareReferenceResult, FaceReference } from '../api/types'

export async function enrollFaceReference(asset: {
  uri: string
  mimeType?: string | null
  fileName?: string | null
}): Promise<FaceReference> {
  const file = new File(asset.uri)
  if (!file.exists) throw new Error('That photo is no longer available on this device.')
  const byteSize = file.size ?? 0
  if (byteSize <= 0) throw new Error('That photo appears to be empty.')

  const contentType = normaliseMime(asset.mimeType, asset.fileName)

  const declared = await request<DeclareReferenceResult>('/v1/me/face-references', {
    method: 'POST',
    body: { contentType, byteSize },
  })

  // PUT with EXACTLY the signed headers — SigV4 fails on any that are added or dropped.
  const task = new UploadTask(file, declared.upload.url, {
    httpMethod: 'PUT',
    headers: declared.upload.headers,
  })
  const res = await task.uploadAsync()
  if (res.status !== 200) {
    throw new Error(`Storage rejected the selfie (${res.status}).`)
  }

  // Complete verifies the bytes with HeadObject, then records the reference. The
  // worker embeds it moments later (processed flips true then).
  return request<FaceReference>(`/v1/me/face-references/${declared.referenceId}/complete`, {
    method: 'POST',
    body: { contentType },
  })
}

/** A selfie is always a still image; keep the allowlist tight. */
function normaliseMime(mime?: string | null, fileName?: string | null): string {
  if (mime?.startsWith('image/')) return mime
  const ext = fileName?.split('.').pop()?.toLowerCase()
  if (ext === 'png') return 'image/png'
  if (ext === 'heic') return 'image/heic'
  if (ext === 'heif') return 'image/heif'
  return 'image/jpeg'
}
