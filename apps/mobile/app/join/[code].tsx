import { Button, Icon, Screen, Text, useTheme } from '@photu/ui-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ActivityIndicator, View } from 'react-native'
import { useAcceptInvite, useInvitePreview } from '../../src/api/hooks'
import { useIsSignedIn } from '../../src/auth/session'

/**
 * The join landing. Reached by following a shared invite link (photu.app/a/<code>,
 * mapped to this route in +native-intent.ts) or a QR scan.
 *
 * It lives OUTSIDE the (app) group on purpose: a recipient may not be signed in yet,
 * and the entry-point redirect that sends signed-out users to sign-in only runs at the
 * index route, not here. So the preview renders for anyone, and joining is what
 * requires a session.
 */
export default function JoinScreen() {
  const t = useTheme()
  const router = useRouter()
  const { code } = useLocalSearchParams<{ code: string }>()
  const signedIn = useIsSignedIn()

  const preview = useInvitePreview((code ?? '').toUpperCase())
  const accept = useAcceptInvite()

  const join = () => {
    accept.mutate(code, {
      onSuccess: album => {
        // replace, not push: the join screen should not sit in the back stack behind
        // the album the user just joined.
        router.replace(`/(app)/album/${album.id}`)
      },
    })
  }

  return (
    <Screen padded>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 }}>
        {preview.isLoading && <ActivityIndicator color={t.inkMuted} />}

        {/* A 404 (unknown code) or any load failure lands here — the link is simply not
            one we recognise. */}
        {preview.isError && (
          <Message
            body="This invite link is not valid. Ask whoever shared it for a new one."
            icon="link"
            title="Invalid invite"
          />
        )}

        {preview.data && !preview.data.valid && (
          <Message
            body={invalidCopy(preview.data.invalidReason)}
            icon="clock"
            title="This invite is no longer active"
          />
        )}

        {preview.data?.valid && (
          <View style={{ alignItems: 'center', gap: 12, width: '100%' }}>
            <View
              style={{
                width: 96,
                height: 96,
                borderRadius: t.radii.lg,
                backgroundColor: t.surfaceAlt,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon color={t.inkMuted} name="images" size={32} />
            </View>
            <Text align="center" variant="titleLg">
              {preview.data.albumTitle}
            </Text>
            <Text align="center" color={t.inkSoft} variant="body">
              You've been invited to add and see photos in this album.
            </Text>

            {accept.isError && (
              <Text align="center" color={t.danger} variant="metaSm">
                {acceptErrorCopy(accept.error)}
              </Text>
            )}

            {signedIn ? (
              <Button full kind="accent" loading={accept.isPending} onPress={join} size="lg">
                Join album
              </Button>
            ) : (
              // A signed-out recipient signs in first; the invite code survives in the
              // URL, so returning to this screen after sign-in resumes the join.
              <Button full kind="accent" onPress={() => router.push('/(auth)/sign-in')} size="lg">
                Sign in to join
              </Button>
            )}
          </View>
        )}
      </View>
    </Screen>
  )
}

function Message({ title, body, icon }: { title: string; body: string; icon: 'link' | 'clock' }) {
  const t = useTheme()
  return (
    <View style={{ alignItems: 'center', gap: 10, paddingHorizontal: 24 }}>
      <Icon color={t.inkMuted} name={icon} size={28} />
      <Text align="center" variant="titleSm">
        {title}
      </Text>
      <Text align="center" color={t.inkSoft} variant="body">
        {body}
      </Text>
    </View>
  )
}

function invalidCopy(reason?: string): string {
  switch (reason) {
    case 'expired':
      return 'This invite link has expired.'
    case 'full':
      return 'This invite link has reached its limit of joins.'
    case 'revoked':
      return 'This invite link was turned off by the album owner.'
    default:
      return 'This invite link can no longer be used.'
  }
}

function acceptErrorCopy(err: unknown): string {
  // The server distinguishes a spent/revoked invite (409, type invite_unusable) from a
  // member-cap hit; both are surfaced with copy the recipient can act on.
  const message = err instanceof Error ? err.message : ''
  if (message.includes('member limit')) return 'This album is full.'
  return 'This invite can no longer be used. Ask for a new link.'
}
