/**
 * Semantic colours the prototype hardcodes inside component bodies rather than
 * putting in the palette (the closing-window banner, the upload-error card, the
 * danger chip, danger settings rows).
 *
 * They are tokens here so no component invents a colour.
 *
 * Keyed by light/dark MODE rather than by palette. The prototype's values are all
 * near-white tints designed only against light palettes — `#FFEEE2` behind text
 * on the `ink` palette is unreadable. Two sets selected by `palette.isDark` gives
 * correct results for all 11 without 11 hand-tuned variants; the dark set mirrors
 * the light set's intent at inverted lightness in the same hue family.
 */

export interface SemanticColors {
  /** Background of a `danger`-toned Chip. */
  chipDangerBg: string
  /** The "album locks in 36 hours" countdown banner. */
  closingBannerBg: string
  closingBannerInk: string
  closingBannerLine: string
  /** The "upload paused — connection lost" card. */
  errorCardBg: string
  errorCardLine: string
  /** Icon well behind destructive settings rows (delete face data, delete account). */
  dangerRowBg: string
}

const LIGHT: SemanticColors = {
  chipDangerBg: '#FFE4E1',
  closingBannerBg: '#FFEEE2',
  closingBannerInk: '#733200',
  closingBannerLine: '#ECC5A7',
  errorCardBg: '#FFEDEB',
  errorCardLine: '#F3BFBA',
  dangerRowBg: '#FFE9E6',
}

const DARK: SemanticColors = {
  chipDangerBg: '#47211E',
  closingBannerBg: '#3B220D',
  closingBannerInk: '#FDCDA0',
  closingBannerLine: '#5F4025',
  errorCardBg: '#3E1E1C',
  errorCardLine: '#683834',
  dangerRowBg: '#442321',
}

export const semanticColors = (isDark: boolean): SemanticColors => (isDark ? DARK : LIGHT)

/**
 * Colours used over photographs, where the underlying pixels are unknown and no
 * palette token can be relied on for contrast. Fixed black/white alphas, exactly
 * as the prototype does.
 */
export const overlay = {
  /** Glass control backgrounds in the photo viewer. */
  controlBg: 'rgba(0,0,0,0.45)',
  controlBgStrong: 'rgba(0,0,0,0.55)',
  /** The `glass` Chip tone. */
  chipBg: 'rgba(0,0,0,0.55)',
  /** Metadata pills over media. */
  metaBg: 'rgba(0,0,0,0.40)',
  /** Scrim behind the face-tag spotlight cutout. */
  spotlight: 'rgba(0,0,0,0.45)',
  /** Foreground on any of the above. */
  ink: '#FFFFFF',
  inkSoft: 'rgba(255,255,255,0.85)',
  inkMuted: 'rgba(255,255,255,0.60)',
  /** Border for a face marker on someone who is NOT the viewer. */
  faceMarkerLine: 'rgba(255,255,255,0.85)',
  /** Hairline inside a photo tile, so a pale photo still reads as a tile. */
  tileInset: 'rgba(0,0,0,0.10)',
} as const

/**
 * The full-screen photo viewer is always dark regardless of palette — the design
 * principle is "photos lead, chrome fades away", so the viewer does not adopt a
 * light palette's background.
 */
export const viewer = {
  bg: '#0E0C09',
  ink: '#FFFFFF',
} as const

/** The toast is palette-independent, matching the prototype. */
export const toast = {
  bg: 'rgba(20,18,15,0.92)',
  ink: '#F4EEE3',
} as const
