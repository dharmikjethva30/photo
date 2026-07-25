import { Button, Icon, Screen, Text, useTheme } from '@photu/ui-native'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { View } from 'react-native'
import { API_BASE_URL } from '../../src/api/client'
import { useSignIn } from '../../src/api/hooks'

/**
 * Sign in. Copy and layout from the prototype's `ScreenSignIn`.
 *
 * All three providers hit the same endpoint. In a local build the server wires a
 * FAKE verifier that accepts any token and derives a stable identity from it, so a
 * tap here signs you in with no Apple or Google credentials — which is what makes
 * the app testable on an emulator. In production these buttons first obtain a real
 * ID token from the platform SDK.
 */
export default function SignIn() {
  const t = useTheme()
  const router = useRouter()
  const signIn = useSignIn()
  const [error, setError] = useState<string | null>(null)

  const go = (provider: 'apple' | 'google') => {
    setError(null)
    signIn.mutate(
      // A stable per-device identity, so signing in twice returns the same account
      // rather than creating a new one each time.
      { provider, idToken: `${provider}-emulator-user` },
      {
        onSuccess: session => {
          // A brand-new account has a placeholder name, so onboarding asks for the
          // real one. A returning user goes straight to their library.
          router.replace(session.isNewUser ? '/(auth)/name' : '/(app)/library')
        },
        onError: e => setError(e instanceof Error ? e.message : 'Sign-in failed.'),
      },
    )
  }

  return (
    <Screen padded>
      <View style={{ flex: 1, justifyContent: 'center', gap: 28 }}>
        <View style={{ gap: 14 }}>
          <Text variant="display">One album.</Text>
          <Text style={{ marginTop: -18 }} variant="display">
            Everyone's photos.
          </Text>
          <Text color={t.accent} style={{ marginTop: -18, fontStyle: 'italic' }} variant="display">
            Original quality.
          </Text>
          <Text color={t.inkSoft} style={{ maxWidth: 300, marginTop: 10 }} variant="body">
            Time-bounded albums for trips, weddings, and dinners. Three free, then a small one-off
            for each.
          </Text>
        </View>
      </View>

      <View style={{ gap: 10, paddingBottom: 12 }}>
        {error && (
          <View
            style={{
              backgroundColor: t.semantic.errorCardBg,
              borderColor: t.semantic.errorCardLine,
              borderWidth: 1,
              borderRadius: t.radii.md,
              padding: 12,
              gap: 4,
            }}
          >
            <Text color={t.danger} variant="bodySmStrong">
              Could not sign in
            </Text>
            <Text color={t.inkSoft} variant="caption">
              {error}
            </Text>
            <Text color={t.inkMuted} variant="monoMeta">
              {API_BASE_URL}
            </Text>
          </View>
        )}

        <Button
          full
          kind="primary"
          leading={<Icon color={t.bg} name="apple" size={18} />}
          loading={signIn.isPending}
          onPress={() => go('apple')}
          size="lg"
        >
          Continue with Apple
        </Button>
        <Button
          full
          kind="outline"
          leading={<Icon color={t.ink} name="google" size={18} />}
          onPress={() => go('google')}
          size="lg"
        >
          Continue with Google
        </Button>

        <Text align="center" color={t.inkMuted} style={{ marginTop: 8 }} variant="metaSm">
          By continuing you agree to our Terms.
        </Text>
        <Text align="center" color={t.inkMuted} variant="metaSm">
          We never sell photos. Ever.
        </Text>
      </View>
    </Screen>
  )
}
