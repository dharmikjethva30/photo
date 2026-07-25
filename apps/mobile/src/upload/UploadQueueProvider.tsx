/**
 * Drives the upload queue.
 *
 * Mounted once at the app root, it is the thing that actually moves bytes: it watches
 * the queue, the live network state, and the Wi-Fi-only setting, and whenever there is
 * a runnable item on an allowed connection it uploads exactly one, then looks again.
 *
 * "Background" here means "keeps going while the app is foregrounded, on any screen" —
 * which is what lets you leave the upload modal and watch progress from the album. True
 * OS-level background upload (NSURLSession / WorkManager, the plan's
 * react-native-background-upload) is a heavier native module and a deliberate later
 * step; an upload paused by the app being killed resumes on next launch via the
 * persisted queue plus server-side resume, which covers the important case.
 */
import { useQueryClient } from '@tanstack/react-query'
import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from 'expo-network'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { queryKeys } from '../api/hooks'
import { canUploadOn, type NetSnapshot, nextRunnable, snapshotFromNetworkState } from './policy'
import { useUploadQueue } from './queue'
import { uploadAsset } from './upload'

const OFFLINE: NetSnapshot = { kind: 'none', reachable: false }

export function UploadQueueProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [net, setNet] = useState<NetSnapshot>(OFFLINE)

  const items = useUploadQueue(s => s.items)
  const wifiOnly = useUploadQueue(s => s.wifiOnly)
  const hydrated = useUploadQueue(s => s.hydrated)

  // Read the queue off disk once, then learn the network and keep it current.
  useEffect(() => {
    void useUploadQueue.getState().hydrate()
    void getNetworkStateAsync().then((s: NetworkState) => setNet(snapshotFromNetworkState(s)))
    const sub = addNetworkStateListener(s => setNet(snapshotFromNetworkState(s)))
    return () => sub.remove()
  }, [])

  // One upload at a time. A ref, not state, because the drain effect must see the
  // in-flight flag synchronously to avoid starting the same item twice.
  const busy = useRef(false)

  // The cancel closure below needs the LATEST net, not the value captured when the
  // upload started, so it reads through a ref that every render keeps current.
  const currentNet = useRef(net)
  currentNet.current = net

  useEffect(() => {
    if (!hydrated || busy.current) return
    if (!canUploadOn(net, wifiOnly)) return

    const item = nextRunnable(items)
    if (!item) return

    busy.current = true
    const q = useUploadQueue.getState()
    q.setStatus(item.id, 'uploading', { progress: 0 })

    uploadAsset(
      item.albumId,
      {
        uri: item.uri,
        fileName: item.fileName,
        mimeType: item.mimeType,
        width: item.width,
        height: item.height,
        creationTime: item.creationTime,
        assetId: item.id,
      },
      fraction => q.setProgress(item.id, fraction),
      // Cancel between parts if the network policy stops allowing this upload — the
      // user toggled Wi-Fi-only, or wifi dropped. The item goes back to 'queued' and
      // resumes when the connection is allowed again, re-sending only what is missing.
      () => !canUploadOn(currentNet.current, useUploadQueue.getState().wifiOnly),
    )
      .then(res => {
        q.setStatus(item.id, 'done', { progress: 1, mediaId: res.mediaId })
        // The feed and the album counters both changed.
        void qc.invalidateQueries({ queryKey: queryKeys.album(item.albumId) })
        void qc.invalidateQueries({ queryKey: ['album', item.albumId, 'feed'] })
        void qc.invalidateQueries({ queryKey: queryKeys.albums })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        // A policy-driven cancel is not a failure: put it back in line rather than
        // making the user hit retry for something the app chose to pause.
        if (message.includes('cancel')) {
          q.setStatus(item.id, 'queued', { progress: 0 })
        } else {
          q.setStatus(item.id, 'failed', { error: message })
        }
      })
      .finally(() => {
        busy.current = false
        // No manual re-trigger needed: every terminal branch above calls setStatus,
        // which changes `items` in the store, which re-runs this effect (items is a
        // dependency) — and it then picks the next runnable item, or stops.
      })
  }, [items, wifiOnly, hydrated, net, qc])

  return <>{children}</>
}
