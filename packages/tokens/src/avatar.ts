/**
 * Avatar and occasion colours.
 *
 * The prototype colours avatars with `oklch(0.82 0.08 <hue>)`, where each of its
 * seven demo people has a hardcoded hue. Real users have arbitrary ids, so that
 * would require evaluating `oklch()` at runtime — which React Native cannot do.
 *
 * Instead: a fixed ramp of 12 evenly-spaced hues, precomputed to hex, selected by
 * hashing the user id. Deterministic (the same person is always the same colour,
 * on every device and platform), no runtime colour maths, and the set of colours
 * that can ever appear is reviewable.
 *
 * 12 buckets keeps a 30-member album visually varied while staying far enough
 * apart that no two are confusable. Values from `scripts/convert-oklch.ts`.
 */

export interface AvatarColor {
  /** Circle fill. */
  bg: string
  /** Initials on that fill. Contrast-checked at authoring time. */
  fg: string
  /** Face-marker border / presence dot for this person. */
  marker: string
}

export const avatarRamp: readonly AvatarColor[] = [
  { bg: '#F0AFC2', fg: '#52102C', marker: '#ED9CB5' }, // hue 0
  { bg: '#F4B1A6', fg: '#55120B', marker: '#F19F91' }, // hue 30
  { bg: '#EBB890', fg: '#472400', marker: '#E7A875' }, // hue 60
  { bg: '#D8C288', fg: '#3A2C00', marker: '#D0B56A' }, // hue 90
  { bg: '#BDCC92', fg: '#293300', marker: '#AFC177' }, // hue 120
  { bg: '#9FD3A9', fg: '#003915', marker: '#88CA95' }, // hue 150
  { bg: '#88D6C6', fg: '#00362F', marker: '#66CCBA' }, // hue 180
  { bg: '#84D3E1', fg: '#00353C', marker: '#5FC9DB' }, // hue 210
  { bg: '#94CCF3', fg: '#00314C', marker: '#79C0F1' }, // hue 240
  { bg: '#B0C2F9', fg: '#1B275F', marker: '#9EB5F8' }, // hue 270
  { bg: '#CCB9F1', fg: '#361E57', marker: '#C1A9EE' }, // hue 300
  { bg: '#E2B2DD', fg: '#481645', marker: '#DCA0D6' }, // hue 330
] as const

/**
 * FNV-1a. Chosen because it is short, dependency-free, and — the property that
 * matters — must produce identical output in TypeScript on iOS, Android and web,
 * so a person's colour never differs between a viewer's device and the uploader's.
 * Not security-relevant.
 */
const hash = (s: string): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** Stable avatar colour for a user id. */
export const avatarColor = (userId: string): AvatarColor => {
  const entry = avatarRamp[hash(userId) % avatarRamp.length]
  // Non-null is safe: modulo of a non-empty readonly array is always in range.
  // biome-ignore lint/style/noNonNullAssertion: modulo bound guarantees presence
  return entry!
}

/** Initials for an avatar, from a display name. */
export const initials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase()
}

/**
 * Occasion template accents, used as the decorative blob on the create-album
 * cards. A fixed set of six, so these are static rather than hashed.
 */
export const occasionColor = {
  trip: '#65C6E4',
  wedding: '#E39ECC',
  dinner: '#ECA57D',
  birthday: '#B6ADF3',
  family: '#C6B96B',
  other: '#5DCBD1',
} as const

export type OccasionKey = keyof typeof occasionColor
