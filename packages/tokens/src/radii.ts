/**
 * Corner radii — GLOBAL, not per-palette.
 *
 * `palettes.jsx` loads after `theme.jsx` and overrides it, and its `SHARED` block
 * sets these for every palette. The `18 / 10 / 24` values visible in `theme.jsx`'s
 * `keepsake` are dead code. See docs/design-system.md correction #2.
 */
export const radii = {
  /** Photo tiles, small inset fills. */
  sm: 8,
  /** The default: cards, fields, list groups, album covers. */
  md: 14,
  /** Dropzones, the locked-album hero, the face-tag photo pane. */
  lg: 20,
  /** Bottom sheets — top corners only. */
  sheet: 28,
  /** Chips, the tab island, avatars, and all buttons (radius = height / 2). */
  pill: 999,
} as const

/**
 * Radii the prototype uses literally for specific components, kept named so a
 * component never invents one.
 */
export const componentRadii = {
  /** Photo tiles inside a grid, upload batch thumbnails. */
  gridTile: 6,
  /** The contact-sheet feed variant — deliberately almost square. */
  contactFrame: 2,
  /** Face marker boxes and photo badges. */
  marker: 4,
  /** Progress bar, sheet drag handle. */
  bar: 2,
  /** Upload cards, big monogram tiles, the Android extended FAB. */
  card: 16,
  /** Notification cards on the lock-screen mock. */
  notification: 20,
} as const
