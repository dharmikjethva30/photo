/**
 * @photu/ui-spec — prop contracts for the primitives implemented on BOTH React
 * Native and the web.
 *
 * Types only, no runtime, no platform imports. `@photu/ui-native` and
 * `@photu/ui-web` each implement these, so adding a prop on one side is a compile
 * error on the other (docs/adr/0002).
 *
 * Only the EIGHT genuinely shared primitives live here. Mobile-only chrome
 * (Screen, IconButton, FAB, FloatingTabBar, Toast, Sheet, ProgressDots, Toggle,
 * AlbumRow, AlbumHeader, FilterChip, ClosingBanner, ActionCard) is declared
 * inside `@photu/ui-native`, because a shared contract for something with one
 * implementation is just indirection.
 *
 * `children` is deliberately typed as `unknown` here: RN's ReactNode and the
 * DOM's differ, and this package must not depend on a React version. Each
 * implementation narrows it.
 */
import type { ButtonSize, TextStyleName } from '@photu/tokens'

export { FILLED_ICONS, ICON_NAMES, ICON_STROKE, type IconName } from './icons'

/** Every button appearance. */
export type ButtonKind =
  | 'primary'
  | 'accent'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'danger'
  /**
   * Not in the prototype's style map, but passed by several screens — which then
   * patch around the resulting undefined with an inline style. Declared here so
   * the implementations handle it properly. Renders as ink-on-bg, i.e. the same
   * as `primary`; kept distinct because the call sites mean "inverted", and
   * collapsing them would lose that intent.
   */
  | 'ink'

export interface ButtonProps {
  children?: unknown
  kind?: ButtonKind
  size?: ButtonSize
  /** Stretch to the container width. */
  full?: boolean
  disabled?: boolean
  /** Shows a spinner and blocks presses. */
  loading?: boolean
  /** Icon before the label. */
  leading?: unknown
  /** Icon after the label. */
  trailing?: unknown
  onPress?: () => void
  /**
   * Required when the button has no text label (icon-only). Every control needs
   * one — the prototype has no accessibility annotations at all and the spec
   * requires full VoiceOver/TalkBack coverage.
   */
  accessibilityLabel?: string
}

export type ChipTone =
  | 'neutral'
  | 'accent'
  | 'danger'
  | 'ink'
  /** Over a photograph, where no palette token can be trusted for contrast. */
  | 'glass'

export interface ChipProps {
  children?: unknown
  tone?: ChipTone
  /** A small dot or icon before the label. */
  leading?: unknown
  accessibilityLabel?: string
}

export interface AvatarProps {
  /**
   * The user id. Colour is derived deterministically from this via
   * `avatarColor()` so a person looks the same on every device.
   */
  userId: string
  /** Used for initials; colour comes from `userId`, not this. */
  name: string
  /** Remote avatar image. Falls back to initials while loading or on error. */
  imageUrl?: string | null
  size?: number
  /** Accent ring — marks "this is you" in a member list. */
  ring?: boolean
}

export interface AvatarStackMember {
  userId: string
  name: string
  imageUrl?: string | null
}

export interface AvatarStackProps {
  members: readonly AvatarStackMember[]
  size?: number
  /** Avatars shown before collapsing into a "+N" counter. */
  max?: number
  /**
   * Total member count, when it exceeds `members.length` — the API returns a few
   * avatars plus a count rather than all 30. Without this the "+N" would
   * undercount.
   */
  totalCount?: number
}

export interface PhotoTileProps {
  /** Thumbnail URL. A stable API URL that 302s to S3, never a presigned URL
   *  directly — presigned URLs rotate their query string and defeat the image
   *  cache. See docs/adr/0003. */
  uri: string
  /** width / height. Drives the tile's height from its width. */
  aspectRatio: number
  width?: number
  /** Explicit radius override; defaults to the grid-tile radius. */
  rounded?: number
  /** Grayscale + reduced opacity, used for locked albums. */
  dimmed?: boolean
  /** Uppercase mono badge, top-left (e.g. "ORIG"). */
  badge?: string
  /** Small mono label, bottom-left. */
  label?: string
  /** Video duration in ms — renders a duration pill and a play affordance. */
  durationMs?: number
  onPress?: () => void
  /** Entry point for the "Hide me" flow, per spec flow 7. */
  onLongPress?: () => void
  /** Describes the photo for screen readers (uploader, time, who's in it). */
  accessibilityLabel?: string
}

export interface SectionLabelProps {
  children?: unknown
}

export interface IconProps {
  name: import('./icons').IconName
  size?: number
  /** Defaults to the current text colour. */
  color?: string
  /** No effect on the filled icons — see FILLED_ICONS. */
  strokeWidth?: number
}

export interface FormFieldProps {
  /** Rendered uppercase mono. */
  label: string
  /** Help text below the field. */
  hint?: string
  /** Validation message; replaces `hint` and recolours the border. */
  error?: string
  children?: unknown
}

/**
 * Text is not one of the eight shared primitives — RN needs a `<Text>` wrapper
 * while the web uses semantic elements — but the style NAME must be common to
 * both, so a design change lands in one place.
 */
export interface TextProps {
  variant: TextStyleName
  children?: unknown
}
