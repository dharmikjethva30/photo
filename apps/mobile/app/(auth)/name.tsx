import { Button, Icon, Screen, SectionLabel, Text, useTheme } from '@photu/ui-native'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { TextInput, View } from 'react-native'
import { useUpdateMe } from '../../src/api/hooks'

/**
 * Onboarding step 1: the display name. From the prototype's `ScreenName`.
 *
 * Note the prototype labels this "Step 1 of 3" and jumps to "Step 3 of 3" for the
 * face reference — step 2 (the profile photo) does not exist in the design. Left as
 * 1 of 2 here rather than inventing a screen; the gap is recorded in the plan.
 */
export default function NameScreen() {
  const t = useTheme()
  const router = useRouter()
  const update = useUpdateMe()
  const [name, setName] = useState('')

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    update.mutate({ displayName: trimmed }, { onSuccess: () => router.replace('/(app)/library') })
  }

  return (
    <Screen padded>
      <View style={{ paddingTop: 8, gap: 12 }}>
        <SectionLabel>Step 1 of 2 · Your profile</SectionLabel>
        {/* ProgressDots from the prototype: two filled segments. */}
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: t.ink }} />
          <View
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              backgroundColor: t.lineStrong,
              opacity: 0.4,
            }}
          />
        </View>
      </View>

      <View style={{ gap: 8, marginTop: 28 }}>
        <Text variant="titleLg">What should friends call you?</Text>
        <Text color={t.inkSoft} variant="bodyM">
          This is the name that appears next to photos you upload.
        </Text>
      </View>

      <View style={{ marginTop: 28, gap: 8 }}>
        <SectionLabel>Name</SectionLabel>
        <View
          style={{
            backgroundColor: t.surface,
            borderColor: t.line,
            borderWidth: 1,
            borderRadius: t.radii.md,
            paddingHorizontal: 16,
            minHeight: 52,
            justifyContent: 'center',
          }}
        >
          <TextInput
            autoCapitalize="words"
            autoFocus
            onChangeText={setName}
            onSubmitEditing={submit}
            placeholder="Your name"
            placeholderTextColor={t.inkMuted}
            returnKeyType="done"
            style={[t.text.fieldValue, { color: t.ink, paddingVertical: 12 }]}
            value={name}
          />
        </View>
        {update.isError && (
          <Text color={t.danger} variant="caption">
            {update.error instanceof Error ? update.error.message : 'Could not save your name.'}
          </Text>
        )}
      </View>

      <View style={{ flex: 1 }} />

      <Button
        disabled={!name.trim()}
        full
        kind="primary"
        loading={update.isPending}
        onPress={submit}
        size="lg"
        trailing={<Icon color={t.bg} name="arrow-right" size={18} />}
      >
        Continue
      </Button>
    </Screen>
  )
}
