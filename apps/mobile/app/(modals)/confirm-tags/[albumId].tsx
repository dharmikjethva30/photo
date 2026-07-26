import { Button, Icon, Screen, SectionLabel, Text, useTheme } from '@photu/ui-native'
import { Image } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, Dimensions, View } from 'react-native'
import { useDecideFaceTag, useSuggestedTags } from '../../../src/api/hooks'
import type { SuggestedTag } from '../../../src/api/types'
import { useSessionStore } from '../../../src/auth/session'

/**
 * "You're in these" — confirm or reject the photos photu thinks you appear in.
 *
 * This is the load-bearing screen of face-privacy's UX. Auto-matching only ever
 * SUGGESTS; a photo becomes visible to you only once you confirm here. So a
 * face-privacy album starts nearly empty per viewer and fills as they confirm —
 * this sheet is how it fills, and why the design's answer to that emptiness is a
 * first-run confirm flow rather than a weaker matching threshold.
 */
export default function ConfirmTagsScreen() {
  const t = useTheme()
  const router = useRouter()
  const { albumId } = useLocalSearchParams<{ albumId: string }>()
  const { accessToken } = useSessionStore()

  const suggestions = useSuggestedTags(albumId)
  const decide = useDecideFaceTag(albumId)

  // Which tags the user has already acted on this session, so a decided card leaves
  // immediately rather than waiting for the list to refetch.
  const [decided, setDecided] = useState<Set<string>>(new Set())

  const all = suggestions.data?.suggestions ?? []
  const pending = all.filter(s => !decided.has(s.tagId))
  const current = pending[0]

  const act = (tag: SuggestedTag, confirm: boolean) => {
    setDecided(prev => new Set(prev).add(tag.tagId))
    decide.mutate({ tagId: tag.tagId, confirm })
  }

  const thumbW = Math.min(Dimensions.get('window').width - 32, 420)

  return (
    <Screen padded>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: 12,
        }}
      >
        <Text variant="titleLg">Are you in these?</Text>
        <Button kind="ghost" onPress={() => router.back()} size="sm">
          Done
        </Button>
      </View>

      <Text color={t.inkSoft} style={{ marginBottom: 16 }} variant="bodyM">
        Confirm the photos you're in and they'll appear in your album. Only you decide — nobody sees
        you in a photo until you say so.
      </Text>

      {suggestions.isLoading && (
        <View style={{ paddingVertical: 48, alignItems: 'center' }}>
          <ActivityIndicator color={t.inkMuted} />
        </View>
      )}

      {!suggestions.isLoading && pending.length === 0 && (
        <View style={{ paddingVertical: 48, alignItems: 'center', gap: 12 }}>
          <Icon color={t.success} name="check" size={28} />
          <Text color={t.inkMuted} variant="bodyM">
            Nothing to confirm right now.
          </Text>
        </View>
      )}

      {current && (
        <>
          <SectionLabel>
            {pending.length} {pending.length === 1 ? 'photo' : 'photos'} to review
          </SectionLabel>
          {/* One card at a time keeps the decision unambiguous — this is a yes/no about
              a specific face, not a gallery to browse. */}
          <TagCard
            accessToken={accessToken}
            key={current.tagId}
            onConfirm={() => act(current, true)}
            onReject={() => act(current, false)}
            tag={current}
            width={thumbW}
          />
        </>
      )}
    </Screen>
  )
}

function TagCard({
  tag,
  width,
  accessToken,
  onConfirm,
  onReject,
}: {
  tag: SuggestedTag
  width: number
  accessToken: string | null
  onConfirm: () => void
  onReject: () => void
}) {
  const t = useTheme()
  const height = width // square photo preview

  return (
    <View style={{ gap: 16, marginTop: 8 }}>
      <View
        style={{
          width,
          height,
          borderRadius: t.radii.lg,
          overflow: 'hidden',
          backgroundColor: t.surfaceAlt,
          alignSelf: 'center',
        }}
      >
        <Image
          cachePolicy="memory-disk"
          contentFit="cover"
          source={{
            uri: tag.thumbUrl,
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
          }}
          style={{ width, height }}
          transition={160}
        />
        {/* Highlight the specific face this suggestion is about, using the normalised
            bbox — several people may be in the frame. */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: tag.bbox.x * width,
            top: tag.bbox.y * height,
            width: tag.bbox.w * width,
            height: tag.bbox.h * height,
            borderWidth: 3,
            borderColor: t.accent,
            borderRadius: 8,
          }}
        />
      </View>

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Button full kind="outline" onPress={onReject} size="lg">
            Not me
          </Button>
        </View>
        <View style={{ flex: 1 }}>
          <Button
            full
            kind="primary"
            leading={<Icon color={t.bg} name="check" size={18} />}
            onPress={onConfirm}
            size="lg"
          >
            That's me
          </Button>
        </View>
      </View>
    </View>
  )
}
