/**
 * Screen — replaces the prototype's `Frame`.
 *
 * `Frame` existed to draw a fake status bar inside a fake phone. A real app gets
 * the real one, so this instead owns the two things every screen must get right:
 * safe-area insets, and the bottom padding that clears the floating tab bar.
 */
import { SCROLL_BOTTOM_PADDING } from '@photu/tokens'
import type { ReactNode } from 'react'
import { ScrollView, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from './theme'

export interface ScreenProps {
  children?: ReactNode
  /** Wrap the content in a ScrollView. */
  scroll?: boolean
  /** Apply the standard 24px horizontal screen padding. */
  padded?: boolean
  /**
   * Set when the floating tab bar is mounted over this screen. The island is
   * absolutely positioned and reserves NO layout space, so without this the last
   * row of any list sits permanently underneath it.
   */
  hasTabBar?: boolean
  /** Skip the top inset — for screens whose content runs under the status bar. */
  edgeToEdgeTop?: boolean
  style?: StyleProp<ViewStyle>
}

export function Screen({
  children,
  scroll = false,
  padded = false,
  hasTabBar = false,
  edgeToEdgeTop = false,
  style,
}: ScreenProps) {
  const t = useTheme()
  const insets = useSafeAreaInsets()

  const paddingTop = edgeToEdgeTop ? 0 : insets.top
  const paddingBottom = hasTabBar ? SCROLL_BOTTOM_PADDING + insets.bottom : insets.bottom
  const paddingHorizontal = padded ? t.screenSpace.gutter : 0

  if (scroll) {
    return (
      <View style={[styles.root, { backgroundColor: t.bg, paddingTop }, style]}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal, paddingBottom }}
          // The design is "photos lead, chrome fades away" — a visible scrollbar
          // over a photo grid is exactly the kind of chrome it asks us to drop.
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </View>
    )
  }

  return (
    <View
      style={[
        styles.root,
        { backgroundColor: t.bg, paddingTop, paddingBottom, paddingHorizontal },
        style,
      ]}
    >
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
})
