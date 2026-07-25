/**
 * Shadows.
 *
 * The prototype writes CSS `box-shadow` strings inline at ~16 call sites. React
 * Native cannot parse those and needs discrete props, and multi-layer shadows are
 * not expressible on Android at all (a single `elevation` value is all it has).
 *
 * So each level is defined ONCE as structured data, and each platform reads the
 * field it can use:
 *   - iOS  → shadowColor / shadowOffset / shadowOpacity / shadowRadius
 *   - Android → elevation (approximated; multi-layer shadows collapse to one)
 *   - web  → the `css` string
 *
 * The consuming theme layer in `@photu/ui-native` converts these to style props;
 * this package stays platform-free (docs/adr/0002).
 */

export interface Elevation {
  /** iOS / RN */
  shadowColor: string
  shadowOffset: { width: number; height: number }
  shadowOpacity: number
  shadowRadius: number
  /** Android — approximates the whole stack with one value. */
  elevation: number
  /** Web box-shadow, including any second layer Android cannot render. */
  css: string
}

export const elevation = {
  /** FAB, raised accent buttons. */
  raised: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 24,
    elevation: 8,
    css: '0 8px 24px rgba(0,0,0,0.14), 0 2px 6px rgba(0,0,0,0.08)',
  },

  /**
   * The floating tab island. Heavier than `raised` because it sits over content
   * and needs to read as detached.
   */
  island: {
    shadowColor: '#141210',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    elevation: 12,
    css: '0 1px 0 rgba(255,255,255,0.65) inset, 0 12px 28px rgba(20,18,14,0.18), 0 2px 8px rgba(20,18,14,0.10)',
  },

  /** Dark-palette variant of the island — the inset highlight and opacity differ. */
  islandDark: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.45,
    shadowRadius: 28,
    elevation: 12,
    css: '0 1px 0 rgba(255,255,255,0.08) inset, 0 12px 28px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.30)',
  },

  /** Bottom sheets — shadow points UPWARD (negative offset). */
  sheet: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.06,
    shadowRadius: 30,
    elevation: 16,
    css: '0 -10px 30px rgba(0,0,0,0.06)',
  },

  /** The hide-me sheet, which sits over the dark viewer and needs more contrast. */
  sheetOverPhoto: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.3,
    shadowRadius: 40,
    elevation: 24,
    css: '0 -10px 40px rgba(0,0,0,0.3)',
  },

  /** Toast. */
  toast: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 30,
    elevation: 12,
    css: '0 10px 30px rgba(0,0,0,0.3)',
  },

  /** Album covers, upload thumbnails, the face-reference circle. */
  media: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 6,
    css: '0 8px 24px rgba(0,0,0,0.18)',
  },

  /** The locked-album keepsake hero — the heaviest in the system. */
  keepsake: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.18,
    shadowRadius: 50,
    elevation: 20,
    css: '0 20px 50px rgba(0,0,0,0.18)',
  },
} as const satisfies Record<string, Elevation>

export type ElevationName = keyof typeof elevation
