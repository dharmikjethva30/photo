import { overlay, viewer as viewerTokens } from '@photu/tokens'
import { Icon, Text } from '@photu/ui-native'
import { Image } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useVideoPlayer, VideoView } from 'expo-video'
import { useMemo } from 'react'
import { Dimensions, Pressable, StatusBar, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { API_BASE_URL } from '../../../../../src/api/client'
import { useAlbumFeed, useHideMedia } from '../../../../../src/api/hooks'
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
  const hide = useHideMedia(albumId)

  const { width, height } = Dimensions.get('window')

  const isVideo = item?.kind === 'video'

  // Playback streams the ORIGINAL — no transcode, so the bytes on screen are the bytes
  // that were uploaded. The /original endpoint re-checks visibility and 302s to a
  // short-lived presigned S3 URL; the bearer token rides the first hop, and expo-video
  // follows the redirect to the (unauthenticated) presigned URL itself.
  //
  // useVideoPlayer is called unconditionally (rules of hooks) with a null source for a
  // photo, which simply creates an idle player.
  const videoSource =
    isVideo && item
      ? {
          uri: `${API_BASE_URL}/v1/media/${item.id}/original`,
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        }
      : null
  const player = useVideoPlayer(videoSource, p => {
    p.loop = false
  })

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

      {isVideo ? (
        // Native controls (play/scrub/mute) rather than the photo pinch-zoom gesture —
        // a video needs a transport, not a magnifier. The poster frame shows while the
        // first bytes stream in.
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <VideoView
            contentFit="contain"
            nativeControls
            player={player}
            style={{ width, height: height * 0.8 }}
          />
        </View>
      ) : (
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
      )}

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

      {/* Bottom bar. Hide-me and Share appear only for a photo the viewer actually
          appears in — those are subject controls, meaningless for anyone else, and
          offering them would leak whether the server thinks you're in the frame. */}
      <View
        style={{
          position: 'absolute',
          bottom: insets.bottom + 24,
          left: 16,
          right: 16,
          alignItems: 'center',
          gap: 16,
        }}
      >
        {item?.viewerAppears && (
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <OverlayAction
              icon="share"
              label="Share of me"
              onPress={() => router.push(`/(modals)/share/${albumId}?photoId=${item.id}`)}
            />
            <OverlayAction
              busy={hide.isPending}
              icon="eye-off"
              label="Hide me"
              onPress={() =>
                hide.mutate(
                  { mediaId: item.id, hide: true },
                  // The photo leaves every feed the moment the veto lands, so there is
                  // nothing left to look at here — return to the grid.
                  { onSuccess: () => router.back() },
                )
              }
            />
          </View>
        )}
        <Text color={overlay.inkMuted} variant="monoMeta">
          {item?.width && item.height ? `ORIG · ${item.width}×${item.height}` : 'ORIGINAL QUALITY'}
        </Text>
      </View>
    </View>
  )
}

function OverlayAction({
  icon,
  label,
  onPress,
  busy = false,
}: {
  icon: 'share' | 'eye-off'
  label: string
  onPress: () => void
  busy?: boolean
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      disabled={busy}
      hitSlop={8}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 16,
        height: 44,
        borderRadius: 22,
        backgroundColor: overlay.controlBg,
        opacity: busy ? 0.6 : 1,
      }}
    >
      <Icon color={overlay.ink} name={icon} size={16} />
      <Text color={overlay.ink} variant="label">
        {label}
      </Text>
    </Pressable>
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
