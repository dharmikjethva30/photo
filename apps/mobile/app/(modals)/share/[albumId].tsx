import { Avatar, Button, Icon, Screen, SectionLabel, Text, useTheme } from '@photu/ui-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Pressable, ScrollView, View } from 'react-native'
import {
  useAlbumGrants,
  useAlbumMembers,
  useGrantBulk,
  useGrantSingle,
  useMe,
  useRevokeGrant,
} from '../../../src/api/hooks'
import type { Grant } from '../../../src/api/types'

/**
 * "Share photos of you" — the allowlist that overrides face-privacy.
 *
 * Two scopes, matching the API: this one photo (single), or every photo you appear
 * in, now and in future (bulk). Only a person IN a photo can share it — this screen
 * is only ever reached from a photo the viewer appears in, and the server enforces
 * the same rule regardless.
 */
export default function ShareScreen() {
  const t = useTheme()
  const router = useRouter()
  const { albumId, photoId } = useLocalSearchParams<{ albumId: string; photoId?: string }>()

  const me = useMe()
  const members = useAlbumMembers(albumId)
  const grants = useAlbumGrants(albumId)

  const grantSingle = useGrantSingle(albumId)
  const grantBulk = useGrantBulk(albumId)
  const revoke = useRevokeGrant(albumId)

  // Everyone but me — you don't share photos of yourself with yourself.
  const others = (members.data ?? []).filter(m => m.userId !== me.data?.id)
  const allGrants = grants.data?.grants ?? []

  const singleGrantFor = (userId: string): Grant | undefined =>
    photoId
      ? allGrants.find(
          g => g.scope === 'single_media' && g.mediaId === photoId && g.granteeUserId === userId,
        )
      : undefined
  const bulkGrantFor = (userId: string): Grant | undefined =>
    allGrants.find(g => g.scope === 'all_media_of_grantor' && g.granteeUserId === userId)

  const busy = grantSingle.isPending || grantBulk.isPending || revoke.isPending

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
        <Text variant="titleLg">Share photos of you</Text>
        <Button kind="ghost" onPress={() => router.back()} size="sm">
          Done
        </Button>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {others.length === 0 && (
          <Text color={t.inkMuted} style={{ paddingVertical: 32 }} variant="bodyM">
            No one else is in this album yet. Invite people first, then you can share.
          </Text>
        )}

        {photoId && others.length > 0 && (
          <View style={{ gap: 8, marginBottom: 24 }}>
            <SectionLabel>This photo</SectionLabel>
            {others.map(m => {
              const g = singleGrantFor(m.userId)
              return (
                <ShareRow
                  busy={busy}
                  granted={Boolean(g)}
                  key={`single-${m.userId}`}
                  name={m.displayName}
                  onToggle={() => {
                    if (g) revoke.mutate(g.grantId)
                    else grantSingle.mutate({ mediaId: photoId, granteeUserId: m.userId })
                  }}
                  userId={m.userId}
                />
              )
            })}
          </View>
        )}

        {others.length > 0 && (
          <View style={{ gap: 8 }}>
            <SectionLabel>Every photo of you</SectionLabel>
            <Text color={t.inkMuted} style={{ marginBottom: 4 }} variant="metaSm">
              Includes photos added later. They'll see every photo you're confirmed in.
            </Text>
            {others.map(m => {
              const g = bulkGrantFor(m.userId)
              return (
                <ShareRow
                  busy={busy}
                  granted={Boolean(g)}
                  key={`bulk-${m.userId}`}
                  name={m.displayName}
                  onToggle={() => {
                    if (g) revoke.mutate(g.grantId)
                    else grantBulk.mutate(m.userId)
                  }}
                  userId={m.userId}
                />
              )
            })}
          </View>
        )}
      </ScrollView>
    </Screen>
  )
}

function ShareRow({
  name,
  userId,
  granted,
  busy,
  onToggle,
}: {
  name: string
  userId: string
  granted: boolean
  busy: boolean
  onToggle: () => void
}) {
  const t = useTheme()
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 8,
      }}
    >
      <Avatar name={name} size={40} userId={userId} />
      <Text style={{ flex: 1 }} variant="bodySmStrong">
        {name}
      </Text>
      <Pressable
        accessibilityLabel={granted ? `Stop sharing with ${name}` : `Share with ${name}`}
        disabled={busy}
        onPress={onToggle}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          height: 36,
          paddingHorizontal: 14,
          borderRadius: 18,
          backgroundColor: granted ? t.accentSoft : t.surface,
          borderWidth: 1,
          borderColor: granted ? t.accent : t.line,
          opacity: busy ? 0.6 : 1,
        }}
      >
        {granted && <Icon color={t.accent} name="check" size={14} />}
        <Text color={granted ? t.accent : t.ink} variant="label">
          {granted ? 'Shared' : 'Share'}
        </Text>
      </Pressable>
    </View>
  )
}
