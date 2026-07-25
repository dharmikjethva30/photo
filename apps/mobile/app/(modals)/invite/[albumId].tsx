import { Button, Icon, Screen, SectionLabel, Text, useTheme } from '@photu/ui-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect } from 'react'
import { ActivityIndicator, Pressable, Share, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import { useAlbumInvites, useCreateInvite, useRevokeInvite } from '../../../src/api/hooks'
import type { Invite } from '../../../src/api/types'

/**
 * Invite people to an album. From the prototype's `ScreenInvite`.
 *
 * A reusable link is the default and, for most albums, the only invite anyone needs —
 * so this screen mints one automatically the first time it opens if none exists, and
 * leads with sharing it rather than making the user think about invite settings.
 */
export default function InviteScreen() {
  const t = useTheme()
  const router = useRouter()
  const { albumId } = useLocalSearchParams<{ albumId: string }>()

  const invites = useAlbumInvites(albumId)
  const create = useCreateInvite(albumId)
  const revoke = useRevokeInvite(albumId)

  // The primary invite is the newest reusable link. Auto-mint one on first open so the
  // common case — "give me a link to share" — needs zero taps.
  const primary = invites.data?.find(i => i.channel === 'link' || i.channel === 'qr')

  useEffect(() => {
    if (invites.isSuccess && !primary && !create.isPending) {
      create.mutate({ channel: 'link' })
    }
  }, [invites.isSuccess, primary, create])

  const share = async (invite: Invite) => {
    try {
      await Share.share({
        // Both fields: iOS prefers `url`, Android folds it into `message`. The message
        // reads naturally in a chat while still carrying the tappable link.
        message: `Join my photu album: ${invite.url}`,
        url: invite.url,
      })
    } catch {
      // The user dismissed the share sheet. Not an error.
    }
  }

  return (
    <Screen padded scroll>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: 12,
        }}
      >
        <Text variant="titleLg">Invite people</Text>
        <Pressable accessibilityLabel="Close" hitSlop={12} onPress={() => router.back()}>
          <Icon color={t.ink} name="x" size={20} />
        </Pressable>
      </View>

      {(invites.isLoading || (create.isPending && !primary)) && (
        <View style={{ paddingVertical: 48, alignItems: 'center' }}>
          <ActivityIndicator color={t.inkMuted} />
        </View>
      )}

      {invites.isError && (
        <ErrorCard message="Could not load invites." onRetry={() => void invites.refetch()} />
      )}

      {primary && (
        <View style={{ gap: 20 }}>
          {/* The QR: someone across the table scans it, no typing. Rendered from the
              same URL the share sheet sends, so the two can never drift. */}
          <View style={{ alignItems: 'center', gap: 16, paddingTop: 8 }}>
            <View
              style={{
                padding: 16,
                backgroundColor: '#fff',
                borderRadius: t.radii.lg,
                borderWidth: 1,
                borderColor: t.line,
              }}
            >
              <QRCode backgroundColor="#fff" color="#000" size={200} value={primary.url} />
            </View>
            <Text align="center" color={t.inkSoft} variant="metaSm">
              Scan to join, or share the link
            </Text>
          </View>

          <Button
            full
            kind="accent"
            leading={<Icon color={t.accentInk} name="share" size={18} />}
            onPress={() => void share(primary)}
            size="lg"
          >
            Share invite link
          </Button>

          {/* The raw link, selectable, for anyone who wants to copy it by hand. */}
          <View
            style={{
              backgroundColor: t.surface,
              borderColor: t.line,
              borderWidth: 1,
              borderRadius: t.radii.md,
              padding: 14,
            }}
          >
            <Text color={t.inkSoft} variant="monoMeta">
              {primary.url}
            </Text>
          </View>
        </View>
      )}

      {/* Manage: every live invite, with the ability to revoke. Most albums have one,
          but a user who generated several can turn any of them off here. */}
      {invites.data && invites.data.length > 0 && (
        <View style={{ gap: 10, marginTop: 28 }}>
          <SectionLabel>Active links</SectionLabel>
          {invites.data.map(inv => (
            <View
              key={inv.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                backgroundColor: t.surface,
                borderColor: t.line,
                borderWidth: 1,
                borderRadius: t.radii.md,
                padding: 14,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text variant="monoMeta">{inv.code}</Text>
                <Text color={t.inkSoft} variant="metaSm">
                  {inv.useCount} {inv.useCount === 1 ? 'join' : 'joins'}
                  {inv.maxUses != null ? ` of ${inv.maxUses}` : ''}
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Revoke invite"
                disabled={revoke.isPending}
                hitSlop={8}
                onPress={() => revoke.mutate(inv.id)}
              >
                <Text color={t.danger} variant="metaSm">
                  Revoke
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </Screen>
  )
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useTheme()
  return (
    <View
      style={{
        backgroundColor: t.semantic.errorCardBg,
        borderColor: t.semantic.errorCardLine,
        borderWidth: 1,
        borderRadius: t.radii.md,
        padding: 16,
        gap: 8,
      }}
    >
      <Text color={t.danger} variant="bodySmStrong">
        {message}
      </Text>
      <Button kind="outline" onPress={onRetry} size="sm">
        Try again
      </Button>
    </View>
  )
}
