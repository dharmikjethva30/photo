/**
 * Spacing.
 *
 * The prototype has no formal scale — it uses a de-facto 2/4/6/8/10/12/14/16/18/
 * 20/22/24/28/32 ramp. Rather than inventing a stricter 4-point scale and
 * shifting every layout, this encodes the ramp as-is so ports are faithful, plus
 * named layout constants for the values that are structural rather than
 * decorative.
 */
export const space = {
  xxs: 2,
  xs: 4,
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  '2xl': 14,
  '3xl': 16,
  '4xl': 18,
  '5xl': 20,
  '6xl': 22,
  '7xl': 24,
  '8xl': 28,
  '9xl': 32,
} as const

/**
 * Structural spacing. These are load-bearing: changing one changes whether a
 * screen's content is reachable, not just how it looks.
 */
export const screenSpace = {
  /** Standard horizontal screen padding. */
  gutter: 24,
  /** Horizontal padding for scrolling lists and photo grids. */
  gutterList: 16,
  /** Sign-in, which sits wider than everything else. */
  gutterWide: 28,
  /** Gap between photos in a grid. Deliberately tight — photos lead. */
  gridGap: 4,
  /** Footer CTA bar: 12 top, gutter sides, 28 bottom (clears the home indicator). */
  footerPaddingTop: 12,
  footerPaddingBottom: 28,
} as const
