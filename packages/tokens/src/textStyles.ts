/**
 * Named text styles.
 *
 * The prototype hardcodes size + weight + letterSpacing at every call site
 * (`fontSize: 54, letterSpacing: -1.2`). Ported literally that is ~200 magic
 * numbers with no way to correct Android letter-spacing globally. Screens use
 * these names instead and never set `fontSize` or `fontFamily` directly.
 *
 * PLATFORM VARIANCE: Android applies tracking after scaling, so tight negative
 * letter-spacing at display sizes renders visibly tighter than on iOS. The
 * affected styles carry `letterSpacingAndroid`. This package cannot import
 * `react-native` (apps/web consumes it too — see docs/adr/0002), so the value is
 * expressed as DATA and resolved by the theme layer in `@photu/ui-native`.
 */
import { fontFamilies as f } from './fonts'

export interface TextStyle {
  fontFamily: string
  fontSize: number
  /** Absolute px, not a multiplier — React Native requires absolute. */
  lineHeight?: number
  letterSpacing?: number
  /** Android-only override, resolved by the consuming theme layer. */
  letterSpacingAndroid?: number
  textTransform?: 'uppercase'
  fontStyle?: 'italic'
}

export const textStyles = {
  // ---------------------------------------------------------------- serif
  /** Sign-in hero. "One album. / Everyone's photos. / Original quality." */
  display: {
    fontFamily: f.serif.medium,
    fontSize: 38,
    lineHeight: 40,
    letterSpacing: -0.6,
    letterSpacingAndroid: -0.3,
  },
  /** Root screen titles: "Your albums", "Activity". */
  titleXl: {
    fontFamily: f.serif.medium,
    fontSize: 34,
    lineHeight: 38,
    letterSpacing: -0.5,
    letterSpacingAndroid: -0.25,
  },
  /** Modal titles: "What's the occasion?", "Invite the group". */
  titleLg: {
    fontFamily: f.serif.medium,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -0.4,
    letterSpacingAndroid: -0.2,
  },
  /** Album header, face-tag prompt. */
  title: {
    fontFamily: f.serif.medium,
    fontSize: 26,
    lineHeight: 30,
    letterSpacing: -0.4,
    letterSpacingAndroid: -0.2,
  },
  /** Section headings, sheet titles, empty-state headings. */
  titleSm: {
    fontFamily: f.serif.medium,
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: -0.3,
  },
  /** Album row name in the library list. */
  titleRow: {
    fontFamily: f.serif.medium,
    fontSize: 19,
    lineHeight: 23,
    letterSpacing: -0.2,
  },
  /** Value text inside a FormField. */
  fieldValue: {
    fontFamily: f.serif.regular,
    fontSize: 18,
    lineHeight: 24,
  },
  /** Photo captions, the locked-album note. */
  editorial: {
    fontFamily: f.serif.mediumItalic,
    fontSize: 18,
    lineHeight: 23,
    fontStyle: 'italic',
  },
  /** Taglines, palette hints, notification previews. */
  quote: {
    fontFamily: f.serif.italic,
    fontSize: 13,
    lineHeight: 18,
    fontStyle: 'italic',
  },

  // ----------------------------------------------------------------- sans
  /** Lead paragraphs under a display/title. */
  body: {
    fontFamily: f.sans.regular,
    fontSize: 15.5,
    lineHeight: 22,
  },
  /** Nav bar titles, md/lg button labels. */
  bodyStrong: {
    fontFamily: f.sans.semibold,
    fontSize: 15,
    lineHeight: 20,
  },
  /** Explanatory body copy. */
  bodyM: {
    fontFamily: f.sans.regular,
    fontSize: 14.5,
    lineHeight: 22,
  },
  /** List row labels. */
  bodySm: {
    fontFamily: f.sans.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  /** List row labels needing emphasis, card titles. */
  bodySmStrong: {
    fontFamily: f.sans.semibold,
    fontSize: 14,
    lineHeight: 20,
  },
  /** Tab bar labels, sm button labels. */
  label: {
    fontFamily: f.sans.semibold,
    fontSize: 13,
    lineHeight: 16,
    letterSpacing: -0.1,
  },
  /** Secondary explanatory text. */
  caption: {
    fontFamily: f.sans.regular,
    fontSize: 13,
    lineHeight: 20,
  },
  /** Chip text. */
  chip: {
    fontFamily: f.sans.semibold,
    fontSize: 12,
    lineHeight: 15,
    letterSpacing: -0.1,
  },
  /** "5 members · 184 photos". */
  meta: {
    fontFamily: f.sans.regular,
    fontSize: 12,
    lineHeight: 16,
  },
  /** Sub-captions under an ActionCard. */
  metaSm: {
    fontFamily: f.sans.regular,
    fontSize: 11.5,
    lineHeight: 15,
  },
  /** Notification count on an IconButton badge. */
  badgeCount: {
    fontFamily: f.sans.bold,
    fontSize: 9,
    lineHeight: 11,
  },

  // ----------------------------------------------------------------- mono
  /** SectionLabel — the uppercase mono eyebrow used throughout. */
  sectionLabel: {
    fontFamily: f.mono.regular,
    fontSize: 10.5,
    lineHeight: 14,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  /** FormField label. Same size, looser tracking than sectionLabel. */
  fieldLabel: {
    fontFamily: f.mono.regular,
    fontSize: 10.5,
    lineHeight: 14,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  /** Timestamps, counters, invite URLs, receipt lines. */
  monoMeta: {
    fontFamily: f.mono.regular,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.4,
  },
  /** Overlay badge on a photo tile ("ORIG · 4032×3024"). */
  monoBadge: {
    fontFamily: f.mono.regular,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
} as const satisfies Record<string, TextStyle>

export type TextStyleName = keyof typeof textStyles
