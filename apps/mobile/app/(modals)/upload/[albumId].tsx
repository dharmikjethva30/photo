import { Button, Icon, Screen, SectionLabel, Text, useTheme } from '@photu/ui-native'
import { useQueryClient } from '@tanstack/react-query'
import * as ImagePicker from 'expo-image-picker'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { queryKeys } from '../../../src/api/hooks'
import { type PickedAsset, type UploadProgress, uploadBatch } from '../../../src/upload/upload'

/**
 * Upload. From the prototype's `ScreenUpload`.
 *
 * Progress is real: it advances per file as each declare/PUT/complete round trip
 * finishes. The prototype animated a fake percentage, which is exactly the kind of
 * thing that makes a demo look finished and a product feel broken.
 */
export default function UploadScreen() {
  const t = useTheme()
  const router = useRouter()
  const qc = useQueryClient()
  const { albumId } = useLocalSearchParams<{ albumId: string }>()

  const [assets, setAssets] = useState<PickedAsset[]>([])
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [result, setResult] = useState<{ uploaded: number; failed: number } | null>(null)
  const [errors, setErrors] = useState<string[]>([])

  const pick = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      setErrors(['photu needs access to your photos to upload them.'])
      return
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 12,
      // No editing and maximum quality: the product promise is the ORIGINAL file.
      // Any transform here would re-encode before the bytes ever reach us.
      quality: 1,
      exif: true,
    })
    if (picked.canceled) return

    setResult(null)
    setErrors([])
    setAssets(
      picked.assets.map(a => ({
        uri: a.uri,
        fileName: a.fileName ?? null,
        mimeType: a.mimeType ?? null,
        width: a.width,
        height: a.height,
        creationTime: (a as { creationTime?: number }).creationTime ?? null,
        assetId: a.assetId ?? null,
      })),
    )
  }

  const start = async () => {
    if (assets.length === 0) return
    setErrors([])
    const failures: string[] = []

    const out = await uploadBatch(albumId, assets, p => {
      setProgress(p)
      if (p.phase === 'failed' && p.error) failures.push(p.error)
    })

    setResult(out)
    setErrors(failures)

    // The feed and the album's counters both changed.
    void qc.invalidateQueries({ queryKey: queryKeys.album(albumId) })
    void qc.invalidateQueries({ queryKey: ['album', albumId, 'feed'] })
    void qc.invalidateQueries({ queryKey: queryKeys.albums })
  }

  const uploading = progress !== null && result === null
  const done = result !== null

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
        <Text variant="titleLg">Add photos</Text>
        <Pressable accessibilityLabel="Close" hitSlop={12} onPress={() => router.back()}>
          <Icon color={t.ink} name="x" size={20} />
        </Pressable>
      </View>

      <View
        style={{
          backgroundColor: t.accentSoft,
          borderRadius: t.radii.md,
          padding: 14,
          flexDirection: 'row',
          gap: 10,
          alignItems: 'flex-start',
          marginBottom: 20,
        }}
      >
        <Icon color={t.accent} name="sparkle" size={18} />
        <View style={{ flex: 1 }}>
          <Text color={t.accent} variant="bodySmStrong">
            Shared at original resolution
          </Text>
          <Text color={t.inkSoft} variant="metaSm">
            Nothing is compressed. Photos upload straight to storage, not through our servers.
          </Text>
        </View>
      </View>

      {assets.length === 0 && !done && (
        <Button
          full
          kind="primary"
          leading={<Icon color={t.bg} name="images" size={18} />}
          onPress={() => void pick()}
          size="lg"
        >
          Choose from camera roll
        </Button>
      )}

      {assets.length > 0 && (
        <View style={{ gap: 12 }}>
          <SectionLabel>
            In this batch · {assets.length} {assets.length === 1 ? 'photo' : 'photos'}
          </SectionLabel>

          {uploading && progress && (
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
                <Text color={t.inkMuted} variant="sectionLabel">
                  Uploading
                </Text>
                <Text color={t.inkMuted} variant="monoMeta">
                  {progress.index + 1} / {progress.total}
                </Text>
              </View>
              <View
                style={{
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: t.surfaceAlt,
                  overflow: 'hidden',
                }}
              >
                <View
                  style={{
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: t.accent,
                    // Completed files, plus real byte progress within the current one.
                    width: `${Math.round(
                      ((progress.index + (progress.fileProgress ?? 0)) / progress.total) * 100,
                    )}%`,
                  }}
                />
              </View>
              <Text color={t.inkSoft} variant="caption">
                {progress.phase === 'declaring' && 'Preparing…'}
                {progress.phase === 'uploading' && 'Sending original bytes…'}
                {progress.phase === 'completing' && 'Verifying…'}
                {progress.phase === 'done' && 'Uploaded'}
                {progress.phase === 'failed' && 'That one failed — continuing'}
              </Text>
            </View>
          )}

          {done && result && (
            <View
              style={{
                backgroundColor: result.failed > 0 ? t.semantic.errorCardBg : t.surface,
                borderColor: result.failed > 0 ? t.semantic.errorCardLine : t.line,
                borderWidth: 1,
                borderRadius: t.radii.md,
                padding: 16,
                gap: 6,
              }}
            >
              <Text variant="bodySmStrong">
                {result.uploaded} uploaded
                {result.failed > 0 ? `, ${result.failed} failed` : ''}
              </Text>
              <Text color={t.inkSoft} variant="caption">
                {result.failed > 0
                  ? 'Nothing was compressed or lost. Try the failed ones again.'
                  : 'Thumbnails appear once the media worker has processed them.'}
              </Text>
            </View>
          )}

          {errors.length > 0 && (
            <View style={{ gap: 4 }}>
              {errors.slice(0, 3).map(e => (
                <Text color={t.danger} key={e} variant="metaSm">
                  {e}
                </Text>
              ))}
            </View>
          )}

          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {assets.map(a => (
                <View
                  key={a.uri}
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: t.componentRadii.gridTile,
                    backgroundColor: t.surfaceAlt,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon color={t.inkMuted} name="image" size={18} />
                </View>
              ))}
            </View>
          </ScrollView>

          {!done && (
            <Button full kind="accent" loading={uploading} onPress={() => void start()} size="lg">
              Upload {assets.length} at original quality
            </Button>
          )}

          {done && (
            <Button full kind="primary" onPress={() => router.back()} size="lg">
              Done
            </Button>
          )}
        </View>
      )}
    </Screen>
  )
}
