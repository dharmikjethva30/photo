/**
 * The 37-icon set, transcribed verbatim from the prototype's `Icon` component
 * (docs/prototype/primitives.jsx). Every `d` is byte-identical to the source and
 * must stay that way — these are hand-tuned glyphs, so redrawing or
 * "simplifying" a path silently changes the design.
 *
 * Most icons are stroked and inherit `stroke`/`strokeWidth` from the root `Svg`.
 * Three (`play`, `apple`, `google` — `FILLED_ICONS` in @photu/ui-spec) are solid
 * shapes: they take `fill` and explicitly opt out of the stroke, which would
 * otherwise fatten the glyph by half a stroke width all round.
 *
 * The prototype falls through to `default: return null`, so a typo renders
 * nothing. There is no such fallback here: `IconName` is a closed union, so an
 * unknown name fails to compile instead.
 */

import { ICON_STROKE, type IconName, type IconProps } from '@photu/ui-spec'
import type { ReactElement } from 'react'
import Svg, { Circle, Path, Rect } from 'react-native-svg'

type FilledIconName = 'play' | 'apple' | 'google'

/** Only these need the colour at render time; the rest inherit it from `Svg`. */
const FILLED_PATHS = {
  play: 'M7 5l12 7-12 7V5z',
  apple:
    'M12.5 6.5c.5-1 1.5-2 2.5-2.5-.2 1.2-.8 2-1.5 2.5-.5.4-1.2.5-1 0zM18 16.5c-.5 1.2-.8 1.7-1.5 2.5-1 1-1.7 1-2.5 1s-1-.5-2-.5-1.5.5-2.5.5-1.5 0-2.5-1c-2-2-3-5-3-7 0-3 2-4.5 4-4.5 1 0 2 .5 2.5.5s1.5-.7 3-.7c1 0 2.5.5 3.5 1.7-3 1.5-2.5 5.5.5 6.5z',
  google:
    'M21.5 12.2c0-.6 0-1.2-.2-1.7H12v3.4h5.4c-.2 1.2-.9 2.3-2 3v2.4h3.2c1.9-1.7 2.9-4.3 2.9-7.1zM12 22c2.7 0 5-1 6.6-2.6l-3.2-2.4c-.9.6-2 1-3.4 1-2.6 0-4.8-1.7-5.6-4.1H3.1v2.5C4.7 19.6 8.1 22 12 22zM6.4 13.9c-.2-.6-.3-1.3-.3-1.9s.1-1.3.3-1.9V7.6H3.1A10 10 0 002 12c0 1.6.4 3.1 1.1 4.4l3.3-2.5zM12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8C17 3.1 14.7 2 12 2 8.1 2 4.7 4.4 3.1 7.6l3.3 2.5C7.2 7.7 9.4 6 12 6z',
} satisfies Record<FilledIconName, string>

/**
 * `satisfies Record<Exclude<...>>` is load-bearing: adding a name to
 * `ICON_NAMES` without drawing it here is a compile error.
 */
const STROKED_ICONS = {
  // actions
  plus: <Path d="M12 5v14M5 12h14" />,
  check: <Path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <Path d="M6 6l12 12M18 6L6 18" />,
  upload: (
    <>
      <Path d="M12 16V4M6 10l6-6 6 6" />
      <Path d="M4 18v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
    </>
  ),
  download: (
    <>
      <Path d="M12 4v12M6 10l6 6 6-6" />
      <Path d="M4 20h16" />
    </>
  ),
  share: (
    <>
      <Path d="M12 4v12M7 8l5-5 5 5" />
      <Path d="M5 14v5a2 2 0 002 2h10a2 2 0 002-2v-5" />
    </>
  ),
  link: (
    <>
      <Path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1" />
      <Path d="M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1" />
    </>
  ),
  // media playback
  pause: <Path d="M8 5v14M16 5v14" />,
  // navigation
  'chevron-right': <Path d="M9 6l6 6-6 6" />,
  'chevron-left': <Path d="M15 6l-6 6 6 6" />,
  'chevron-down': <Path d="M6 9l6 6 6-6" />,
  'arrow-right': <Path d="M5 12h14M13 6l6 6-6 6" />,
  'arrow-up': <Path d="M12 19V5M6 11l6-6 6 6" />,
  home: <Path d="M3 11l9-7 9 7v9a2 2 0 01-2 2h-4v-7h-6v7H5a2 2 0 01-2-2z" />,
  menu: <Path d="M4 6h16M4 12h16M4 18h16" />,
  more: (
    <>
      <Circle cx="6" cy="12" r="1.5" />
      <Circle cx="12" cy="12" r="1.5" />
      <Circle cx="18" cy="12" r="1.5" />
    </>
  ),
  // media
  camera: (
    <>
      <Rect x="3" y="6" width="18" height="14" rx="3" />
      <Circle cx="12" cy="13" r="4" />
      <Path d="M9 6l1.5-2h3L15 6" />
    </>
  ),
  image: (
    <>
      <Rect x="3" y="3" width="18" height="18" rx="3" />
      <Circle cx="9" cy="9" r="2" />
      <Path d="M21 16l-5-5-9 9" />
    </>
  ),
  images: (
    <>
      <Rect x="6" y="6" width="15" height="15" rx="3" />
      <Path d="M3 16V5a2 2 0 012-2h11" />
    </>
  ),
  qr: (
    <>
      <Rect x="3" y="3" width="7" height="7" rx="1" />
      <Rect x="14" y="3" width="7" height="7" rx="1" />
      <Rect x="3" y="14" width="7" height="7" rx="1" />
      <Path d="M14 14h2v2M14 18v3M18 14h3M21 18v3M16 21h-2" />
    </>
  ),
  // privacy
  lock: (
    <>
      <Rect x="4" y="11" width="16" height="10" rx="2" />
      <Path d="M8 11V8a4 4 0 018 0v3" />
    </>
  ),
  eye: (
    <>
      <Path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <Circle cx="12" cy="12" r="3" />
    </>
  ),
  'eye-off': (
    <>
      <Path d="M3 3l18 18" />
      <Path d="M10.6 10.6A2 2 0 0014 13.4M9.5 5.2A11 11 0 0112 5c6 0 10 7 10 7a18 18 0 01-3.8 4.6M6.7 6.7A18 18 0 002 12s4 7 10 7a11 11 0 005.3-1.3" />
    </>
  ),
  face: (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Circle cx="9" cy="10" r="0.5" />
      <Circle cx="15" cy="10" r="0.5" />
      <Path d="M9 15c1 1 2 1.5 3 1.5s2-.5 3-1.5" />
    </>
  ),
  // people
  user: (
    <>
      <Circle cx="12" cy="8" r="4" />
      <Path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
    </>
  ),
  users: (
    <>
      <Circle cx="9" cy="9" r="3.5" />
      <Path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6" />
      <Circle cx="17" cy="7" r="2.5" />
      <Path d="M16 13c3 0 6 2 6 5" />
    </>
  ),
  // system
  bell: (
    <>
      <Path d="M6 17V11a6 6 0 1112 0v6l1.5 2h-15L6 17z" />
      <Path d="M10 21a2 2 0 004 0" />
    </>
  ),
  settings: (
    <>
      <Circle cx="12" cy="12" r="3" />
      <Path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1A1.7 1.7 0 004.6 9a1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </>
  ),
  clock: (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M12 7v5l3 2" />
    </>
  ),
  pin: (
    <>
      <Path d="M12 22s7-7 7-12a7 7 0 10-14 0c0 5 7 12 7 12z" />
      <Circle cx="12" cy="10" r="2.5" />
    </>
  ),
  sliders: (
    <>
      <Path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h14M18 18h2" />
      <Circle cx="16" cy="6" r="2" />
      <Circle cx="10" cy="12" r="2" />
      <Circle cx="16" cy="18" r="2" />
    </>
  ),
  heart: (
    <Path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.7 1-1a5.5 5.5 0 000-7.7z" />
  ),
  sparkle: (
    <>
      <Path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
      <Path d="M19 17l.7 1.8L21.5 19l-1.8.7L19 22l-.7-2.3L16.5 19l1.8-.7z" />
    </>
  ),
  phone: (
    <Path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3 19.5 19.5 0 01-6-6 19.8 19.8 0 01-3-8.6A2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8 9.8a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.5c.9.3 1.8.5 2.7.7a2 2 0 011.7 2.1z" />
  ),
} satisfies Record<Exclude<IconName, FilledIconName>, ReactElement>

const isFilled = (name: IconName): name is FilledIconName => name in FILLED_PATHS

/**
 * `color` has no default on purpose. The prototype relies on `currentColor`,
 * which React Native has no equivalent for — there is no inherited text colour
 * to resolve against, and a hard-coded fallback would render invisible ink on
 * dark surfaces. Callers pass the token they mean; an omitted `color` leaves
 * `stroke` unset, which is loud enough to catch in review.
 */
export function Icon({ name, size = 20, color, strokeWidth = ICON_STROKE.default }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {isFilled(name) ? (
        // `play` is the one exception: the prototype fills it but does NOT set
        // stroke="none", so it inherits the root stroke and its round line-join
        // rounds the triangle's three points. That reads as deliberate alongside
        // the rest of the set, and the prototype is the visual reference, so the
        // stroke is kept. `apple` and `google` opt out explicitly, as they do
        // there — a stroke on those dense multi-subpath glyphs fattens them into
        // mush.
        <Path d={FILLED_PATHS[name]} fill={color} stroke={name === 'play' ? color : 'none'} />
      ) : (
        STROKED_ICONS[name]
      )}
    </Svg>
  )
}
