/**
 * Chip — the small pill used for album status, filters and metadata.
 */
import { overlay } from '@photu/tokens'
import type { ChipTone } from '@photu/ui-spec'
import type { ReactNode } from 'react'
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native'
import { Text } from './Text'
import { type Theme, useTheme } from './theme'

export interface ChipProps {
  children?: ReactNode
  tone?: ChipTone
  leading?: ReactNode
  style?: StyleProp<ViewStyle>
  accessibilityLabel?: string
}

const toneColors = (tone: ChipTone, t: Theme) => {
  switch (tone) {
    case 'neutral':
      return { bg: t.surfaceAlt, fg: t.inkSoft }
    case 'accent':
      // accentSoft is a real tint in the warm palettes but a low-alpha ink overlay
      // in the dark and monochrome ones, so the foreground is `accent` rather than
      // an assumption that `ink` reads on it.
      return { bg: t.accentSoft, fg: t.accent }
    case 'danger':
      return { bg: t.semantic.chipDangerBg, fg: t.danger }
    case 'ink':
      return { bg: t.ink, fg: t.bg }
    case 'glass':
      // Over a photograph no palette token can be trusted for contrast, so this
      // is a fixed black scrim with white text regardless of palette.
      return { bg: overlay.chipBg, fg: overlay.ink }
  }
}

export function Chip({
  children,
  tone = 'neutral',
  leading,
  style,
  accessibilityLabel,
}: ChipProps) {
  const t = useTheme()
  const c = toneColors(tone, t)

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={[styles.base, { backgroundColor: c.bg }, style]}
    >
      {leading != null && <View style={styles.slot}>{leading}</View>}
      <Text color={c.fg} variant="chip">
        {children}
      </Text>
    </View>
  )
}

/**
 * The 6px status dot the prototype puts inside album-status chips
 * ("4 days left", "Locks in 1d", "Locked · Keepsake").
 */
export function ChipDot({ color }: { color: string }) {
  return <View style={[styles.dot, { backgroundColor: color }]} />
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  slot: { alignItems: 'center', justifyContent: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3 },
})
