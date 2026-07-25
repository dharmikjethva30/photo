/**
 * Structural layout constants.
 *
 * These are dimensions that components must agree on. Getting one wrong does not
 * merely look off — it makes content unreachable.
 */

/**
 * The floating tab island.
 *
 * It is `position: absolute` and therefore reserves NO layout space. Every
 * scrollable screen that renders it must add `TAB_BAR_TOTAL_HEIGHT` to its
 * `contentContainerStyle.paddingBottom`, or the last row of the list sits
 * permanently under the island. This is the single most commonly forgotten
 * detail in the port, which is why the value is exported rather than inlined.
 */
export const tabBar = {
  /** Height of the island itself (item height 40 + 6 padding top and bottom). */
  height: 52,
  /**
   * Distance from the bottom of the safe area. The prototype's flat `18` was
   * measured inside a fake device frame; on hardware with a home indicator the
   * island collides with it, so consumers use
   * `insets.bottom > 0 ? insets.bottom + GAP_WITH_INSET : GAP_NO_INSET`.
   */
  gapNoInset: 18,
  gapWithInset: 6,
  /** Horizontal inset of the island from the screen edges. */
  sideInset: 16,
  itemHeight: 40,
  padding: 6,
} as const

/**
 * Total vertical space a scroll view must reserve to clear the tab island.
 * Consumers add the safe-area bottom inset on top of this.
 */
export const TAB_BAR_TOTAL_HEIGHT = tabBar.height + tabBar.gapNoInset

/**
 * The prototype uses a flat `paddingBottom: 100` on scroll regions to clear both
 * the island and the FAB. Kept as a named constant.
 */
export const SCROLL_BOTTOM_PADDING = 100

export const fab = {
  height: 52,
  /** Sits above the tab island. */
  bottom: 96,
  right: 20,
  /** Larger variant used for "Add photos" on the album feed. */
  heightLarge: 56,
} as const

export const controls = {
  /** IconButton — circular header controls. */
  iconButton: 38,
  /** Glass controls in the photo viewer. */
  glassButton: 40,
  /** The viewer's bottom toolbar buttons (Save / Share / Hide me / Allowlist). */
  viewerAction: 56,
  /** Toggle track. */
  toggleWidth: 44,
  toggleHeight: 26,
  toggleKnob: 22,
  /** Notification badge on an IconButton. */
  badge: 14,
} as const

/** Button geometry. Radius is always height / 2 — fully pill. */
export const buttonSizes = {
  sm: { height: 32, paddingHorizontal: 12 },
  md: { height: 44, paddingHorizontal: 18 },
  lg: { height: 52, paddingHorizontal: 22 },
} as const

export type ButtonSize = keyof typeof buttonSizes

export const avatarSizes = {
  xs: 18,
  sm: 22,
  md: 28,
  lg: 32,
  xl: 36,
  '2xl': 56,
} as const

/** Backdrop blur intensities. Applied via `useGlass()` in @photu/ui-native. */
export const blur = {
  /** The tab island. */
  island: 28,
  /** Photo-overlay controls. */
  control: 12,
  /** The viewer's bottom bar. */
  viewerBar: 16,
  /** Toast. */
  toast: 10,
  /** Metadata pills over media. */
  pill: 8,
  /** Web sticky header. */
  webHeader: 30,
} as const

/**
 * Opaque fallbacks for when blur is disabled — Android's blur needs
 * `experimentalBlurMethod="dimezisBlurView"` and costs measurable frames on
 * scrolling surfaces, so `useGlass()` can degrade to these.
 */
export const glassFallback = {
  light: 'rgba(255,255,255,0.92)',
  dark: 'rgba(28,28,30,0.92)',
} as const

/** Blurred island material when blur IS available. */
export const glassMaterial = {
  light: 'rgba(255,255,255,0.72)',
  dark: 'rgba(28,28,30,0.72)',
} as const

/** Photo grid columns per context. */
export const grid = {
  /** Album feed. */
  feed: 3,
  /** Upload batch thumbnails. */
  uploadBatch: 4,
  /** Web gallery at desktop width. */
  webGallery: 4,
} as const
