/**
 * ONE-TIME conversion script. Not part of the build.
 *
 * React Native cannot parse `oklch()`. The design prototype uses it for ~40
 * values. Rather than adding a colour-conversion dependency to every consumer
 * forever, we convert once, eyeball the output, and commit hex into
 * `src/palettes.ts` and `src/semantic.ts`.
 *
 * `clampChroma` is the important part: several of these values sit at or outside
 * the sRGB gamut boundary (the keepsake terracotta and the ink amber especially),
 * where a naive `formatHex` clips each channel independently and visibly shifts
 * the hue. `clampChroma` reduces chroma while holding lightness and hue, which
 * is what a designer would do by hand.
 *
 * Retained rather than deleted so the provenance of every hex value in this
 * package is reproducible, and so adding a 12th palette does not require
 * rediscovering this. Run with:  pnpm --filter @photu/tokens convert-oklch
 */
import { clampChroma, formatHex, oklch, parse } from 'culori'

/** Parse to Oklch, throwing rather than returning undefined. */
const toOklch = (css: string) => {
  const parsed = parse(css)
  if (!parsed) throw new Error(`unparseable colour: ${css}`)
  const o = oklch(parsed)
  if (!o) throw new Error(`not convertible to oklch: ${css}`)
  return o
}

/** Clamp into sRGB gamut, preserving lightness and hue. */
const toClamped = (css: string) => {
  const clamped = clampChroma(toOklch(css), 'oklch')
  if (!clamped) throw new Error(`could not clamp: ${css}`)
  return clamped
}

const toHex = (css: string): string => {
  const hex = formatHex(toClamped(css))
  if (!hex) throw new Error(`could not format: ${css}`)
  return hex.toUpperCase()
}

/** Fixed values lifted verbatim from the prototype. */
const PALETTE_VALUES: Record<string, Record<string, string>> = {
  keepsake: {
    accent: 'oklch(0.62 0.14 50)',
    accentSoft: 'oklch(0.92 0.04 60)',
    danger: 'oklch(0.55 0.18 25)',
    success: 'oklch(0.55 0.10 145)',
  },
  quiet: {
    accent: 'oklch(0.50 0.10 245)',
    accentSoft: 'oklch(0.94 0.03 245)',
    danger: 'oklch(0.55 0.16 25)',
    success: 'oklch(0.55 0.10 145)',
  },
  bone: {
    accent: 'oklch(0.58 0.10 75)',
    accentSoft: 'oklch(0.93 0.03 75)',
    danger: 'oklch(0.50 0.15 25)',
    success: 'oklch(0.50 0.10 145)',
  },
  linen: {
    accent: 'oklch(0.55 0.08 15)',
    accentSoft: 'oklch(0.93 0.025 15)',
    danger: 'oklch(0.50 0.15 25)',
    success: 'oklch(0.50 0.10 145)',
  },
  slate: {
    accent: 'oklch(0.45 0.08 200)',
    accentSoft: 'oklch(0.93 0.025 200)',
    danger: 'oklch(0.50 0.15 25)',
    success: 'oklch(0.50 0.10 165)',
  },
  mist: {
    accent: 'oklch(0.50 0.08 260)',
    accentSoft: 'oklch(0.93 0.025 260)',
    danger: 'oklch(0.50 0.15 25)',
    success: 'oklch(0.50 0.10 165)',
  },
  sage: {
    accent: 'oklch(0.45 0.08 145)',
    accentSoft: 'oklch(0.93 0.03 145)',
    danger: 'oklch(0.50 0.15 25)',
    success: 'oklch(0.45 0.08 145)',
  },
  ash: {
    danger: 'oklch(0.45 0.15 25)',
    success: 'oklch(0.45 0.06 145)',
  },
  ink: {
    accent: 'oklch(0.78 0.10 75)',
    danger: 'oklch(0.65 0.18 25)',
    success: 'oklch(0.70 0.12 145)',
  },
  walnut: {
    accent: 'oklch(0.72 0.10 60)',
    danger: 'oklch(0.65 0.18 25)',
    success: 'oklch(0.65 0.12 145)',
  },
  porcelain: {
    danger: 'oklch(0.50 0.15 25)',
    success: 'oklch(0.45 0.08 145)',
  },
}

/**
 * Semantic one-offs the prototype hardcodes inside components rather than in the
 * palette. They become real tokens so a component never invents a colour.
 *
 * The prototype's values are all near-white tints — they were only ever designed
 * against the light palettes, and dropping `#FFEEE2` behind text on the `ink`
 * palette would be unreadable. Rather than 11 hand-tuned sets, these are keyed by
 * light/dark *mode*: two sets, selected by the palette's `isDark`. The dark
 * variants mirror the light ones' intent (a low-chroma tint of the same hue
 * family) at inverted lightness.
 */
const SEMANTIC_LIGHT: Record<string, string> = {
  chipDangerBg: 'oklch(0.94 0.04 25)',
  closingBannerBg: 'oklch(0.96 0.04 60)',
  closingBannerInk: 'oklch(0.40 0.13 50)',
  closingBannerLine: 'oklch(0.85 0.06 60)',
  errorCardBg: 'oklch(0.96 0.03 25)',
  errorCardLine: 'oklch(0.85 0.06 25)',
  dangerRowBg: 'oklch(0.95 0.03 25)',
}

const SEMANTIC_DARK: Record<string, string> = {
  chipDangerBg: 'oklch(0.30 0.06 25)',
  closingBannerBg: 'oklch(0.28 0.05 60)',
  closingBannerInk: 'oklch(0.88 0.08 65)',
  closingBannerLine: 'oklch(0.40 0.06 60)',
  errorCardBg: 'oklch(0.28 0.05 25)',
  errorCardLine: 'oklch(0.40 0.07 25)',
  dangerRowBg: 'oklch(0.30 0.05 25)',
}

/**
 * Avatar colours are hue-parameterised in the prototype (`personColor(id)` maps a
 * fixed demo person to a fixed hue). Real users have arbitrary ids, so a runtime
 * `oklch()` would be needed — which RN cannot do.
 *
 * Instead: precompute a fixed ramp of evenly spaced hues and select a bucket by
 * hashing the user id. Deterministic, no runtime colour maths, and we control
 * exactly which colours can appear. 12 buckets is enough to make a 30-member
 * album read as varied without any two adjacent hues being confusable.
 */
const AVATAR_RAMP_SIZE = 12
const avatarRamp = Array.from({ length: AVATAR_RAMP_SIZE }, (_, i) => {
  const hue = Math.round((360 / AVATAR_RAMP_SIZE) * i)
  return {
    hue,
    bg: toHex(`oklch(0.82 0.08 ${hue})`),
    fg: toHex(`oklch(0.30 0.10 ${hue})`),
    // The prototype also uses oklch(0.78 0.10 hue) for face markers / dots.
    marker: toHex(`oklch(0.78 0.10 ${hue})`),
  }
})

/** Occasion templates are a fixed set of six, with hues from the prototype. */
const OCCASION_HUES: Record<string, number> = {
  trip: 220,
  wedding: 340,
  dinner: 50,
  birthday: 290,
  family: 100,
  other: 200,
}

console.log('// --- palettes -------------------------------------------------')
for (const [name, tokens] of Object.entries(PALETTE_VALUES)) {
  const converted = Object.entries(tokens)
    .map(([k, v]) => `${k}: '${toHex(v)}'`)
    .join(', ')
  console.log(`${name}: { ${converted} },`)
}

console.log('\n// --- semantic (light mode) ------------------------------------')
for (const [k, v] of Object.entries(SEMANTIC_LIGHT)) {
  console.log(`${k}: '${toHex(v)}',`)
}

console.log('\n// --- semantic (dark mode) ------------------------------------')
for (const [k, v] of Object.entries(SEMANTIC_DARK)) {
  console.log(`${k}: '${toHex(v)}',`)
}

console.log('\n// --- avatar ramp ----------------------------------------------')
for (const e of avatarRamp) {
  console.log(`{ bg: '${e.bg}', fg: '${e.fg}', marker: '${e.marker}' }, // hue ${e.hue}`)
}

console.log('\n// --- occasion -------------------------------------------------')
for (const [k, hue] of Object.entries(OCCASION_HUES)) {
  console.log(`${k}: '${toHex(`oklch(0.78 0.10 ${hue})`)}', // hue ${hue}`)
}

// Report anything that needed gamut clamping, since that is where a value may
// deviate visibly from the designer's intent and deserves a human look.
console.log('\n// --- gamut check ----------------------------------------------')
const all = [
  ...Object.values(PALETTE_VALUES).flatMap(t => Object.values(t)),
  ...Object.values(SEMANTIC_LIGHT),
  ...Object.values(SEMANTIC_DARK),
]
for (const css of all) {
  const p = toOklch(css)
  const clamped = toClamped(css)
  const dc = (p.c ?? 0) - (clamped.c ?? 0)
  if (dc > 0.0005) {
    console.log(`// CLAMPED ${css} -> ${toHex(css)} (chroma reduced by ${dc.toFixed(4)})`)
  }
}
