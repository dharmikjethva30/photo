/**
 * Button. Seven appearances, three sizes, always a full pill.
 *
 * Geometry from the prototype: heights 32/44/52, horizontal padding 12/18/22, and
 * `borderRadius = height / 2` so it is always fully rounded.
 */
import { buttonSizes } from '@photu/tokens'
import type { ButtonKind, ButtonProps as SpecProps } from '@photu/ui-spec'
import type { ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native'
import { Text } from './Text'
import { type Theme, useTheme } from './theme'

export interface ButtonProps extends Omit<SpecProps, 'children' | 'leading' | 'trailing'> {
  children?: ReactNode
  leading?: ReactNode
  trailing?: ReactNode
  style?: StyleProp<ViewStyle>
}

interface Appearance {
  background: string
  foreground: string
  borderColor?: string
}

const appearance = (kind: ButtonKind, t: Theme): Appearance => {
  switch (kind) {
    case 'primary':
      return { background: t.ink, foreground: t.bg }
    case 'accent':
      return { background: t.accent, foreground: t.accentInk }
    case 'secondary':
      return { background: t.surfaceAlt, foreground: t.ink }
    case 'outline':
      return { background: 'transparent', foreground: t.ink, borderColor: t.lineStrong }
    case 'ghost':
      return { background: 'transparent', foreground: t.ink }
    case 'danger':
      return { background: 'transparent', foreground: t.danger, borderColor: t.danger }
    case 'ink':
      // Several prototype screens pass kind="ink", which its style map does not
      // define, then patch around the resulting undefined with an inline style.
      // Declared properly here. Visually identical to `primary` today; kept
      // separate because the call sites mean "inverted", and collapsing them
      // would lose that intent if `primary` ever changes.
      return { background: t.ink, foreground: t.bg }
  }
}

export function Button({
  children,
  kind = 'primary',
  size = 'md',
  full,
  disabled,
  loading,
  leading,
  trailing,
  onPress,
  accessibilityLabel,
  style,
}: ButtonProps) {
  const t = useTheme()
  const a = appearance(kind, t)
  const geom = buttonSizes[size]
  const isBlocked = disabled === true || loading === true

  // md and lg use the 15px semibold label; sm drops to 13px.
  const variant = size === 'sm' ? 'label' : 'bodyStrong'

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: isBlocked, busy: loading === true }}
      disabled={isBlocked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          height: geom.height,
          paddingHorizontal: geom.paddingHorizontal,
          // Always a full pill.
          borderRadius: geom.height / 2,
          backgroundColor: a.background,
          borderWidth: a.borderColor ? StyleSheet.hairlineWidth * 2 : 0,
          borderColor: a.borderColor,
        },
        full === true && styles.full,
        // The prototype has no press states at all. Opacity is the minimum a real
        // app needs — a control that does not acknowledge a tap reads as broken,
        // especially while an upload request is in flight.
        pressed && styles.pressed,
        isBlocked && styles.blocked,
        style,
      ]}
    >
      {loading === true ? (
        <ActivityIndicator color={a.foreground} size="small" />
      ) : (
        <>
          {leading != null && <View style={styles.slot}>{leading}</View>}
          <Text color={a.foreground} variant={variant}>
            {children}
          </Text>
          {trailing != null && <View style={styles.slot}>{trailing}</View>}
        </>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  full: { width: '100%' },
  pressed: { opacity: 0.72 },
  blocked: { opacity: 0.4 },
  slot: { alignItems: 'center', justifyContent: 'center' },
})
