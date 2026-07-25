/**
 * Font families, per weight.
 *
 * The prototype stores CSS font *stacks*
 * (`'"EB Garamond", "Iowan Old Style", Georgia, serif'`). React Native has no
 * font stacks and no font synthesis, and — the part that actually bites —
 * `fontWeight: 500` on a custom family silently renders the regular face on
 * Android, or picks a wrong one.
 *
 * So weight is encoded in the family NAME, matching the loaded font file names.
 * Screens should not read these directly; use `textStyles.ts`.
 */

export const fontFamilies = {
  /** All titles, album names, and editorial copy. */
  serif: {
    regular: 'EBGaramond-Regular',
    medium: 'EBGaramond-Medium',
    italic: 'EBGaramond-Italic',
    mediumItalic: 'EBGaramond-MediumItalic',
  },
  /** UI: buttons, labels, body, list rows. */
  sans: {
    medium: 'InterTight-Medium',
    semibold: 'InterTight-SemiBold',
    bold: 'InterTight-Bold',
    regular: 'InterTight-Regular',
  },
  /** Uppercase section labels, metadata, receipts, counters. */
  mono: {
    regular: 'JetBrainsMono-Regular',
    medium: 'JetBrainsMono-Medium',
  },
} as const

/**
 * Every font file the app must bundle, mapped to its family name. Consumed by the
 * `expo-font` config plugin so fonts are embedded at BUILD time rather than
 * fetched by `useFonts` at runtime — every title in this design is serif, so a
 * runtime font gate means a visible flash or a blocked splash on every cold start.
 */
export const fontAssets: Record<string, string> = {
  'EBGaramond-Regular': 'EBGaramond-Regular.ttf',
  'EBGaramond-Medium': 'EBGaramond-Medium.ttf',
  'EBGaramond-Italic': 'EBGaramond-Italic.ttf',
  'EBGaramond-MediumItalic': 'EBGaramond-MediumItalic.ttf',
  'InterTight-Regular': 'InterTight-Regular.ttf',
  'InterTight-Medium': 'InterTight-Medium.ttf',
  'InterTight-SemiBold': 'InterTight-SemiBold.ttf',
  'InterTight-Bold': 'InterTight-Bold.ttf',
  'JetBrainsMono-Regular': 'JetBrainsMono-Regular.ttf',
  'JetBrainsMono-Medium': 'JetBrainsMono-Medium.ttf',
}

/**
 * Web can have real fallback stacks, unlike RN. Used by the generated CSS.
 */
export const webFontStacks = {
  serif: '"EB Garamond", "Iowan Old Style", Georgia, serif',
  sans: '"Inter Tight", "Inter", -apple-system, system-ui, sans-serif',
  mono: '"JetBrains Mono", "SF Mono", ui-monospace, monospace',
} as const
