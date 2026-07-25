import { Chip, ChipDot, Icon, Screen, Text, useTheme } from '@photu/ui-native'
import { Image } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from 'react-native'
import { useAlbum, useAlbumFeed, useAlbumMembers } from '../../../../src/api/hooks'
import type { FeedItem } from '../../../../src/api/types'
import { useSessionStore } from '../../../../src/auth/session'

const GRID_COLUMNS = 3
const GRID_GAP = 4

/**
 * The album feed. From the prototype's `ScreenAlbumFeed`.
 *
 * `locked` is a render branch here, not a separate route: an album transitions
 * Active → Locked while you are looking at it, and every deep link points at the
 * album rather than at a lifecycle state.
 */
export default function AlbumScreen() {
  const t = useTheme()
  const router = useRouter()
  const { albumId } = useLocalSearchParams<{ albumId: string }>()
  const [filter, setFilter] = useState<'all' | 'just-me'>('all')

  const album = useAlbum(albumId)
  const members = useAlbumMembers(albumId)
  const processing = album.data?.processingCount ?? 0
  const feed = useAlbumFeed(albumId, filter, processing > 0)

  const items = useMemo(() => feed.data?.pages.flatMap(p => p.items) ?? [], [feed.data])

  const tileSize = useMemo(() => {
    const width = Dimensions.get('window').width - 32
    return Math.floor((width - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS)
  }, [])

  const locked = album.data?.state !== 'active'

  return (
    <Screen>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 16,
          paddingTop: 6,
          paddingBottom: 12,
        }}
      >
        <Pressable
          accessibilityLabel="Back"
          hitSlop={10}
          onPress={() => router.back()}
          style={{
            width: 38,
            height: 38,
            borderRadius: 19,
            backgroundColor: t.surface,
            borderWidth: 1,
            borderColor: t.line,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon color={t.ink} name="chevron-left" size={17} />
        </Pressable>
        <View style={{ flex: 1 }} />
        {!locked && (
          <Pressable
            accessibilityLabel="Add photos"
            onPress={() => router.push(`/(modals)/upload/${albumId}`)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              height: 38,
              paddingHorizontal: 16,
              borderRadius: 19,
              backgroundColor: t.accent,
            }}
          >
            <Icon color={t.accentInk} name="plus" size={16} />
            <Text color={t.accentInk} variant="label">
              Add photos
            </Text>
          </Pressable>
        )}
      </View>

      {/* Title block */}
      <View style={{ paddingHorizontal: 16, paddingBottom: 12, gap: 8 }}>
        <Text variant="title">{album.data?.title ?? '…'}</Text>
        <Text color={t.inkMuted} variant="meta">
          {plural(album.data?.memberCount ?? 0, 'member')} ·{' '}
          {plural(album.data?.mediaCount ?? 0, 'photo')}
        </Text>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {locked ? (
            <Chip leading={<Icon color={t.bg} name="lock" size={12} />} tone="ink">
              Locked · Keepsake
            </Chip>
          ) : (
            <Chip leading={<ChipDot color={t.success} />}>
              {daysLeft(album.data?.windowEndsAt)} days left
            </Chip>
          )}
          {album.data?.privacyMode === 'face' && (
            <Chip leading={<Icon color={t.accent} name="face" size={12} />} tone="accent">
              Face-privacy
            </Chip>
          )}
        </View>
      </View>

      {processing > 0 && (
        <View
          style={{
            marginHorizontal: 16,
            marginBottom: 12,
            padding: 12,
            borderRadius: t.radii.md,
            backgroundColor: t.accentSoft,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <ActivityIndicator color={t.accent} size="small" />
          <Text color={t.accent} variant="caption">
            {plural(processing, 'photo')} still processing — they appear here automatically.
          </Text>
        </View>
      )}

      {/* Filter chips. Only "All" and "Just me" are wired; the prototype's
          By person / By scene chips have no backing endpoint yet. */}
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 12 }}>
        <FilterChip active={filter === 'all'} label="All" onPress={() => setFilter('all')} />
        <FilterChip
          active={filter === 'just-me'}
          icon="face"
          label="Just me"
          onPress={() => setFilter('just-me')}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 60 }}
        onMomentumScrollEnd={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage()
        }}
        refreshControl={
          <RefreshControl
            onRefresh={() => {
              void feed.refetch()
              void album.refetch()
            }}
            refreshing={feed.isRefetching}
            tintColor={t.inkMuted}
          />
        }
      >
        {feed.isLoading && (
          <View style={{ paddingVertical: 48, alignItems: 'center' }}>
            <ActivityIndicator color={t.inkMuted} />
          </View>
        )}

        {!feed.isLoading && items.length === 0 && (
          <EmptyFeed filter={filter} privacyMode={album.data?.privacyMode} />
        )}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP }}>
          {items.map(item => (
            <PhotoTile
              item={item}
              key={item.id}
              onPress={() => router.push(`/(app)/album/${albumId}/photo/${item.id}`)}
              size={tileSize}
            />
          ))}
        </View>

        {feed.isFetchingNextPage && (
          <View style={{ paddingVertical: 20, alignItems: 'center' }}>
            <ActivityIndicator color={t.inkMuted} />
          </View>
        )}

        {members.data && members.data.length > 0 && (
          <Text color={t.inkMuted} style={{ marginTop: 24 }} variant="monoMeta">
            {members.data.map(m => m.displayName).join(' · ')}
          </Text>
        )}
      </ScrollView>
    </Screen>
  )
}

/** "1 member" not "1 members". Trivial, but it is the kind of thing that makes an
 *  app feel unfinished — and it was visible on the very first real album. */
function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

function daysLeft(windowEndsAt?: string): number {
  if (!windowEndsAt) return 0
  return Math.max(0, Math.ceil((new Date(windowEndsAt).getTime() - Date.now()) / 86_400_000))
}

function FilterChip({
  active,
  label,
  icon,
  onPress,
}: {
  active: boolean
  label: string
  icon?: 'face'
  onPress: () => void
}) {
  const t = useTheme()
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 999,
        backgroundColor: active ? t.ink : t.surface,
        borderWidth: active ? 0 : 1,
        borderColor: t.line,
      }}
    >
      {icon && <Icon color={active ? t.bg : t.ink} name={icon} size={13} />}
      <Text color={active ? t.bg : t.ink} variant="label">
        {label}
      </Text>
    </Pressable>
  )
}

function PhotoTile({ item, size, onPress }: { item: FeedItem; size: number; onPress: () => void }) {
  const t = useTheme()
  const { accessToken } = useSessionStore()

  return (
    <Pressable onPress={onPress}>
      <Image
        // The thumb URL is STABLE, so expo-image's cache actually hits. It 302s to a
        // short-lived presigned URL after re-checking visibility server-side.
        cachePolicy="memory-disk"
        contentFit="cover"
        // The redirect target is on S3, but the redirect ITSELF is authorized, so the
        // bearer token has to ride along on the first hop.
        source={{
          uri: item.thumbUrl,
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        }}
        style={{
          width: size,
          height: size,
          borderRadius: t.componentRadii.gridTile,
          backgroundColor: t.surfaceAlt,
        }}
        transition={120}
      />
      {item.viewerAppears && (
        <View
          style={{
            position: 'absolute',
            top: 4,
            left: 4,
            width: 16,
            height: 16,
            borderRadius: 8,
            backgroundColor: t.accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon color={t.accentInk} name="face" size={10} />
        </View>
      )}
    </Pressable>
  )
}

function EmptyFeed({ filter, privacyMode }: { filter: 'all' | 'just-me'; privacyMode?: string }) {
  const t = useTheme()

  // Under face-privacy an empty feed is expected rather than broken, and the copy
  // has to say so — otherwise it reads as a bug. See docs/adr/0005.
  const facePrivacy = privacyMode === 'face'
  const title = filter === 'just-me' ? 'No photos of you yet' : 'No photos yet'
  const body =
    filter === 'just-me' || facePrivacy
      ? 'This album uses face-privacy, so you only see photos you appear in, plus photos with no people. As the group uploads, photos of you appear here.'
      : 'Add the first photos with the button above. They upload at original quality.'

  return (
    <View style={{ paddingVertical: 56, paddingHorizontal: 24, alignItems: 'center', gap: 12 }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: t.surface,
          borderWidth: 1,
          borderColor: t.line,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon color={t.inkMuted} name={filter === 'just-me' ? 'face' : 'images'} size={26} />
      </View>
      <Text align="center" variant="titleSm">
        {title}
      </Text>
      <Text align="center" color={t.inkSoft} variant="bodyM">
        {body}
      </Text>
    </View>
  )
}
