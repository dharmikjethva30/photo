/**
 * react-query hooks over the API. Every product screen reads from here — there is
 * no other data source, which is what keeps the app honest about being wired to a
 * real backend.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { setSession } from '../auth/session'
import { anonRequest, request } from './client'
import type { Album, AlbumMember, AlbumTemplate, FeedPage, Me, PrivacyMode, Session } from './types'

export const queryKeys = {
  me: ['me'] as const,
  albums: ['albums'] as const,
  album: (id: string) => ['album', id] as const,
  albumMembers: (id: string) => ['album', id, 'members'] as const,
  albumFeed: (id: string, filter: string) => ['album', id, 'feed', filter] as const,
}

// --- auth ------------------------------------------------------------------

/**
 * Sign in.
 *
 * `idToken` is a real Apple/Google ID token in production. With APP_ENV=local the
 * server wires a fake verifier that derives a stable identity from whatever string
 * is sent, so development needs no provider credentials.
 */
export function useSignIn() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { provider: 'apple' | 'google'; idToken: string }) => {
      const session = await anonRequest<Session>(`/v1/auth/${vars.provider}`, {
        idToken: vars.idToken,
      })
      await setSession(session)
      return session
    },
    onSuccess: () => {
      // A different user may be signing in on this device.
      void qc.invalidateQueries()
    },
  })
}

export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: () => request<Me>('/v1/me'),
  })
}

export function useUpdateMe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { displayName: string }) =>
      request<Me>('/v1/me', { method: 'PATCH', body: vars }),
    onSuccess: data => qc.setQueryData(queryKeys.me, data),
  })
}

// --- albums ----------------------------------------------------------------

export function useAlbums() {
  return useQuery({
    queryKey: queryKeys.albums,
    queryFn: async () => {
      const res = await request<{ albums: Album[] }>('/v1/albums')
      return res.albums
    },
  })
}

/**
 * The album, polled while anything is still processing.
 *
 * Polling rather than push because a photo becomes viewable a second or two after
 * upload and only then; a websocket or push channel for that is disproportionate.
 * The interval stops as soon as processingCount reaches zero, so an idle album
 * costs nothing.
 */
export function useAlbum(albumID: string) {
  return useQuery({
    queryKey: queryKeys.album(albumID),
    queryFn: () => request<Album>(`/v1/albums/${albumID}`),
    enabled: Boolean(albumID),
    refetchInterval: query => {
      const processing = query.state.data?.processingCount ?? 0
      return processing > 0 ? 2000 : false
    },
  })
}

export function useAlbumMembers(albumID: string) {
  return useQuery({
    queryKey: queryKeys.albumMembers(albumID),
    queryFn: async () => {
      const res = await request<{ members: AlbumMember[] }>(`/v1/albums/${albumID}/members`)
      return res.members
    },
    enabled: Boolean(albumID),
  })
}

export function useCreateAlbum() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { title: string; template: AlbumTemplate; privacyMode: PrivacyMode }) =>
      request<Album>('/v1/albums', { method: 'POST', body: vars }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.albums })
      // The free-album counter moved, and the paywall decision depends on it.
      void qc.invalidateQueries({ queryKey: queryKeys.me })
    },
  })
}

// --- feed ------------------------------------------------------------------

/**
 * The album grid.
 *
 * Keyset pagination, never offset: an offset shifts under concurrent uploads and
 * would silently duplicate or skip photos mid-scroll.
 */
export function useAlbumFeed(
  albumID: string,
  filter: 'all' | 'just-me' = 'all',
  // Kept in step with useAlbum's poll so a photo appears in the grid at the same
  // moment the header count changes, rather than one interval later.
  pollWhileProcessing = false,
) {
  return useInfiniteQuery({
    queryKey: queryKeys.albumFeed(albumID, filter),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ filter, limit: '60' })
      if (pageParam) params.set('cursor', pageParam)
      return request<FeedPage>(`/v1/albums/${albumID}/media?${params.toString()}`)
    },
    getNextPageParam: last => last.nextCursor,
    enabled: Boolean(albumID),
    refetchInterval: pollWhileProcessing ? 2000 : false,
  })
}
