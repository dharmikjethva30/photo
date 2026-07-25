import { overlay, viewer as viewerTokens } from '@photu/tokens'
import { Icon, Text } from '@photu/ui-native'
import { Image } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo } from 'react'
import { Dimensions, Pressable, StatusBar, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAlbumFeed } from '../../../../../src/api/hooks'
import { useSessionStore } from '../../../../../src/auth/session'

/**
 * Full-screen photo viewer. From the prototype's `ScreenViewer`.
 *
 * Always dark regardless of palette: the design principle is "photos lead, chrome
 * fades away", so the viewer does not adopt a light palette's background.
 */
export default function PhotoViewer() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { albumId, photoId } = useLocalSearchParams<{ albumId: string; photoId: string }>()

  // Read from the cache the feed already populated rather than refetching a single
  // item — the user came from the grid, so it is warm.
  const feed = useAlbumFeed(albumId)
  const item = useMemo(
    () => feed.data?.pages.flatMap(p => p.items).find(i => i.id === photoId),
    [feed.data, photoId],
  )
  const { accessToken } = useSessionStore()

  const { width, height } = Dimensions.get('window')

  // Pinch to zoom and pan, with double-tap to toggle. Reanimated so the gesture runs
  // on the UI thread; doing this in JS drops frames on a large image.
  const scale = useSharedValue(1)
  const savedScale = useSharedValue(1)
  const translateX = useSharedValue(0)
  const translateY = useSharedValue(0)
  const savedX = useSharedValue(0)
  const savedY = useSharedValue(0)

  const pinch = Gesture.Pinch()
    .onUpdate(e => {
      scale.value = Math.max(1, savedScale.value * e.scale)
    })
    .onEnd(() => {
      savedScale.value = scale.value
      if (scale.value <= 1) {
        // Snap back and re-centre, so a pinch-out cannot leave the photo stranded.
        scale.value = withTiming(1)
        translateX.value = withTiming(0)
        translateY.value = withTiming(0)
        savedScale.value = 1
        savedX.value = 0
        savedY.value = 0
      }
    })

  const pan = Gesture.Pan()
    .onUpdate(e => {
      // Panning only makes sense while zoomed in.
      if (scale.value <= 1) return
      translateX.value = savedX.value + e.translationX
      translateY.value = savedY.value + e.translationY
    })
    .onEnd(() => {
      savedX.value = translateX.value
      savedY.value = translateY.value
    })

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      const zoomed = scale.value > 1
      scale.value = withTiming(zoomed ? 1 : 2.5)
      savedScale.value = zoomed ? 1 : 2.5
      if (zoomed) {
        translateX.value = withTiming(0)
        translateY.value = withTiming(0)
        savedX.value = 0
        savedY.value = 0
      }
    })

  const gesture = Gesture.Simultaneous(pinch, Gesture.Exclusive(doubleTap, pan))

  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }))

  return (
    <View style={{ flex: 1, backgroundColor: viewerTokens.bg }}>
      <StatusBar barStyle="light-content" />

      <GestureDetector gesture={gesture}>
        <Animated.View style={[{ flex: 1, alignItems: 'center', justifyContent: 'center' }]}>
          {item && (
            <Animated.View style={imageStyle}>
              <Image
                cachePolicy="memory-disk"
                contentFit="contain"
                source={{
                  uri: item.previewUrl,
                  headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
                }}
                style={{ width, height: height * 0.8 }}
                transition={160}
              />
            </Animated.View>
          )}
        </Animated.View>
      </GestureDetector>

      {/* Top bar: glass back button and attribution, matching the prototype. */}
      <View
        style={{
          position: 'absolute',
          top: insets.top + 8,
          left: 16,
          right: 16,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Pressable
          accessibilityLabel="Close"
          hitSlop={10}
          onPress={() => router.back()}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: overlay.controlBg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon color={overlay.ink} name="chevron-left" size={18} />
        </Pressable>

        <View style={{ flex: 1 }} />

        {item && (
          <View
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 999,
              backgroundColor: overlay.chipBg,
            }}
          >
            <Text color={overlay.ink} variant="chip">
              {item.uploaderName} · {formatTime(item.captureTime)}
            </Text>
          </View>
        )}
      </View>

      {/* Bottom bar. Save / Share / Hide me / Allowlist are M5-M6 endpoints, so they
          are deliberately absent rather than present and inert — a button that does
          nothing is worse than one that is not there. */}
      <View
        style={{
          position: 'absolute',
          bottom: insets.bottom + 24,
          left: 16,
          right: 16,
          alignItems: 'center',
        }}
      >
        <Text color={overlay.inkMuted} variant="monoMeta">
          {item?.width && item.height ? `ORIG · ${item.width}×${item.height}` : 'ORIGINAL QUALITY'}
        </Text>
      </View>
    </View>
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
