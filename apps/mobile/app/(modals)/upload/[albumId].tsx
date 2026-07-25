import { Button, Icon, Screen, SectionLabel, Text, useTheme } from '@photu/ui-native'
import * as ImagePicker from 'expo-image-picker'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useUploadQueue } from '../../../src/upload/queue'
import type { PickedAsset } from '../../../src/upload/upload'

/**
 * Add photos. From the prototype's `ScreenUpload`.
 *
 * This screen no longer uploads — it ENQUEUES. The picked assets go onto the global
 * upload queue and the processor drains them, so an upload of a large video keeps
 * going after this modal closes and survives an app kill (M2.2/M2.3). The modal's only
 * job is: pick, hand off, and send the user to the queue to watch.
 */
export default function UploadScreen() {
  const t = useTheme()
  const router = useRouter()
  const enqueue = useUploadQueue(s => s.enqueue)
  const { albumId } = useLocalSearchParams<{ albumId: string }>()

  const [assets, setAssets] = useState<PickedAsset[]>([])
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

  const start = () => {
    if (assets.length === 0) return
    enqueue(
      assets.map(a => ({
        // The clientMediaId (also the queue key and the idempotency key): prefer the
        // OS asset id so a re-pick resumes rather than duplicates; fall back to
        // filename+size, stable within a session. Mirrors uploadAsset's own logic.
        id: a.assetId ?? `${a.fileName ?? 'photo'}-${a.uri}`,
        albumId,
        uri: a.uri,
        fileName: a.fileName ?? null,
        mimeType: a.mimeType ?? null,
        width: a.width,
        height: a.height,
        creationTime: a.creationTime,
      })),
    )
    // Hand off to the queue screen. dismissAll first so we do not stack the queue on
    // top of this modal — closing it should land back on the album, not here.
    router.dismissAll()
    router.push('/uploads')
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

      {assets.length === 0 && (
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

      {errors.length > 0 && (
        <View style={{ gap: 4, marginBottom: 12 }}>
          {errors.slice(0, 3).map(e => (
            <Text color={t.danger} key={e} variant="metaSm">
              {e}
            </Text>
          ))}
        </View>
      )}

      {assets.length > 0 && (
        <View style={{ gap: 12 }}>
          <SectionLabel>
            In this batch · {assets.length} {assets.length === 1 ? 'photo' : 'photos'}
          </SectionLabel>

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

          <Button full kind="accent" onPress={start} size="lg">
            Upload {assets.length} at original quality
          </Button>
          <Text color={t.inkSoft} variant="metaSm" style={{ textAlign: 'center' }}>
            You can leave this screen — uploads keep going.
          </Text>
        </View>
      )}
    </Screen>
  )
}
