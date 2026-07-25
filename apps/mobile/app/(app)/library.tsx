import { Avatar, Button, Chip, ChipDot, Icon, Screen, Text, useTheme } from '@photu/ui-native'
import { useRouter } from 'expo-router'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native'
import { useAlbums, useMe } from '../../src/api/hooks'
import type { Album } from '../../src/api/types'

/**
 * The library — every album you are part of. From the prototype's `ScreenLibrary`.
 *
 * Every number here comes from the API. There is no fixture data, which is the point
 * of the walking skeleton.
 */
export default function Library() {
  const t = useTheme()
  const router = useRouter()
  const me = useMe()
  const albums = useAlbums()

  const outOfFreeAlbums = me.data !== undefined && me.data.freeAlbumsUsed >= me.data.freeAlbumsTotal

  return (
    <Screen>
      {/* Header: wordmark left, profile right, matching the prototype. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: t.screenSpace.gutter,
          paddingTop: 8,
          paddingBottom: 12,
        }}
      >
        <Text variant="titleSm">photu</Text>
        {me.data && (
          <Pressable onPress={() => router.push('/(app)/me')}>
            <Avatar name={me.data.displayName} size={32} userId={me.data.id} />
          </Pressable>
        )}
      </View>

      <View style={{ paddingHorizontal: t.screenSpace.gutter, paddingBottom: 16 }}>
        <Text variant="titleXl">Your albums</Text>
        {me.data && (
          <Text color={t.inkMuted} style={{ marginTop: 4 }} variant="meta">
            {me.data.freeAlbumsUsed} of {me.data.freeAlbumsTotal} free albums used
          </Text>
        )}
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            onRefresh={() => {
              void albums.refetch()
              void me.refetch()
            }}
            refreshing={albums.isRefetching}
            tintColor={t.inkMuted}
          />
        }
      >
        {albums.isLoading && (
          <View style={{ paddingVertical: 48, alignItems: 'center' }}>
            <ActivityIndicator color={t.inkMuted} />
          </View>
        )}

        {albums.isError && (
          <View
            style={{
              backgroundColor: t.semantic.errorCardBg,
              borderColor: t.semantic.errorCardLine,
              borderWidth: 1,
              borderRadius: t.radii.md,
              padding: 16,
              gap: 6,
            }}
          >
            <Text color={t.danger} variant="bodySmStrong">
              Could not load your albums
            </Text>
            <Text color={t.inkSoft} variant="caption">
              {albums.error instanceof Error ? albums.error.message : 'Unknown error'}
            </Text>
            <Button kind="outline" onPress={() => void albums.refetch()} size="sm">
              Try again
            </Button>
          </View>
        )}

        {albums.data?.length === 0 && <EmptyLibrary />}

        {albums.data?.map(album => (
          <AlbumRow
            album={album}
            key={album.id}
            onPress={() => router.push(`/(app)/album/${album.id}`)}
          />
        ))}
      </ScrollView>

      {/* FAB. The paywall is server-enforced, so this navigates optimistically and
          the create screen surfaces a 402 if the free slots are gone. */}
      <View style={{ position: 'absolute', right: 20, bottom: 32 }}>
        <Button
          kind="accent"
          leading={<Icon color={t.accentInk} name="plus" size={18} />}
          onPress={() => router.push('/(modals)/create-album')}
          size="lg"
        >
          {outOfFreeAlbums ? 'New album · £1.49' : 'New album'}
        </Button>
      </View>
    </Screen>
  )
}

function EmptyLibrary() {
  const t = useTheme()
  const router = useRouter()
  return (
    <View style={{ paddingVertical: 56, paddingHorizontal: 20, alignItems: 'center', gap: 14 }}>
      <Text align="center" variant="titleSm">
        Your first three albums are on us.
      </Text>
      <Text align="center" color={t.inkSoft} variant="bodyM">
        Create one for the next trip or dinner, and add photos at original quality.
      </Text>
      <Button
        full
        kind="primary"
        leading={<Icon color={t.bg} name="plus" size={18} />}
        onPress={() => router.push('/(modals)/create-album')}
        size="md"
      >
        Create an album
      </Button>
    </View>
  )
}

/** Status chip copy and dot colour, from the prototype's `AlbumRow`. */
function statusFor(album: Album, t: ReturnType<typeof useTheme>) {
  if (album.state !== 'active') {
    return { label: 'Locked · Keepsake', dot: t.inkMuted, tone: 'neutral' as const }
  }
  const days = Math.ceil((new Date(album.windowEndsAt).getTime() - Date.now()) / 86_400_000)
  if (days <= 2) {
    return { label: `Locks in ${Math.max(days, 0)}d`, dot: t.danger, tone: 'danger' as const }
  }
  return { label: `${days} days left`, dot: t.success, tone: 'neutral' as const }
}

function AlbumRow({ album, onPress }: { album: Album; onPress: () => void }) {
  const t = useTheme()
  const status = statusFor(album, t)

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: 14,
        paddingVertical: 12,
        paddingHorizontal: 8,
        borderBottomWidth: 1,
        borderBottomColor: t.line,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {/* Cover art needs a rendition, which needs the media worker. Until an album
          has a processed cover this is a neutral placeholder rather than a fake
          gradient — the prototype's gradients were stand-ins for real photos. */}
      <View
        style={{
          width: 84,
          height: 84,
          borderRadius: t.radii.md,
          backgroundColor: t.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon color={t.inkMuted} name="images" size={22} />
      </View>

      <View style={{ flex: 1, justifyContent: 'center', gap: 6 }}>
        <Text numberOfLines={1} variant="titleRow">
          {album.title}
        </Text>
        <Text color={t.inkMuted} variant="meta">
          {album.memberCount} {album.memberCount === 1 ? 'member' : 'members'} · {album.mediaCount}{' '}
          {album.mediaCount === 1 ? 'photo' : 'photos'}
        </Text>
        <Chip leading={<ChipDot color={status.dot} />} tone={status.tone}>
          {status.label}
        </Chip>
      </View>

      <View style={{ justifyContent: 'center' }}>
        <Icon color={t.inkMuted} name="chevron-right" size={16} />
      </View>
    </Pressable>
  )
}
