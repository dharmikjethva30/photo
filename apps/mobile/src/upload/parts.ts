/**
 * Pure helpers for the multipart uploader.
 *
 * Deliberately free of expo-file-system / expo-crypto imports so this module loads —
 * and is unit-testable — under plain Node. The native I/O lives in multipart.ts; the
 * decisions live here.
 */
import type { ResumeState } from '../api/types'

/**
 * Which parts still need uploading, ascending.
 *
 * The server's `missing` is authoritative in every case: all parts for a fresh upload,
 * the gaps for a partial one, and an EMPTY list when every part has landed but
 * /complete has not run. That last case is the whole point of resume — a client killed
 * right after its final part — and returning [] here is what stops it re-sending the
 * entire file. (An earlier version fell back to "all parts" on an empty list and did
 * exactly that.)
 */
export function partsToUpload(state: ResumeState): number[] {
  return [...state.missing].sort((a, b) => a - b)
}

/**
 * Base64-encode bytes.
 *
 * Written out rather than using `Buffer`, which does not exist in React Native, or
 * `btoa`, which takes a string and mangles bytes above 0x7F when fed through
 * String.fromCharCode on some engines. A 32-byte digest is not worth a dependency.
 *
 * Correctness here is load-bearing: the output becomes x-amz-checksum-sha256, and a
 * wrong encoding fails every multipart part at S3 with an opaque signature error.
 */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function base64FromBytes(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] as number
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]

    out += B64[b0 >> 2]
    out += B64[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)]
    out += b1 === undefined ? '=' : B64[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)]
    out += b2 === undefined ? '=' : B64[b2 & 0x3f]
  }
  return out
}
