import { Avatar, Button, Icon, Screen, SectionLabel, Text, useTheme } from '@photu/ui-native'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { Pressable, View } from 'react-native'
import { API_BASE_URL } from '../../src/api/client'
import { useMe } from '../../src/api/hooks'
import { clearSession } from '../../src/auth/session'

/**
 * Profile and settings. A subset of the prototype's `ScreenSettings` — the rows
 * without a backing endpoint yet (face reference, allowlist, notifications, export)
 * are deliberately absent rather than present and inert.
 */
export default function Me() {
  const t = useTheme()
  const router = useRouter()
  const qc = useQueryClient()
  const me = useMe()

  const signOut = async () => {
    await clearSession()
    qc.clear()
    router.replace('/(auth)/sign-in')
  }

  return (
    <Screen padded scroll>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 12,
        }}
      >
        <Pressable accessibilityLabel="Back" hitSlop={12} onPress={() => router.back()}>
          <Icon color={t.ink} name="chevron-left" size={20} />
        </Pressable>
        <Text variant="titleLg">Settings</Text>
      </View>

      {me.data && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 20 }}>
          <Avatar name={me.data.displayName} size={56} userId={me.data.id} />
          <View style={{ flex: 1 }}>
            <Text variant="titleSm">{me.data.displayName}</Text>
            <Text color={t.inkMuted} variant="metaSm">
              {me.data.email ?? 'No email on file'}
            </Text>
          </View>
        </View>
      )}

      {/* The free-album meter, from the prototype's Settings screen. Server-supplied:
          the client must never be the authority on this. */}
      {me.data && (
        <View
          style={{
            backgroundColor: t.surface,
            borderColor: t.line,
            borderWidth: 1,
            borderRadius: t.radii.md,
            padding: 16,
            gap: 10,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="bodySmStrong">Free albums</Text>
            <Text color={t.inkMuted} variant="monoMeta">
              {me.data.freeAlbumsUsed} of {me.data.freeAlbumsTotal} used
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {/* Keyed by slot NUMBER, which is the real identity of each segment —
                these map to album_entitlements.free_slot 1..3 server-side. */}
            {Array.from({ length: me.data.freeAlbumsTotal }, (_, i) => i + 1).map(slot => (
              <View
                key={`free-slot-${slot}`}
                style={{
                  flex: 1,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: slot <= me.data.freeAlbumsUsed ? t.accent : t.surfaceAlt,
                }}
              />
            ))}
          </View>
          <Text color={t.inkMuted} variant="metaSm">
            {me.data.freeAlbumsUsed >= me.data.freeAlbumsTotal
              ? 'Your next album is a one-time £1.49 — easy to split with the group.'
              : 'Enforced server-side, so the count is the same on every device.'}
          </Text>
        </View>
      )}

      <View style={{ marginTop: 28, gap: 8 }}>
        <SectionLabel>Privacy</SectionLabel>
        <Pressable
          accessibilityLabel="Face and privacy settings"
          onPress={() => router.push('/(app)/settings/privacy')}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            backgroundColor: t.surface,
            borderColor: t.line,
            borderWidth: 1,
            borderRadius: t.radii.md,
            padding: 16,
          }}
        >
          <Icon color={t.ink} name="face" size={18} />
          <View style={{ flex: 1 }}>
            <Text variant="bodySmStrong">Face &amp; privacy</Text>
            <Text color={t.inkMuted} variant="metaSm">
              Your selfies, consent, and data controls
            </Text>
          </View>
          <Icon color={t.inkMuted} name="chevron-right" size={16} />
        </Pressable>
      </View>

      <View style={{ marginTop: 28, gap: 12 }}>
        <SectionLabel>Developer</SectionLabel>
        <View
          style={{
            backgroundColor: t.surface,
            borderColor: t.line,
            borderWidth: 1,
            borderRadius: t.radii.md,
            padding: 14,
            gap: 6,
          }}
        >
          <Text color={t.inkMuted} variant="metaSm">
            API
          </Text>
          <Text variant="monoMeta">{API_BASE_URL}</Text>
        </View>
        <Button kind="outline" onPress={() => router.push('/_dev/gallery')} size="sm">
          Component gallery
        </Button>
        <Button kind="outline" onPress={() => router.push('/_dev/palettes')} size="sm">
          Palette matrix
        </Button>
      </View>

      <View style={{ marginTop: 28 }}>
        <Button full kind="danger" onPress={() => void signOut()} size="md">
          Sign out
        </Button>
      </View>
    </Screen>
  )
}
