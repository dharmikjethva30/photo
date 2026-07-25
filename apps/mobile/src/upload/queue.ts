/**
 * The upload queue: a zustand store, persisted to a JSON file.
 *
 * Why this exists as a global store rather than living in the upload modal: an upload
 * of a 400 MB video outlives the modal, and the spec's whole upload story is "add
 * photos, leave the screen, they keep going, retry what failed". The queue is the
 * single source of truth the modal, the album feed, and the uploads screen all read.
 *
 * Persistence is to expo-file-system rather than a new native dependency (MMKV). The
 * queue holds only small facts per item — {clientMediaId, albumId, localUri} — because
 * resume itself is server-driven: on relaunch the processor re-declares with the same
 * clientMediaId and the server says which parts are missing (docs/adr/0003). So a queue
 * that survives an app kill plus a server that knows what landed equals resume across a
 * kill, with nothing large to persist.
 *
 * Persistence is best-effort: a failed read or write is logged and swallowed. A broken
 * disk cache must never take out the in-memory queue the user is watching.
 */
import { Directory, File, Paths } from 'expo-file-system'
import { create } from 'zustand'
import { countByStatus, type QueueItem, type QueueStatus } from './policy'

const QUEUE_DIR = 'uploads'
const QUEUE_FILE = 'queue.json'

interface QueueState {
  items: QueueItem[]
  wifiOnly: boolean
  /** False until the on-disk queue has been read back, so the processor waits. */
  hydrated: boolean
}

interface QueueActions {
  hydrate: () => Promise<void>
  enqueue: (
    items: Array<Omit<QueueItem, 'status' | 'progress' | 'addedAt'> & { addedAt?: number }>,
  ) => void
  setStatus: (id: string, status: QueueStatus, patch?: Partial<QueueItem>) => void
  setProgress: (id: string, progress: number) => void
  retry: (id: string) => void
  retryAllFailed: () => void
  remove: (id: string) => void
  clearFinished: () => void
  setWifiOnly: (v: boolean) => void
}

export const useUploadQueue = create<QueueState & QueueActions>((set, get) => ({
  items: [],
  wifiOnly: true, // The safe default: never spend a data plan without being asked.
  hydrated: false,

  hydrate: async () => {
    const saved = await readQueue()
    set(s => ({
      // On relaunch, anything that was mid-flight is reset to 'queued' so the
      // processor picks it up again — the server, not this flag, decides what work
      // remains. 'done' and 'failed' are preserved so the screen still shows them.
      items: (saved?.items ?? []).map(i =>
        i.status === 'uploading' ? { ...i, status: 'queued', progress: 0 } : i,
      ),
      wifiOnly: saved?.wifiOnly ?? s.wifiOnly,
      hydrated: true,
    }))
  },

  enqueue: incoming => {
    set(s => {
      const existing = new Map(s.items.map(i => [i.id, i]))
      let addedAt = Date.now()
      for (const raw of incoming) {
        // Idempotent on clientMediaId: re-adding a photo already in the queue (a
        // double-tap, or the same asset from a second pick) refreshes it rather than
        // duplicating. A finished-or-failed one flips back to queued for a re-run.
        const prev = existing.get(raw.id)
        existing.set(raw.id, {
          ...raw,
          status: 'queued',
          progress: 0,
          error: undefined,
          addedAt: prev?.addedAt ?? raw.addedAt ?? addedAt++,
        })
      }
      return { items: [...existing.values()] }
    })
    void persist(get())
  },

  setStatus: (id, status, patch) => {
    set(s => ({
      items: s.items.map(i => (i.id === id ? { ...i, ...patch, status } : i)),
    }))
    void persist(get())
  },

  // Progress is NOT persisted on every tick — it fires many times a second per part.
  // The on-disk copy only needs the coarse facts (which items, what status); progress
  // is reconstructed from the server on resume anyway.
  setProgress: (id, progress) =>
    set(s => ({ items: s.items.map(i => (i.id === id ? { ...i, progress } : i)) })),

  retry: id => {
    set(s => ({
      items: s.items.map(i =>
        i.id === id ? { ...i, status: 'queued', progress: 0, error: undefined } : i,
      ),
    }))
    void persist(get())
  },

  retryAllFailed: () => {
    set(s => ({
      items: s.items.map(i =>
        i.status === 'failed' ? { ...i, status: 'queued', progress: 0, error: undefined } : i,
      ),
    }))
    void persist(get())
  },

  remove: id => {
    set(s => ({ items: s.items.filter(i => i.id !== id) }))
    void persist(get())
  },

  clearFinished: () => {
    set(s => ({ items: s.items.filter(i => i.status !== 'done') }))
    void persist(get())
  },

  setWifiOnly: v => {
    set({ wifiOnly: v })
    void persist(get())
  },
}))

/**
 * Convenience hook for status counts.
 *
 * It selects the STABLE `items` array and derives the counts in the render body —
 * NOT `useUploadQueue(s => countByStatus(s.items))`. countByStatus builds a fresh
 * object every call, and a zustand selector that returns a new reference on every run
 * re-renders forever ("Maximum update depth exceeded"). Selecting the array (whose
 * reference only changes when the queue actually changes) avoids that.
 */
export function useQueueCounts() {
  const items = useUploadQueue(s => s.items)
  return countByStatus(items)
}

// --- persistence -----------------------------------------------------------

function queueFile(): File {
  const dir = new Directory(Paths.document, QUEUE_DIR)
  if (!dir.exists) dir.create({ intermediates: true })
  return new File(dir, QUEUE_FILE)
}

async function readQueue(): Promise<{ items: QueueItem[]; wifiOnly: boolean } | null> {
  try {
    const f = queueFile()
    if (!f.exists) return null
    const parsed = JSON.parse(await f.text())
    if (!parsed || !Array.isArray(parsed.items)) return null
    return { items: parsed.items, wifiOnly: parsed.wifiOnly !== false }
  } catch (err) {
    console.warn('[upload-queue] could not read persisted queue:', err)
    return null
  }
}

async function persist(state: QueueState): Promise<void> {
  try {
    const f = queueFile()
    // Strip the volatile 'progress' before writing — see setProgress.
    const items = state.items.map(({ progress: _p, ...rest }) => rest)
    const body = JSON.stringify({ items, wifiOnly: state.wifiOnly })
    if (!f.exists) f.create()
    f.write(body)
  } catch (err) {
    console.warn('[upload-queue] could not persist queue:', err)
  }
}
