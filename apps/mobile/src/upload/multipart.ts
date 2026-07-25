/**
 * Resumable multipart upload, client side.
 *
 * The point is not speed, it is survivability. A 60-second 4K clip is 200-400 MB, and
 * on a phone network a single stream of that WILL be interrupted. With 8 MiB parts an
 * interruption costs one part instead of the file — which is the difference between
 * "retry" and "give up" for a user on hotel wifi.
 *
 * The protocol is docs/adr/0003. Three things about it shape this file:
 *
 *  1. Every part URL is signed WITH that part's SHA-256, because S3 requires an
 *     x-amz-checksum-sha256 header on every UploadPart and SigV4 refuses to accept an
 *     x-amz-* header it did not sign. So we hash a part before we can even ask for its
 *     URL, and we must send back exactly the header the server signed.
 *  2. What still needs uploading is decided by the SERVER, from S3's own ListParts. We
 *     never track it locally — a process killed mid-part cannot know whether that part
 *     landed, and guessing either re-uploads everything or leaves a gap that assembles
 *     into a corrupt file.
 *  3. Completion needs no part list and no ETags. That is what makes resume across an
 *     app kill cheap: all we have to remember is the mediaId.
 */
import * as Crypto from 'expo-crypto'
import type { File } from 'expo-file-system'
import { request } from '../api/client'
import type { PresignedPart, ResumeState } from '../api/types'
import { base64FromBytes, partsToUpload } from './parts'

/**
 * How many parts are uploaded at once.
 *
 * Three, not more. Parts go straight to S3 over the same radio, so extra concurrency
 * mostly adds contention and memory (each in-flight part is held in JS memory); three
 * is enough to keep the pipe full while one part is stalling.
 */
const CONCURRENCY = 3

/**
 * How many part URLs are requested per round trip. Must not exceed the server's
 * PartBatchSize (20), which it enforces.
 *
 * Larger batches mean fewer round trips but URLs that sit unused for longer, and a
 * presign only lives an hour. Ten parts is 80 MiB of upload per batch — comfortably
 * inside the TTL even on a slow connection.
 */
const URL_BATCH = 10

/** Per-part retries before the whole upload is considered failed. */
const MAX_PART_ATTEMPTS = 4

export interface MultipartPlan {
  mediaId: string
  partSize: number
  partCount: number
}

export interface MultipartOptions {
  /** Called with 0..1 as parts complete. */
  onProgress?: (fraction: number) => void
  /** Aborts between parts. An in-flight part is allowed to finish. */
  shouldCancel?: () => boolean
}

export class UploadCancelled extends Error {
  constructor() {
    super('Upload cancelled.')
    this.name = 'UploadCancelled'
  }
}

/**
 * Upload a file in parts, skipping anything S3 already has.
 *
 * Safe to call again after a crash, a network drop, or an app kill: it asks the server
 * what is missing first, so a second call finishes the job rather than restarting it.
 */
export async function uploadInParts(
  file: File,
  plan: MultipartPlan,
  opts: MultipartOptions = {},
): Promise<void> {
  // Ask the server — not our own bookkeeping — what is left. On a fresh upload this
  // returns every part; on a resumed one, only the gaps.
  const state = await request<ResumeState>(`/v1/uploads/${plan.mediaId}`)

  if (state.state !== 'pending') {
    // Already completed by an earlier attempt whose response we lost.
    opts.onProgress?.(1)
    return
  }

  let remaining = partsToUpload(state)

  const total = plan.partCount
  let done = total - remaining.length
  const report = () => opts.onProgress?.(total > 0 ? done / total : 0)
  report()

  while (remaining.length > 0) {
    if (opts.shouldCancel?.()) throw new UploadCancelled()

    const batch = remaining.slice(0, URL_BATCH)
    remaining = remaining.slice(batch.length)

    // Hash first, because the server cannot sign a URL without the checksum.
    //
    // The bytes are read and then DISCARDED, keeping only the hash: holding ten 8 MiB
    // buffers to save a re-read would cost 80 MiB of JS heap on a phone. Re-reading
    // from local storage when the part's turn comes is far cheaper than that.
    const toSign = []
    for (const partNumber of batch) {
      toSign.push({ partNumber, sha256: await hashPart(file, plan, partNumber) })
    }

    const signed = await requestPartURLs(plan.mediaId, toSign)

    await pool(signed, CONCURRENCY, async part => {
      if (opts.shouldCancel?.()) throw new UploadCancelled()
      await putPart(file, plan, part)
      done++
      report()
    })
  }
}

/**
 * Read one part and return its base64 SHA-256.
 *
 * A fresh handle per call rather than one shared handle, because `offset` lives on the
 * handle and concurrent readers sharing one would read each other's ranges.
 */
async function hashPart(file: File, plan: MultipartPlan, partNumber: number): Promise<string> {
  const bytes = readPart(file, plan, partNumber)
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes)
  return base64FromBytes(new Uint8Array(digest))
}

// The ArrayBuffer type argument is not decoration: Crypto.digest takes a BufferSource,
// which excludes a view over a SharedArrayBuffer, and a plain `Uint8Array` widens to
// `Uint8Array<ArrayBufferLike>` and stops assigning.
function readPart(file: File, plan: MultipartPlan, partNumber: number): Uint8Array<ArrayBuffer> {
  const handle = file.open()
  try {
    handle.offset = (partNumber - 1) * plan.partSize
    // readBytes clamps to what is actually there, so the final short part is correct
    // without special-casing it.
    return handle.readBytes(plan.partSize)
  } finally {
    // Not optional: leaked file descriptors accumulate across a 50-part upload and the
    // failure mode is an opaque "too many open files" much later.
    handle.close()
  }
}

async function requestPartURLs(
  mediaId: string,
  parts: { partNumber: number; sha256: string }[],
): Promise<PresignedPart[]> {
  const res = await request<{ parts: PresignedPart[] }>(`/v1/uploads/${mediaId}/parts`, {
    method: 'POST',
    body: { parts },
  })
  return res.parts
}

/**
 * PUT one part, retrying on transient failure.
 *
 * A 403 is treated as expiry rather than a permission problem, and recovered by
 * re-signing. It is the expected failure for a slow upload: presigned URLs live an hour
 * and a 400 MB file on bad wifi can outlast that, which surfaces as a 403 on part 37
 * and reads exactly like a bug in our code.
 */
async function putPart(file: File, plan: MultipartPlan, part: PresignedPart): Promise<void> {
  let current = part

  for (let attempt = 1; attempt <= MAX_PART_ATTEMPTS; attempt++) {
    const bytes = readPart(file, plan, current.partNumber)

    let status: number
    let detail = ''
    try {
      const res = await fetch(current.url, {
        method: 'PUT',
        // EXACTLY the checksum the URL was signed for. Omitting it is not a skipped
        // optional check, it is a signature mismatch.
        headers: { 'x-amz-checksum-sha256': current.sha256 },
        body: bytes as unknown as BodyInit,
      })
      status = res.status
      if (status !== 200) detail = await res.text().catch(() => '')
    } catch (err) {
      // A dropped connection. Retryable, and the common case on a phone.
      status = 0
      detail = err instanceof Error ? err.message : String(err)
    }

    if (status === 200) return

    const isLast = attempt === MAX_PART_ATTEMPTS
    if (status === 403) {
      // Re-sign and retry immediately: the bytes are fine, only the signature aged out.
      const [fresh] = await requestPartURLs(plan.mediaId, [
        { partNumber: current.partNumber, sha256: current.sha256 },
      ])
      if (fresh && !isLast) {
        current = fresh
        continue
      }
    }

    // 400 means S3 rejected the bytes against the signed checksum. Retrying identical
    // bytes cannot help, so fail fast with something diagnosable.
    if (status === 400) {
      throw new Error(`Part ${current.partNumber} was rejected as corrupt. ${trim(detail)}`)
    }

    if (isLast) {
      throw new Error(
        `Part ${current.partNumber} failed after ${MAX_PART_ATTEMPTS} attempts` +
          `${status ? ` (HTTP ${status})` : ''}. ${trim(detail)}`,
      )
    }

    // Exponential backoff. Retrying a congested or rate-limited connection immediately
    // is how a flaky upload becomes a failed one.
    await delay(500 * 2 ** (attempt - 1))
  }
}

/**
 * Run `work` over `items` with at most `limit` in flight.
 *
 * Hand-rolled rather than pulled in: the whole point is bounded concurrency over an
 * array, and the failure semantics matter — the first rejection propagates and no new
 * work starts, so a dead network stops the upload instead of burning through 50 parts.
 */
async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  const queue = [...items]
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (;;) {
      const next = queue.shift()
      if (next === undefined) return
      await work(next)
    }
  })
  await Promise.all(runners)
}

function delay(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

function trim(s: string) {
  return s.length > 200 ? `${s.slice(0, 200)}…` : s
}
