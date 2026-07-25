/**
 * The single place blur is decided.
 *
 * Every frosted surface in the design (tab island, viewer chrome, toast, metadata
 * pills) goes through here, for three reasons:
 *
 *   1. `borderRadius` on a BlurView does NOT clip on Android — the parent must
 *      have `overflow: 'hidden'`. Encoding that once stops it being rediscovered.
 *   2. The tint depends on whether the palette is dark, which is a token concern
 *      rather than a per-component decision.
 *   3. Android blur needs an explicit target (see below), and that requirement
 *      should be visible in one place rather than surprising each screen.
 *
 * ANDROID REQUIRES A BLUR TARGET.
 *
 * On iOS a BlurView blurs whatever happens to be behind it. On Android,
 * expo-blur's `dimezisBlurView` can only blur a view that has been explicitly
 * designated: the content must be wrapped in `<BlurTargetView>` and its ref
 * passed here as `blurTarget`. Without one, expo-blur logs
 *
 *   "you have selected the dimezisBlurView blur method, but the `blurTarget`
 *    prop has not been configured. The blur view will fallback to none"
 *
 * and silently renders a flat translucent fill. So rather than always asking for
 * a blur method and hoping, this component only enables it when a target exists,
 * and otherwise renders the opaque material deliberately. That fallback is a
 * perfectly good look — it is what the design degrades to on a low-end device —
 * so screens are not obliged to provide a target.
 *
 * Consequence for the album feed: to blur the grid behind the floating tab
 * island on Android, the feed's scroll content must be wrapped in a
 * BlurTargetView and share its ref with the tab bar. That wiring lands with the
 * feed itself.
 */
import { blur as blurTokens, glassFallback, glassMaterial } from '@photu/tokens'
import { BlurView } from 'expo-blur'
import type { ReactNode, RefObject } from 'react'
import { Platform, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native'
import { useTheme } from './theme'

/**
 * Set false to disable blur globally (Android perf, or a low-end device flag).
 * A module-level switch rather than a prop so it cannot be forgotten at a call
 * site — and so a future runtime device check has one place to write to.
 */
let blurEnabled = true

export const setBlurEnabled = (enabled: boolean) => {
  blurEnabled = enabled
}

export interface GlassProps {
  intensity?: keyof typeof blurTokens
  /** Must carry `overflow: 'hidden'` if it sets a borderRadius (see above). */
  style?: StyleProp<ViewStyle>
  borderRadius?: number
  /**
   * Android only, and required there for a real blur: a ref to the
   * `<BlurTargetView>` wrapping the content this surface should blur. Omit it and
   * Android renders the opaque material instead.
   */
  blurTarget?: RefObject<View | null>
  children?: ReactNode
}

export function Glass({
  intensity = 'control',
  style,
  borderRadius,
  blurTarget,
  children,
}: GlassProps) {
  const t = useTheme()

  const clip: ViewStyle | null =
    borderRadius === undefined ? null : { borderRadius, overflow: 'hidden' }

  // Android can only blur a designated target; without one, asking for a blur
  // method just produces a warning and the same flat fill we render here.
  const canBlur = blurEnabled && (Platform.OS !== 'android' || blurTarget !== undefined)

  if (!canBlur) {
    return (
      <View
        style={[
          clip,
          { backgroundColor: t.isDark ? glassFallback.dark : glassFallback.light },
          style,
        ]}
      >
        {children}
      </View>
    )
  }

  return (
    <View style={[clip, style]}>
      <BlurView
        blurTarget={blurTarget}
        // `blurMethod`, not the deprecated `experimentalBlurMethod`.
        // The Sdk31Plus variant falls back to 'none' on older Android, where the
        // implementation is too slow to use on a scrolling surface.
        blurMethod={Platform.OS === 'android' ? 'dimezisBlurViewSdk31Plus' : 'none'}
        intensity={blurTokens[intensity]}
        style={StyleSheet.absoluteFill}
        tint={t.isDark ? 'dark' : 'light'}
      />
      {/* A translucent wash over the blur. Blur alone does not give the design's
          material — the prototype layers rgba(255,255,255,0.72) on top. */}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: t.isDark ? glassMaterial.dark : glassMaterial.light },
        ]}
      />
      {children}
    </View>
  )
}

/**
 * Re-exported so screens can wrap their scroll content without importing
 * expo-blur directly — keeping every blur decision inside this module.
 */
export { BlurTargetView } from 'expo-blur'
