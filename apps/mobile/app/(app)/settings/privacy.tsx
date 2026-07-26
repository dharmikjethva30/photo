import { Button, Icon, Screen, SectionLabel, Text, useTheme } from '@photu/ui-native'
import * as ImagePicker from 'expo-image-picker'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, Alert, Pressable, View } from 'react-native'
import {
  useDeleteFaceReference,
  useEnrollFaceReference,
  useEraseFaceData,
  useFaceConsent,
  useFaceReferences,
  useGrantFaceConsent,
} from '../../../src/api/hooks'

/**
 * Settings › Privacy — the user's control over their biometric data.
 *
 * Everything the law expects to be reversible is reversible here: revoke consent,
 * delete individual selfies, and the GDPR "delete all my face data" hard-erasure.
 * Erasure is a real DELETE of references, embeddings, tags and crops server-side —
 * not a flag — so it's guarded by an explicit confirm.
 */
export default function PrivacyScreen() {
  const t = useTheme()
  const router = useRouter()

  const consent = useFaceConsent()
  const grant = useGrantFaceConsent()
  const refs = useFaceReferences()
  const enroll = useEnrollFaceReference()
  const del = useDeleteFaceReference()
  const erase = useEraseFaceData()

  const [error, setError] = useState<string | null>(null)

  const granted = consent.data?.granted && !consent.data.needsConsent
  const references = refs.data?.references ?? []

  const addSelfie = async () => {
    setError(null)
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) {
      setError('photu needs camera access to take your selfie.')
      return
    }
    const picked = await ImagePicker.launchCameraAsync({
      cameraType: ImagePicker.CameraType.front,
      quality: 1,
    })
    if (picked.canceled) return
    const a = picked.assets[0]
    if (!a) return
    enroll.mutate(
      { uri: a.uri, mimeType: a.mimeType ?? null, fileName: a.fileName ?? null },
      { onError: e => setError(e instanceof Error ? e.message : 'Could not add your selfie.') },
    )
  }

  const confirmErase = () => {
    Alert.alert(
      'Delete all face data?',
      'This permanently removes your selfies, the face data derived from them, and every tag — on our servers, not just this device. Photos you already confirmed stay in their albums. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: () =>
            erase.mutate(undefined, {
              onError: e =>
                setError(e instanceof Error ? e.message : 'Could not delete your face data.'),
            }),
        },
      ],
    )
  }

  return (
    <Screen padded scroll>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
        <Pressable accessibilityLabel="Back" hitSlop={12} onPress={() => router.back()}>
          <Icon color={t.ink} name="chevron-left" size={20} />
        </Pressable>
        <Text variant="titleLg">Privacy</Text>
      </View>

      <Text color={t.inkSoft} style={{ marginBottom: 20 }} variant="bodyM">
        Face recognition lets photu show you the photos you appear in, and nothing else. It's
        entirely under your control.
      </Text>

      {/* Consent status */}
      <SectionLabel>Face recognition</SectionLabel>
      <View
        style={{
          marginTop: 8,
          marginBottom: 24,
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
        <Icon
          color={granted ? t.success : t.inkMuted}
          name={granted ? 'check' : 'face'}
          size={18}
        />
        <View style={{ flex: 1 }}>
          <Text variant="bodySmStrong">{granted ? 'On' : 'Off'}</Text>
          <Text color={t.inkMuted} variant="metaSm">
            {granted
              ? consent.data?.grantedVersion
                ? `Agreed to ${consent.data.grantedVersion}`
                : 'Agreed'
              : 'Turn it on to be recognised in albums.'}
          </Text>
        </View>
        {!granted && (
          <Button
            kind="primary"
            loading={grant.isPending}
            onPress={() =>
              grant.mutate(undefined, {
                onError: e => setError(e instanceof Error ? e.message : 'Could not enable.'),
              })
            }
            size="sm"
          >
            Enable
          </Button>
        )}
      </View>

      {/* Reference selfies */}
      {granted && (
        <>
          <SectionLabel>Your selfies</SectionLabel>
          <View style={{ marginTop: 8, gap: 8 }}>
            {refs.isLoading && <ActivityIndicator color={t.inkMuted} />}
            {references.map(r => (
              <View
                key={r.id}
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
                {r.processed ? (
                  <Icon color={t.success} name="check" size={18} />
                ) : (
                  <ActivityIndicator color={t.inkMuted} size="small" />
                )}
                <View style={{ flex: 1 }}>
                  <Text variant="bodySmStrong">{r.processed ? 'Ready' : 'Processing…'}</Text>
                  <Text color={t.inkMuted} variant="metaSm">
                    Added {new Date(r.createdAt).toLocaleDateString()}
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel="Delete selfie"
                  disabled={del.isPending}
                  hitSlop={10}
                  onPress={() => del.mutate(r.id)}
                >
                  <Icon color={t.danger} name="x" size={18} />
                </Pressable>
              </View>
            ))}
            {references.length === 0 && !refs.isLoading && (
              <Text color={t.inkMuted} variant="metaSm">
                No selfie yet. Add one so photu can recognise you.
              </Text>
            )}
            <Button
              kind="outline"
              leading={<Icon color={t.ink} name="camera" size={16} />}
              loading={enroll.isPending}
              onPress={() => void addSelfie()}
              size="md"
            >
              Add a selfie
            </Button>
          </View>
        </>
      )}

      {error && (
        <Text color={t.danger} style={{ marginTop: 16 }} variant="caption">
          {error}
        </Text>
      )}

      {/* GDPR erasure */}
      <View style={{ marginTop: 36, gap: 10 }}>
        <SectionLabel>Danger zone</SectionLabel>
        <Text color={t.inkMuted} variant="metaSm">
          Permanently delete every selfie and all the face data derived from it.
        </Text>
        <Button full kind="danger" loading={erase.isPending} onPress={confirmErase} size="md">
          Delete all my face data
        </Button>
        {erase.isSuccess && (
          <Text color={t.success} variant="caption">
            Your face data has been deleted.
          </Text>
        )}
      </View>
    </Screen>
  )
}
