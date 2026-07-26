import { Button, Icon, Screen, SectionLabel, Text, useTheme } from '@photu/ui-native'
import * as ImagePicker from 'expo-image-picker'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, Pressable, View } from 'react-native'
import {
  useEnrollFaceReference,
  useFaceConsent,
  useFaceReferences,
  useGrantFaceConsent,
} from '../../src/api/hooks'

/**
 * Onboarding step 2 of 2: the face reference. From the prototype's "Step 3 of 3"
 * face screen.
 *
 * This is the most legally-loaded screen in onboarding. Face embeddings are GDPR
 * Art. 9 / BIPA biometric data, so the flow is strictly: show what it's for and
 * get EXPLICIT consent FIRST, and only then let the user add a selfie. Consent is
 * versioned server-side; the enrol controls stay disabled until it's granted.
 *
 * It is entirely skippable — a face-privacy album still works without a reference,
 * you simply appear in fewer photos until you're tagged. Never a dead end.
 */
export default function FaceReferenceScreen() {
  const t = useTheme()
  const router = useRouter()

  const consent = useFaceConsent()
  const grant = useGrantFaceConsent()
  const refs = useFaceReferences()
  const enroll = useEnrollFaceReference()

  const [error, setError] = useState<string | null>(null)

  const granted = consent.data?.granted && !consent.data.needsConsent
  const references = refs.data?.references ?? []
  const hasReference = references.length > 0
  const processing = hasReference && references.some(r => !r.processed)

  const done = () => router.replace('/(app)/library')

  const addSelfie = async (fromCamera: boolean) => {
    setError(null)
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      setError(
        fromCamera
          ? 'photu needs camera access to take your selfie.'
          : 'photu needs photo access to pick a selfie.',
      )
      return
    }
    const picked = fromCamera
      ? await ImagePicker.launchCameraAsync({
          cameraType: ImagePicker.CameraType.front,
          quality: 1,
        })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 })
    if (picked.canceled) return
    const a = picked.assets[0]
    if (!a) return
    enroll.mutate(
      { uri: a.uri, mimeType: a.mimeType ?? null, fileName: a.fileName ?? null },
      { onError: e => setError(e instanceof Error ? e.message : 'Could not add your selfie.') },
    )
  }

  return (
    <Screen padded scroll>
      <View style={{ paddingTop: 8, gap: 12 }}>
        <SectionLabel>Step 2 of 2 · Face privacy</SectionLabel>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: t.ink }} />
          <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: t.ink }} />
        </View>
      </View>

      <View style={{ gap: 8, marginTop: 28 }}>
        <Text variant="titleLg">Only see photos you're in</Text>
        <Text color={t.inkSoft} variant="bodyM">
          Add a selfie and photu can privately recognise you in a group album, so your feed shows
          the photos you actually appear in. Your call, always — you confirm every match before
          anyone can see you in a photo.
        </Text>
      </View>

      {/* The consent card. Explicit, separate, versioned — a ToS checkbox is not
          enough for biometric data. */}
      <View
        style={{
          marginTop: 24,
          backgroundColor: t.surface,
          borderColor: granted ? t.success : t.line,
          borderWidth: 1,
          borderRadius: t.radii.md,
          padding: 16,
          gap: 12,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon
            color={granted ? t.success : t.accent}
            name={granted ? 'check' : 'face'}
            size={18}
          />
          <Text variant="bodyStrong">
            {granted ? 'Face recognition is on' : 'Turn on face recognition'}
          </Text>
        </View>
        <Text color={t.inkMuted} variant="metaSm">
          Your selfie and the face data derived from it are stored separately, used only to match
          you in albums you join, and never shared. You can delete all of it any time in Settings ›
          Privacy.
        </Text>
        {!granted && (
          <Button
            full
            kind="primary"
            loading={grant.isPending}
            onPress={() => {
              setError(null)
              grant.mutate(undefined, {
                onError: e =>
                  setError(e instanceof Error ? e.message : 'Could not enable face recognition.'),
              })
            }}
            size="md"
          >
            I agree — enable
          </Button>
        )}
      </View>

      {/* Selfie enrolment, gated on consent. */}
      {granted && (
        <View style={{ marginTop: 24, gap: 12 }}>
          <SectionLabel>Your selfie</SectionLabel>
          {hasReference ? (
            <View
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
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: t.surfaceAlt,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {processing ? (
                  <ActivityIndicator color={t.inkMuted} size="small" />
                ) : (
                  <Icon color={t.success} name="check" size={20} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="bodySmStrong">
                  {processing ? 'Setting up your face…' : "You're all set"}
                </Text>
                <Text color={t.inkMuted} variant="metaSm">
                  {processing
                    ? 'This takes a few seconds.'
                    : 'photu can now recognise you in albums you join.'}
                </Text>
              </View>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <SelfieButton
                icon="camera"
                label="Take selfie"
                onPress={() => void addSelfie(true)}
              />
              <SelfieButton
                icon="image"
                label="Choose photo"
                onPress={() => void addSelfie(false)}
              />
            </View>
          )}
          {enroll.isPending && (
            <Text color={t.inkMuted} variant="metaSm">
              Uploading your selfie…
            </Text>
          )}
        </View>
      )}

      {error && (
        <Text color={t.danger} style={{ marginTop: 16 }} variant="caption">
          {error}
        </Text>
      )}

      <View style={{ height: 32 }} />

      <View style={{ gap: 10 }}>
        <Button
          disabled={!granted}
          full
          kind="primary"
          onPress={done}
          size="lg"
          trailing={<Icon color={granted ? t.bg : t.inkMuted} name="arrow-right" size={18} />}
        >
          {hasReference ? 'Done' : 'Continue'}
        </Button>
        <Button full kind="ghost" onPress={done} size="md">
          Skip for now
        </Button>
      </View>
    </Screen>
  )
}

function SelfieButton({
  icon,
  label,
  onPress,
}: {
  icon: 'camera' | 'image'
  label: string
  onPress: () => void
}) {
  const t = useTheme()
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        alignItems: 'center',
        gap: 8,
        paddingVertical: 20,
        borderRadius: t.radii.md,
        borderWidth: 1,
        borderColor: t.line,
        backgroundColor: t.surface,
      }}
    >
      <Icon color={t.ink} name={icon} size={22} />
      <Text variant="label">{label}</Text>
    </Pressable>
  )
}
