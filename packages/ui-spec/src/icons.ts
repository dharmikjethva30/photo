/**
 * The complete icon set — 37 names, ported verbatim from the prototype's
 * `Icon` component.
 *
 * A closed union rather than `string`, so a typo is a compile error. The
 * prototype returns `null` for an unknown name, which means a mistyped icon
 * silently renders nothing.
 *
 * All are 24×24, `fill: none`, round caps and joins, default stroke 1.6.
 * Three are filled rather than stroked (see `FILLED_ICONS`).
 */
export const ICON_NAMES = [
  // actions
  'plus',
  'check',
  'x',
  'upload',
  'download',
  'share',
  'link',
  // media playback
  'play',
  'pause',
  // navigation
  'chevron-right',
  'chevron-left',
  'chevron-down',
  'arrow-right',
  'arrow-up',
  'home',
  'menu',
  'more',
  // media
  'camera',
  'image',
  'images',
  'qr',
  // privacy
  'lock',
  'eye',
  'eye-off',
  'face',
  // people
  'user',
  'users',
  // system
  'bell',
  'settings',
  'clock',
  'pin',
  'sliders',
  'heart',
  'sparkle',
  // auth providers
  'apple',
  'google',
  'phone',
] as const

export type IconName = (typeof ICON_NAMES)[number]

/**
 * Icons drawn with `fill` instead of `stroke`. A stroke width has no effect on
 * these, and applying one produces a visibly heavier glyph.
 */
export const FILLED_ICONS: readonly IconName[] = ['play', 'apple', 'google'] as const

/** Default stroke width, and the two the tab bar uses for active/inactive. */
export const ICON_STROKE = {
  default: 1.6,
  active: 2.2,
  inactive: 1.8,
} as const
