import type { NetworkState } from 'expo-network'
import { describe, expect, it } from 'vitest'
import {
  canUploadOn,
  countByStatus,
  type NetSnapshot,
  nextRunnable,
  pausedReason,
  type QueueItem,
  snapshotFromNetworkState,
} from './policy'

const net = (kind: NetSnapshot['kind'], reachable = true): NetSnapshot => ({ kind, reachable })

const item = (id: string, status: QueueItem['status'], addedAt: number): QueueItem => ({
  id,
  albumId: 'a',
  uri: `file://${id}`,
  fileName: id,
  mimeType: 'image/jpeg',
  status,
  progress: 0,
  addedAt,
})

describe('snapshotFromNetworkState', () => {
  const state = (over: Partial<NetworkState>): NetworkState =>
    ({ type: 'WIFI', isConnected: true, isInternetReachable: true, ...over }) as NetworkState

  it('maps wifi/ethernet/vpn to the unmetered "wifi" bucket', () => {
    for (const type of ['WIFI', 'ETHERNET', 'VPN'] as const) {
      expect(snapshotFromNetworkState(state({ type: type as NetworkState['type'] })).kind).toBe(
        'wifi',
      )
    }
  })

  it('maps cellular and wimax to "cellular"', () => {
    for (const type of ['CELLULAR', 'WIMAX'] as const) {
      expect(snapshotFromNetworkState(state({ type: type as NetworkState['type'] })).kind).toBe(
        'cellular',
      )
    }
  })

  it('treats a null state or a disconnected state as offline', () => {
    expect(snapshotFromNetworkState(null)).toEqual({ kind: 'none', reachable: false })
    expect(snapshotFromNetworkState(state({ isConnected: false })).reachable).toBe(false)
  })

  it('treats undefined isInternetReachable as reachable-if-connected, not a block', () => {
    // The OS has not probed yet; blocking uploads on a maybe would strand them.
    expect(snapshotFromNetworkState(state({ isInternetReachable: undefined })).reachable).toBe(true)
  })

  it('folds an unknown connected link into "other" for wifiOnly to judge', () => {
    expect(snapshotFromNetworkState(state({ type: 'UNKNOWN' as NetworkState['type'] })).kind).toBe(
      'other',
    )
  })
})

describe('canUploadOn', () => {
  it('never uploads with nothing reachable', () => {
    expect(canUploadOn(net('none', false), false)).toBe(false)
    expect(canUploadOn(net('wifi', false), false)).toBe(false)
  })

  it('uploads on anything reachable when wifiOnly is off', () => {
    expect(canUploadOn(net('cellular'), false)).toBe(true)
    expect(canUploadOn(net('other'), false)).toBe(true)
    expect(canUploadOn(net('wifi'), false)).toBe(true)
  })

  it('blocks cellular and unknown links when wifiOnly is on', () => {
    expect(canUploadOn(net('cellular'), true)).toBe(false)
    // The safe default: an unproven link is not treated as unmetered.
    expect(canUploadOn(net('other'), true)).toBe(false)
    expect(canUploadOn(net('wifi'), true)).toBe(true)
  })
})

describe('pausedReason', () => {
  it('is offline when nothing is reachable', () => {
    expect(pausedReason(net('none', false), true)).toBe('offline')
  })
  it('is waiting_for_wifi on cellular under wifiOnly', () => {
    expect(pausedReason(net('cellular'), true)).toBe('waiting_for_wifi')
  })
  it('is null (drainable) on wifi under wifiOnly', () => {
    expect(pausedReason(net('wifi'), true)).toBeNull()
  })
  it('is null on cellular when wifiOnly is off', () => {
    expect(pausedReason(net('cellular'), false)).toBeNull()
  })
})

describe('nextRunnable', () => {
  it('returns the earliest queued item', () => {
    const items = [item('b', 'queued', 2), item('a', 'queued', 1), item('c', 'queued', 3)]
    expect(nextRunnable(items)?.id).toBe('a')
  })

  it('returns nothing while an item is already uploading (one file at a time)', () => {
    const items = [item('a', 'uploading', 1), item('b', 'queued', 2)]
    expect(nextRunnable(items)).toBeNull()
  })

  it('never auto-picks a failed item — it waits for an explicit retry', () => {
    const items = [item('a', 'failed', 1), item('b', 'done', 2)]
    expect(nextRunnable(items)).toBeNull()
  })
})

describe('countByStatus', () => {
  it('counts each status and sums active as queued + uploading', () => {
    const items = [
      item('a', 'queued', 1),
      item('b', 'uploading', 2),
      item('c', 'done', 3),
      item('d', 'failed', 4),
      item('e', 'queued', 5),
    ]
    expect(countByStatus(items)).toEqual({
      queued: 2,
      uploading: 1,
      done: 1,
      failed: 1,
      active: 3,
    })
  })
})
