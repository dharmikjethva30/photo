/**
 * react-query hooks over the API. Every product screen reads from here — there is
 * no other data source, which is what keeps the app honest about being wired to a
 * real backend.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { setSession } from '../auth/session'
import { enrollFaceReference } from '../upload/faceReference'
import { anonGet, anonRequest, request } from './client'
import type {
  Album,
  AlbumMember,
  AlbumTemplate,
  FaceConsent,
  FaceReference,
  FeedPage,
  Grant,
  Invite,
  InvitePreview,
  Me,
  PrivacyMode,
  Session,
  SuggestedTag,
} from './types'

export const queryKeys = {
  me: ['me'] as const,
  albums: ['albums'] as const,
  album: (id: string) => ['album', id] as const,
  albumMembers: (id: string) => ['album', id, 'members'] as const,
  albumInvites: (id: string) => ['album', id, 'invites'] as const,
  albumFeed: (id: string, filter: string) => ['album', id, 'feed', filter] as const,
  faceConsent: ['face-consent'] as const,
  faceReferences: ['face-references'] as const,
  suggestedTags: (albumId: string) => ['album', albumId, 'suggested-tags'] as const,
  albumGrants: (albumId: string) => ['album', albumId, 'grants'] as const,
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

// --- invites ---------------------------------------------------------------

/** Live invites for an album's manage screen. */
export function useAlbumInvites(albumID: string) {
  return useQuery({
    queryKey: queryKeys.albumInvites(albumID),
    queryFn: async () => {
      const res = await request<{ invites: Invite[] }>(`/v1/albums/${albumID}/invites`)
      return res.invites
    },
  })
}

/** Mint an invite. Defaults to a reusable link; the caller may pass a channel. */
export function useCreateInvite(albumID: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { channel?: Invite['channel']; maxUses?: number }) =>
      request<Invite>(`/v1/albums/${albumID}/invites`, { method: 'POST', body: vars }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.albumInvites(albumID) })
    },
  })
}

/** Revoke an invite; it stops working immediately. */
export function useRevokeInvite(albumID: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (inviteID: string) =>
      request<void>(`/v1/albums/${albumID}/invites/${inviteID}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.albumInvites(albumID) })
    },
  })
}

/**
 * The PUBLIC invite preview for the join landing. Unauthenticated on purpose: the
 * landing renders before the user has signed in. `retry: false` because a 404 (bad
 * code) or 409-shaped invalid is a definitive answer, not a transient error.
 */
export function useInvitePreview(code: string) {
  return useQuery({
    queryKey: ['invite', code],
    queryFn: () => anonGet<InvitePreview>(`/v1/invites/${code}`),
    retry: false,
    enabled: code.length > 0,
  })
}

/**
 * Accept an invite and join. Requires a session. On success the whole album list and
 * the just-joined album are refreshed so the app lands in an accurate state.
 */
export function useAcceptInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (code: string) => request<Album>(`/v1/invites/${code}/accept`, { method: 'POST' }),
    onSuccess: album => {
      void qc.invalidateQueries({ queryKey: queryKeys.albums })
      void qc.invalidateQueries({ queryKey: queryKeys.album(album.id) })
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

// --- faces: consent + reference enrolment ----------------------------------

/** The biometric-consent state. Drives the onboarding gate and the privacy screen. */
export function useFaceConsent() {
  return useQuery({
    queryKey: queryKeys.faceConsent,
    queryFn: () => request<FaceConsent>('/v1/me/face-consent'),
  })
}

/** Grant consent to the CURRENT copy version. The server stamps the version itself. */
export function useGrantFaceConsent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => request<FaceConsent>('/v1/me/face-consent', { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.faceConsent }),
  })
}

/** The user's enrolled reference selfies. */
export function useFaceReferences() {
  return useQuery({
    queryKey: queryKeys.faceReferences,
    queryFn: () => request<{ references: FaceReference[] }>('/v1/me/face-references'),
    // The worker embeds a fresh selfie moments after upload; poll briefly so the
    // "processing" state resolves to "ready" without a manual refresh.
    refetchInterval: q => {
      const refs = q.state.data?.references ?? []
      return refs.some(r => !r.processed) ? 2500 : false
    },
  })
}

/** Enrol a reference selfie (declare → PUT → complete against the facedata bucket). */
export function useEnrollFaceReference() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (asset: { uri: string; mimeType?: string | null; fileName?: string | null }) =>
      enrollFaceReference(asset),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.faceReferences }),
  })
}

/** Delete one reference selfie (soft-delete + S3 delete, server-side). */
export function useDeleteFaceReference() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (referenceId: string) =>
      request(`/v1/me/face-references/${referenceId}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.faceReferences }),
  })
}

/** GDPR erasure: hard-delete every face reference, embedding, tag and crop. */
export function useEraseFaceData() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      request<{ referencesDeleted: number; objectsDeleted: number }>('/v1/me/face-data', {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.faceReferences })
      void qc.invalidateQueries({ queryKey: queryKeys.faceConsent })
    },
  })
}

// --- faces: tag confirmation (the "you're in these" sheet) -----------------

/** Photos in an album the viewer is auto-suggested in but hasn't decided yet. */
export function useSuggestedTags(albumID: string) {
  return useQuery({
    queryKey: queryKeys.suggestedTags(albumID),
    queryFn: () =>
      request<{ suggestions: SuggestedTag[] }>(`/v1/albums/${albumID}/my-suggested-tags`),
    enabled: Boolean(albumID),
  })
}

/**
 * Confirm or reject a suggested tag. Confirming grants visibility (server-side, via
 * the media_subjects trigger), so on success we refresh the feed AND the suggestions.
 */
export function useDecideFaceTag(albumID: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ tagId, confirm }: { tagId: string; confirm: boolean }) =>
      request(`/v1/face-tags/${tagId}/${confirm ? 'confirm' : 'reject'}`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.suggestedTags(albumID) })
      void qc.invalidateQueries({ queryKey: ['album', albumID, 'feed'] })
      void qc.invalidateQueries({ queryKey: queryKeys.album(albumID) })
    },
  })
}

// --- subject controls: hide-me + share grants ------------------------------

/** The absolute hide-me veto on a photo the viewer appears in. */
export function useHideMedia(albumID: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ mediaId, hide }: { mediaId: string; hide: boolean }) =>
      request(`/v1/media/${mediaId}/hide`, { method: hide ? 'POST' : 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['album', albumID, 'feed'] }),
  })
}

/** Grants the caller has issued in an album (for the review/revoke list). */
export function useAlbumGrants(albumID: string) {
  return useQuery({
    queryKey: queryKeys.albumGrants(albumID),
    queryFn: () => request<{ grants: Grant[] }>(`/v1/albums/${albumID}/grants`),
    enabled: Boolean(albumID),
  })
}

/** "Show this photo of me to X." */
export function useGrantSingle(albumID: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ mediaId, granteeUserId }: { mediaId: string; granteeUserId: string }) =>
      request<{ grantId: string }>(`/v1/media/${mediaId}/grants`, {
        method: 'POST',
        body: { granteeUserId },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.albumGrants(albumID) }),
  })
}

/** "Show X every photo of me in this album." */
export function useGrantBulk(albumID: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (granteeUserId: string) =>
      request<{ grantId: string }>(`/v1/albums/${albumID}/grants`, {
        method: 'POST',
        body: { granteeUserId },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.albumGrants(albumID) }),
  })
}

/** Revoke a grant the caller issued. */
export function useRevokeGrant(albumID: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (grantId: string) => request(`/v1/grants/${grantId}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.albumGrants(albumID) }),
  })
}
