/**
 * Session storage.
 *
 * The split matters (docs/adr/0004):
 *   - the ACCESS token lives in memory only. It is short-lived and is the thing a
 *     proxy or a crash log is most likely to capture, so it never touches disk.
 *   - the REFRESH token goes to SecureStore, i.e. the iOS Keychain or the Android
 *     Keystore, because it is the long-lived credential.
 */
import * as SecureStore from 'expo-secure-store'
import { create } from 'zustand'
import type { Session } from '../api/types'

const REFRESH_KEY = 'photu.refreshToken'
const USER_KEY = 'photu.user'

interface SessionState {
  accessToken: string | null
  refreshToken: string | null
  user: { id: string; displayName: string } | null
  /** False until restoreSession() has run, so the router does not flash sign-in. */
  hydrated: boolean
}

interface SessionActions {
  apply: (s: Session) => void
  clear: () => void
  markHydrated: () => void
  hydrate: (partial: Partial<SessionState>) => void
}

export const useSessionStore = create<SessionState & SessionActions>(set => ({
  accessToken: null,
  refreshToken: null,
  user: null,
  hydrated: false,

  apply: s =>
    set({
      accessToken: s.accessToken,
      refreshToken: s.refreshToken,
      user: s.user,
      hydrated: true,
    }),
  clear: () => set({ accessToken: null, refreshToken: null, user: null, hydrated: true }),
  markHydrated: () => set({ hydrated: true }),
  hydrate: partial => set(partial),
}))

/**
 * Read the current session.
 *
 * Async because the client may need it before React has mounted (the very first
 * request after a cold start), at which point the store is still empty and the
 * refresh token has to come from SecureStore.
 */
export async function getSession(): Promise<{
  accessToken: string | null
  refreshToken: string | null
} | null> {
  const { accessToken, refreshToken } = useSessionStore.getState()
  if (accessToken || refreshToken) return { accessToken, refreshToken }

  const stored = await SecureStore.getItemAsync(REFRESH_KEY)
  if (!stored) return null
  return { accessToken: null, refreshToken: stored }
}

export async function setSession(s: Session): Promise<void> {
  useSessionStore.getState().apply(s)
  await SecureStore.setItemAsync(REFRESH_KEY, s.refreshToken)
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(s.user))
}

export async function clearSession(): Promise<void> {
  useSessionStore.getState().clear()
  await SecureStore.deleteItemAsync(REFRESH_KEY)
  await SecureStore.deleteItemAsync(USER_KEY)
}

/**
 * Restore on launch.
 *
 * Only the refresh token survives a restart, so there is no access token until the
 * first request triggers a refresh. The cached user is loaded purely so the UI can
 * render a name immediately instead of waiting on a round-trip.
 */
export async function restoreSession(): Promise<void> {
  const store = useSessionStore.getState()
  try {
    const [refreshToken, userJSON] = await Promise.all([
      SecureStore.getItemAsync(REFRESH_KEY),
      SecureStore.getItemAsync(USER_KEY),
    ])
    store.hydrate({
      refreshToken,
      user: userJSON ? JSON.parse(userJSON) : null,
      hydrated: true,
    })
  } catch {
    // A SecureStore failure must not wedge the app on a splash screen. Treat it as
    // "not signed in" and let the user sign in again.
    store.hydrate({ hydrated: true })
  }
}

/** True when there is anything to attempt a session with. */
export const useIsSignedIn = (): boolean =>
  useSessionStore(s => Boolean(s.accessToken ?? s.refreshToken))
