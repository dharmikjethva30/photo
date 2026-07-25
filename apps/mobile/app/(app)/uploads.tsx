import { Button, Icon, Screen, SectionLabel, Text, useTheme } from '@photu/ui-native'
import { useNetworkState } from 'expo-network'
import { useRouter } from 'expo-router'
import { Pressable, View } from 'react-native'
import {
  countByStatus,
  pausedReason,
  type QueueItem,
  snapshotFromNetworkState,
} from '../../src/upload/policy'
import { useUploadQueue } from '../../src/upload/queue'

/**
 * The upload queue.
 *
 * Everything here reads the live queue store, so it reflects uploads started from any
 * album and keeps updating whether or not this screen is open. There is no fake
 * progress: each bar is the real byte fraction the processor reports.
 */
export default function UploadsScreen() {
  const t = useTheme()
  const router = useRouter()

  const items = useUploadQueue(s => s.items)
  const wifiOnly = useUploadQueue(s => s.wifiOnly)
  const setWifiOnly = useUploadQueue(s => s.setWifiOnly)
  const retry = useUploadQueue(s => s.retry)
  const retryAllFailed = useUploadQueue(s => s.retryAllFailed)
  const remove = useUploadQueue(s => s.remove)
  const clearFinished = useUploadQueue(s => s.clearFinished)

  const counts = countByStatus(items)
  const net = snapshotFromNetworkState(useNetworkState())
  const paused = counts.active > 0 ? pausedReason(net, wifiOnly) : null

  // Active first (queued + uploading), then failed, then done — most-actionable on top.
  const order: Record<QueueItem['status'], number> = {
    uploading: 0,
    queued: 1,
    failed: 2,
    done: 3,
  }
  const sorted = [...items].sort(
    (a, b) => order[a.status] - order[b.status] || a.addedAt - b.addedAt,
  )

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
        <Text variant="titleLg">Uploads</Text>
        <Pressable accessibilityLabel="Close" hitSlop={12} onPress={() => router.back()}>
          <Icon color={t.ink} name="x" size={20} />
        </Pressable>
      </View>

      {/* Wi-Fi-only control. Default on, because spending someone's data plan on a
          400 MB video without asking is the kind of thing that gets an app deleted. */}
      <Pressable
        accessibilityLabel={wifiOnly ? 'Wi-Fi only, on' : 'Wi-Fi only, off'}
        accessibilityRole="switch"
        accessibilityState={{ checked: wifiOnly }}
        onPress={() => setWifiOnly(!wifiOnly)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: t.surface,
          borderColor: t.line,
          borderWidth: 1,
          borderRadius: t.radii.md,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', flex: 1 }}>
          <Icon color={t.inkSoft} name="upload" size={18} />
          <View style={{ flex: 1 }}>
            <Text variant="bodySmStrong">Upload on Wi-Fi only</Text>
            <Text color={t.inkSoft} variant="metaSm">
              {wifiOnly ? 'Cellular uploads are paused' : 'Uploads use any connection'}
            </Text>
          </View>
        </View>
        <View
          style={{
            width: 44,
            height: 26,
            borderRadius: 13,
            padding: 3,
            backgroundColor: wifiOnly ? t.accent : t.surfaceAlt,
            alignItems: wifiOnly ? 'flex-end' : 'flex-start',
          }}
        >
          <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: t.bg }} />
        </View>
      </Pressable>

      {paused && (
        <View
          style={{
            backgroundColor: t.accentSoft,
            borderRadius: t.radii.md,
            padding: 14,
            flexDirection: 'row',
            gap: 10,
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <Icon color={t.accent} name={paused === 'offline' ? 'pause' : 'clock'} size={18} />
          <Text color={t.accent} variant="metaSm" style={{ flex: 1 }}>
            {paused === 'offline'
              ? `Waiting for a connection — ${counts.active} to upload`
              : `Waiting for Wi-Fi — ${counts.active} to upload. Turn off Wi-Fi-only above to use cellular.`}
          </Text>
        </View>
      )}

      {items.length === 0 && (
        <View style={{ paddingVertical: 48, alignItems: 'center', gap: 8 }}>
          <Icon color={t.inkMuted} name="images" size={28} />
          <Text color={t.inkSoft} variant="body">
            Nothing to upload
          </Text>
          <Text color={t.inkMuted} variant="metaSm">
            Photos you add appear here until they finish.
          </Text>
        </View>
      )}

      {items.length > 0 && (
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <SectionLabel>
              {counts.active > 0
                ? `${counts.active} in progress`
                : counts.failed > 0
                  ? `${counts.failed} failed`
                  : 'All done'}
            </SectionLabel>
            {counts.done > 0 && (
              <Pressable hitSlop={8} onPress={clearFinished}>
                <Text color={t.inkSoft} variant="metaSm">
                  Clear finished
                </Text>
              </Pressable>
            )}
          </View>

          {counts.failed > 1 && (
            <Button full kind="secondary" onPress={retryAllFailed} size="md">
              Retry all failed ({counts.failed})
            </Button>
          )}

          {sorted.map(item => (
            <UploadRow
              key={item.id}
              item={item}
              onRemove={() => remove(item.id)}
              onRetry={() => retry(item.id)}
            />
          ))}
        </View>
      )}
    </Screen>
  )
}

function UploadRow({
  item,
  onRetry,
  onRemove,
}: {
  item: QueueItem
  onRetry: () => void
  onRemove: () => void
}) {
  const t = useTheme()
  const failed = item.status === 'failed'
  const done = item.status === 'done'

  return (
    <View
      style={{
        backgroundColor: failed ? t.semantic.errorCardBg : t.surface,
        borderColor: failed ? t.semantic.errorCardLine : t.line,
        borderWidth: 1,
        borderRadius: t.radii.md,
        padding: 14,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: t.componentRadii.gridTile,
            backgroundColor: t.surfaceAlt,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon
            color={done ? t.accent : failed ? t.danger : t.inkMuted}
            name={done ? 'check' : 'image'}
            size={18}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} variant="bodySmStrong">
            {item.fileName ?? 'Photo'}
          </Text>
          <Text color={t.inkSoft} variant="metaSm">
            {item.status === 'uploading' && `Uploading · ${Math.round(item.progress * 100)}%`}
            {item.status === 'queued' && 'Waiting'}
            {item.status === 'done' && 'Uploaded'}
            {item.status === 'failed' && (item.error ?? 'Failed')}
          </Text>
        </View>
        {failed && (
          <Pressable accessibilityLabel="Retry" hitSlop={8} onPress={onRetry}>
            <Icon color={t.accent} name="upload" size={18} />
          </Pressable>
        )}
        {(failed || done) && (
          <Pressable accessibilityLabel="Remove" hitSlop={8} onPress={onRemove}>
            <Icon color={t.inkMuted} name="x" size={16} />
          </Pressable>
        )}
      </View>

      {(item.status === 'uploading' || item.status === 'queued') && (
        <View
          style={{ height: 6, borderRadius: 3, backgroundColor: t.surfaceAlt, overflow: 'hidden' }}
        >
          <View
            style={{
              height: 6,
              borderRadius: 3,
              backgroundColor: t.accent,
              width: `${Math.max(3, Math.round(item.progress * 100))}%`,
            }}
          />
        </View>
      )}
    </View>
  )
}
