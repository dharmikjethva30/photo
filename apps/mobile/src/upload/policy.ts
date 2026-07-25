/**
 * Pure upload-queue decisions.
 *
 * No native imports, no zustand — just the rules for "may this upload run now" and
 * "what should the queue do next", so they can be unit-tested under plain Node. The
 * network wiring and the store live elsewhere and call in here.
 */
import type { NetworkState } from 'expo-network'

/** The only network distinctions the upload policy cares about. */
export type NetKind = 'wifi' | 'cellular' | 'none' | 'other'

export interface NetSnapshot {
  kind: NetKind
  /** Connected AND the internet is actually reachable, as best the OS can tell. */
  reachable: boolean
}

/**
 * Collapse expo-network's NetworkState into what the policy needs.
 *
 * `isInternetReachable` can be undefined (the OS has not probed yet); treat that as
 * reachable-if-connected rather than blocking uploads on a maybe. Ethernet and VPN are
 * folded into 'wifi' because the meaningful axis is "is this the metered radio" — an
 * unmetered wired or VPN-over-wifi link is, for the user's data plan, wifi-like.
 */
export function snapshotFromNetworkState(s: NetworkState | null | undefined): NetSnapshot {
  if (!s?.isConnected) return { kind: 'none', reachable: false }
  const reachable = s.isInternetReachable !== false
  switch (s.type) {
    case 'WIFI':
    case 'ETHERNET':
    case 'VPN':
      return { kind: 'wifi', reachable }
    case 'CELLULAR':
    case 'WIMAX':
      return { kind: 'cellular', reachable }
    case 'NONE':
      return { kind: 'none', reachable: false }
    default:
      // UNKNOWN / BLUETOOTH / OTHER: connected but we cannot tell if it is metered.
      // Treat it as 'other' and let wifiOnly decide — see canUploadOn.
      return { kind: 'other', reachable }
  }
}

/**
 * May an upload run right now?
 *
 * The rule, in order:
 *   - nothing reachable → no.
 *   - wifiOnly is off → yes on any reachable link.
 *   - wifiOnly is on → yes only on a wifi-like link. 'cellular' is the case this
 *     exists to block. 'other' (an unknown link type) is also blocked under wifiOnly:
 *     the safe default when we cannot prove a link is unmetered is to wait, because
 *     the cost of guessing wrong is the user's data plan.
 */
export function canUploadOn(net: NetSnapshot, wifiOnly: boolean): boolean {
  if (!net.reachable || net.kind === 'none') return false
  if (!wifiOnly) return true
  return net.kind === 'wifi'
}

export type PausedReason = 'offline' | 'waiting_for_wifi' | null

/**
 * Why the queue is not draining, for the UI. Null means it can drain.
 */
export function pausedReason(net: NetSnapshot, wifiOnly: boolean): PausedReason {
  if (!net.reachable || net.kind === 'none') return 'offline'
  if (wifiOnly && net.kind !== 'wifi') return 'waiting_for_wifi'
  return null
}

export type QueueStatus = 'queued' | 'uploading' | 'done' | 'failed'

export interface QueueItem {
  /** clientMediaId — stable across retries, so a retry resumes rather than duplicates. */
  id: string
  albumId: string
  uri: string
  fileName: string | null
  mimeType: string | null
  width?: number
  height?: number
  creationTime?: number | null
  /** Video length in ms; absent for a photo. Carried so the queue can re-declare a
   *  video after an app kill without re-reading the asset. */
  durationMs?: number | null
  status: QueueStatus
  /** 0..1 within this file while uploading. */
  progress: number
  error?: string
  mediaId?: string
  /** When it entered the queue; used only for stable ordering. */
  addedAt: number
}

/**
 * The next item the processor should pick up, or null if there is nothing runnable.
 *
 * Only 'queued' items are runnable — never 'failed' (a failure waits for an explicit
 * retry, which flips it back to 'queued') and never a second 'uploading' item (the
 * processor runs one file at a time; a single large file already parallelises across
 * its parts). Ordered by insertion so uploads land in the order the user picked them.
 */
export function nextRunnable(items: QueueItem[]): QueueItem | null {
  if (items.some(i => i.status === 'uploading')) return null
  const queued = items.filter(i => i.status === 'queued').sort((a, b) => a.addedAt - b.addedAt)
  return queued[0] ?? null
}

export interface QueueCounts {
  queued: number
  uploading: number
  done: number
  failed: number
  /** queued + uploading — the count that means "still working". */
  active: number
}

export function countByStatus(items: QueueItem[]): QueueCounts {
  const c: QueueCounts = { queued: 0, uploading: 0, done: 0, failed: 0, active: 0 }
  for (const i of items) {
    c[i.status]++
  }
  c.active = c.queued + c.uploading
  return c
}
