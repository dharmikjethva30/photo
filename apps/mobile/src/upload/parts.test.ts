import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { ResumeState } from '../api/types'
import { base64FromBytes, partsToUpload } from './parts'

const resume = (missing: number[]): ResumeState => ({
  mediaId: 'm',
  state: 'pending',
  mode: 'multipart',
  partCount: 3,
  completed: [],
  missing,
})

describe('partsToUpload', () => {
  it('returns every part for a fresh upload', () => {
    expect(partsToUpload(resume([1, 2, 3]))).toEqual([1, 2, 3])
  })

  it('returns only the gaps for a partially-uploaded file', () => {
    expect(partsToUpload(resume([2]))).toEqual([2])
  })

  it('sorts, so a batch is always contiguous from the front', () => {
    expect(partsToUpload(resume([3, 1, 2]))).toEqual([1, 2, 3])
  })

  it('returns NOTHING when all parts have landed but complete has not run', () => {
    // The regression guard. This is the app-killed-after-the-last-part case; an empty
    // list means "just complete", and anything else re-uploads a file that is fully
    // there — which is precisely the cost resume exists to avoid.
    expect(partsToUpload(resume([]))).toEqual([])
  })
})

describe('base64FromBytes', () => {
  // Correctness is load-bearing: this becomes x-amz-checksum-sha256, and a wrong
  // encoding fails every part at S3. Checked against Node's own base64, which is the
  // same standard alphabet and padding S3 expects.
  it('matches Node for byte values that exercise the high bit and padding', () => {
    const cases: Uint8Array[] = [
      new Uint8Array([]),
      new Uint8Array([0]),
      new Uint8Array([0, 0]),
      new Uint8Array([0, 0, 0]),
      new Uint8Array([255, 254, 253]),
      new Uint8Array([0xff]), // 1 byte -> two pad chars
      new Uint8Array([0xff, 0xff]), // 2 bytes -> one pad char
      new Uint8Array([0x66, 0x6f, 0x6f, 0x62, 0x61]), // "fooba"
    ]
    for (const bytes of cases) {
      expect(base64FromBytes(bytes)).toBe(Buffer.from(bytes).toString('base64'))
    }
  })

  it('matches Node for a real SHA-256 digest', () => {
    const digest = createHash('sha256').update('an 8 MiB part, in spirit').digest()
    expect(base64FromBytes(new Uint8Array(digest))).toBe(digest.toString('base64'))
  })

  it('matches Node across randomised inputs', () => {
    // Vary by index rather than Math.random (banned in this repo's scripts, and flaky
    // in a test) — a fixed sweep of lengths and a deterministic fill.
    for (let len = 0; len < 40; len++) {
      const bytes = new Uint8Array(len)
      for (let i = 0; i < len; i++) bytes[i] = (i * 37 + len * 101) & 0xff
      expect(base64FromBytes(bytes)).toBe(Buffer.from(bytes).toString('base64'))
    }
  })
})
