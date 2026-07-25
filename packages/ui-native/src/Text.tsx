/**
 * Typography. Screens use `variant`, never raw fontSize/fontFamily.
 *
 * The prototype hardcodes size + weight + tracking at every call site; ported
 * literally that is ~200 magic numbers with no way to correct Android tracking
 * globally. See docs/design-system.md.
 */
import type { TextStyleName } from '@photu/tokens'
import type { ReactNode } from 'react'
import { Text as RNText, type StyleProp, type TextStyle } from 'react-native'
import { useTheme } from './theme'

export interface TextProps {
  variant?: TextStyleName
  /** Any palette colour key, or an explicit colour string. Defaults to `ink`. */
  color?: string
  align?: 'left' | 'center' | 'right'
  numberOfLines?: number
  style?: StyleProp<TextStyle>
  children?: ReactNode
  /** Screen-reader override when the visible text is not the useful label. */
  accessibilityLabel?: string
}

export function Text({
  variant = 'bodySm',
  color,
  align,
  numberOfLines,
  style,
  children,
  accessibilityLabel,
}: TextProps) {
  const t = useTheme()
  return (
    <RNText
      accessibilityLabel={accessibilityLabel}
      numberOfLines={numberOfLines}
      style={[
        t.text[variant],
        { color: color ?? t.ink },
        align ? { textAlign: align } : null,
        style,
      ]}
    >
      {children}
    </RNText>
  )
}

/**
 * The uppercase mono eyebrow used throughout the design (SectionLabel in the
 * prototype). A component rather than a variant because the colour and transform
 * are part of its identity, not styling choices at the call site.
 */
export function SectionLabel({
  children,
  style,
}: {
  children?: ReactNode
  style?: StyleProp<TextStyle>
}) {
  const t = useTheme()
  return <RNText style={[t.text.sectionLabel, { color: t.inkMuted }, style]}>{children}</RNText>
}
