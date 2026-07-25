/**
 * The 11 photu palettes.
 *
 * COLOUR ONLY. Type and radii are global — see `fonts.ts`, `textStyles.ts` and
 * `radii.ts`. That is a deliberate design property (the prototype's `SHARED`
 * block): palettes can be swapped without any screen reflowing.
 *
 * Every value here is hex or rgba. There is NO `oklch()`, `lab()`, `lch()` or
 * `color-mix()` anywhere in this package — React Native cannot parse them. The
 * prototype's oklch values were converted once, offline, with culori's
 * `clampChroma` + `formatHex` (see `scripts/convert-oklch.ts` for provenance and
 * `palettes.test.ts` for the regression guard). Six values required gamut
 * clamping, which is why naive per-channel clipping was not used.
 *
 * SHIPPING PALETTE: `quiet`. See docs/design-system.md.
 */

export type PaletteKey =
  | 'keepsake'
  | 'bone'
  | 'linen'
  | 'porcelain'
  | 'quiet'
  | 'slate'
  | 'mist'
  | 'sage'
  | 'ash'
  | 'ink'
  | 'walnut'

export interface PaletteColors {
  /** Screen background. */
  bg: string
  /** Raised surfaces: cards, fields, list groups. */
  surface: string
  /** Recessed/secondary fills: secondary buttons, inset rows. */
  surfaceAlt: string
  /** Primary text, and the fill of primary buttons and the active tab pill. */
  ink: string
  /** Secondary text. */
  inkSoft: string
  /** Tertiary text, metadata, mono labels. */
  inkMuted: string
  /** Hairline dividers. */
  line: string
  /** Emphasised borders: outline buttons, dashed placeholders. */
  lineStrong: string
  /**
   * The single accent. NOTE: in `ash` and `porcelain` this EQUALS `ink`.
   * Never write a component that assumes accent contrasts with ink.
   */
  accent: string
  /** Foreground for text/icons on an `accent` fill. */
  accentInk: string
  /**
   * Tinted accent background. In the warm palettes this is a real colour; in the
   * dark and monochrome ones it is a low-alpha ink overlay. Anything placing text
   * on it must use a paired foreground token, not assume `ink` reads.
   */
  accentSoft: string
  danger: string
  success: string
}

export interface Palette extends PaletteColors {
  key: PaletteKey
  /** Human label for the dev palette picker. */
  name: string
  /** One-line design intent, shown under the label in the picker. */
  hint: string
  /**
   * Precomputed rather than derived at runtime. The prototype parses `bg` and
   * compares luma < 130 on every call, and duplicates that function inside
   * `TabBar`. Computed once here with the same formula; only `ink` and `walnut`
   * are dark. Drives blur tint, status-bar style, and glass fallbacks.
   */
  isDark: boolean
}

export const PALETTES: Record<PaletteKey, Palette> = {
  keepsake: {
    key: 'keepsake',
    name: 'Keepsake',
    hint: 'Warm cream paper, terracotta accent. The original.',
    isDark: false,
    bg: '#F4EEE3',
    surface: '#FBF7EE',
    surfaceAlt: '#EDE5D5',
    ink: '#1B1814',
    inkSoft: '#5A5249',
    inkMuted: '#8E867A',
    line: 'rgba(27,24,20,0.10)',
    lineStrong: 'rgba(27,24,20,0.18)',
    accent: '#C7692C',
    accentInk: '#FFFFFF',
    accentSoft: '#F9DFCB',
    danger: '#C53637',
    success: '#49814C',
  },

  bone: {
    key: 'bone',
    name: 'Bone',
    hint: 'Bone-white paper. Honey accent. Like an old sketchbook.',
    isDark: false,
    bg: '#EFEAE0',
    surface: '#F7F3EA',
    surfaceAlt: '#E0DAD0',
    ink: '#181613',
    inkSoft: '#4A4540',
    inkMuted: '#8E887F',
    line: 'rgba(24,22,19,0.10)',
    lineStrong: 'rgba(24,22,19,0.18)',
    accent: '#9D712D',
    accentInk: '#F7F3EA',
    accentSoft: '#F4E6D2',
    danger: '#A83634',
    success: '#3B723E',
  },

  linen: {
    key: 'linen',
    name: 'Linen',
    hint: 'Pale natural fibre. Old-rose accent. Soft, not sweet.',
    isDark: false,
    bg: '#F1ECE5',
    surface: '#FAF6EE',
    surfaceAlt: '#E2DCD2',
    ink: '#1A1714',
    inkSoft: '#4F4944',
    inkMuted: '#8C857C',
    line: 'rgba(26,23,20,0.09)',
    lineStrong: 'rgba(26,23,20,0.16)',
    accent: '#9B5E62',
    accentInk: '#FAF6EE',
    accentSoft: '#F8E2E2',
    danger: '#A83634',
    success: '#3B723E',
  },

  porcelain: {
    key: 'porcelain',
    name: 'Porcelain',
    hint: 'Nearly-white. True black. The accent is the photograph.',
    isDark: false,
    bg: '#F5F4F0',
    surface: '#FFFFFF',
    surfaceAlt: '#EAE9E4',
    ink: '#0C0C0C',
    inkSoft: '#3A3A38',
    inkMuted: '#878680',
    line: 'rgba(12,12,12,0.07)',
    lineStrong: 'rgba(12,12,12,0.16)',
    // accent === ink by design. See the PaletteColors.accent note.
    accent: '#0C0C0C',
    accentInk: '#FFFFFF',
    accentSoft: 'rgba(12,12,12,0.05)',
    danger: '#A83634',
    success: '#376139',
  },

  quiet: {
    key: 'quiet',
    name: 'Quiet',
    hint: 'Cool white paper, ink black, deep cobalt accent.',
    isDark: false,
    bg: '#F7F6F3',
    surface: '#FFFFFF',
    surfaceAlt: '#EFEDE8',
    ink: '#15171A',
    inkSoft: '#454A52',
    inkMuted: '#8A8F97',
    line: 'rgba(21,23,26,0.08)',
    lineStrong: 'rgba(21,23,26,0.16)',
    accent: '#296898',
    accentInk: '#FFFFFF',
    accentSoft: '#DBEEFE',
    danger: '#BD413F',
    success: '#49814C',
  },

  slate: {
    key: 'slate',
    name: 'Slate',
    hint: 'Cool grey paper, charcoal, deep teal. Calm and editorial.',
    isDark: false,
    bg: '#EEEEEC',
    surface: '#F6F6F4',
    surfaceAlt: '#DEDDD9',
    ink: '#15191B',
    inkSoft: '#3F4448',
    inkMuted: '#888B8E',
    line: 'rgba(21,25,27,0.08)',
    lineStrong: 'rgba(21,25,27,0.16)',
    accent: '#006266',
    accentInk: '#F6F6F4',
    accentSoft: '#D6EDEE',
    danger: '#A83634',
    success: '#117555',
  },

  mist: {
    key: 'mist',
    name: 'Mist',
    hint: 'Bluish white. Washed periwinkle accent. Like a foggy morning.',
    isDark: false,
    bg: '#EEF0F2',
    surface: '#F8FAFB',
    surfaceAlt: '#DEE1E5',
    ink: '#161A20',
    inkSoft: '#42474F',
    inkMuted: '#878D96',
    line: 'rgba(22,26,32,0.07)',
    lineStrong: 'rgba(22,26,32,0.15)',
    accent: '#486491',
    accentInk: '#F8FAFB',
    accentSoft: '#DEE9F9',
    danger: '#A83634',
    success: '#117555',
  },

  sage: {
    key: 'sage',
    name: 'Sage',
    hint: 'Pale green-tinted paper. Deep moss accent. A garden, not a brand.',
    isDark: false,
    bg: '#EDEEE6',
    surface: '#F5F6EE',
    surfaceAlt: '#DEE0D4',
    ink: '#161814',
    inkSoft: '#42473F',
    inkMuted: '#888C82',
    line: 'rgba(22,24,20,0.09)',
    lineStrong: 'rgba(22,24,20,0.16)',
    accent: '#376139',
    accentInk: '#F5F6EE',
    accentSoft: '#DCEEDC',
    danger: '#A83634',
    // Intentionally identical to `accent` in the source design.
    success: '#376139',
  },

  ash: {
    key: 'ash',
    name: 'Ash',
    hint: 'Monochrome grey. True black accent. Pure restraint.',
    isDark: false,
    bg: '#ECECEA',
    surface: '#F4F4F2',
    surfaceAlt: '#DCDCDA',
    ink: '#0E0E0E',
    inkSoft: '#3A3A3A',
    inkMuted: '#888888',
    line: 'rgba(14,14,14,0.08)',
    lineStrong: 'rgba(14,14,14,0.18)',
    // accent === ink by design. See the PaletteColors.accent note.
    accent: '#0E0E0E',
    accentInk: '#F4F4F2',
    accentSoft: 'rgba(14,14,14,0.06)',
    danger: '#972527',
    success: '#405E40',
  },

  ink: {
    key: 'ink',
    name: 'Ink',
    hint: 'Quiet dark mode. Soft amber accent. Photos hold the light.',
    isDark: true,
    bg: '#16161A',
    surface: '#1E1E22',
    surfaceAlt: '#2A2A2F',
    ink: '#EEEAE0',
    inkSoft: '#B5B0A6',
    inkMuted: '#7A7670',
    line: 'rgba(238,234,224,0.07)',
    lineStrong: 'rgba(238,234,224,0.14)',
    accent: '#DDAE6C',
    accentInk: '#16161A',
    accentSoft: 'rgba(238,234,224,0.06)',
    danger: '#E85854',
    success: '#6CB26F',
  },

  walnut: {
    key: 'walnut',
    name: 'Walnut',
    hint: 'Wood-panelled study. Deep warm brown, parchment text.',
    isDark: true,
    bg: '#1A140E',
    surface: '#241C14',
    surfaceAlt: '#322619',
    ink: '#F2E7D5',
    inkSoft: '#BDAE94',
    inkMuted: '#7E715E',
    line: 'rgba(242,231,213,0.07)',
    lineStrong: 'rgba(242,231,213,0.14)',
    accent: '#D39562',
    accentInk: '#1A140E',
    accentSoft: 'rgba(242,231,213,0.06)',
    danger: '#E85854',
    success: '#5DA260',
  },
}

/** Display order for the dev palette picker. */
export const PALETTE_ORDER: readonly PaletteKey[] = [
  'keepsake',
  'bone',
  'linen',
  'porcelain',
  'quiet',
  'slate',
  'mist',
  'sage',
  'ash',
  'ink',
  'walnut',
] as const

/**
 * The palette the product ships. Also the fallback — the prototype defaulted to
 * `quiet` but fell back to `keepsake`, an inconsistency we resolve here.
 */
export const DEFAULT_PALETTE: PaletteKey = 'quiet'

export const getPalette = (key: string | undefined): Palette =>
  PALETTES[key as PaletteKey] ?? PALETTES[DEFAULT_PALETTE]
