package mediasvc

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/dharmikjethva30/photo/services/api/internal/adapter/postgres/sqlcgen"
	"github.com/dharmikjethva30/photo/services/api/internal/adapter/s3store"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/problem"
)

// ResumeState tells a client what it still has to upload.
type ResumeState struct {
	MediaID   uuid.UUID               `json:"mediaId"`
	State     string                  `json:"state"`
	Mode      string                  `json:"mode"`
	PartSize  int64                   `json:"partSize,omitempty"`
	PartCount int32                   `json:"partCount,omitempty"`
	Completed []s3store.CompletedPart `json:"completed"`
	Missing   []int32                 `json:"missing"`
}

// Resume reports which parts S3 has actually received.
//
// The truth comes from S3, not from client bookkeeping: a client killed mid-part
// cannot know whether that part landed, and guessing either re-uploads unnecessarily
// or skips a gap and produces a corrupt object.
func (s *Service) Resume(ctx context.Context, mediaID, userID uuid.UUID) (ResumeState, error) {
	media, session, err := s.ownedUpload(ctx, mediaID, userID)
	if err != nil {
		return ResumeState{}, err
	}

	out := ResumeState{
		MediaID:   media.ID,
		State:     string(media.State),
		Mode:      "single",
		Completed: []s3store.CompletedPart{},
		Missing:   []int32{},
	}

	// A finished upload has nothing to resume. Reported rather than errored so a
	// client that lost its response can converge without special-casing.
	if media.State != sqlcgen.MediaStatePending {
		return out, nil
	}

	if session.S3UploadID == nil {
		// Single PUT: there are no parts, so the only options are "upload it" or
		// "it already landed". The client re-declares to get a fresh URL.
		out.Missing = []int32{1}
		return out, nil
	}

	out.Mode = "multipart"
	if session.PartSize != nil {
		out.PartSize = *session.PartSize
		out.PartCount = s3store.PartCount(media.ByteSize, *session.PartSize)
	}

	completed, err := s.store.ListParts(ctx, media.StorageKey, *session.S3UploadID)
	if err != nil {
		if errors.Is(err, s3store.ErrNotFound) {
			// The multipart upload expired or was aborted. Every part must be sent
			// again, which the client discovers by re-declaring.
			out.Missing = allParts(out.PartCount)
			return out, nil
		}
		return ResumeState{}, problem.Internal(err)
	}

	have := make(map[int32]bool, len(completed))
	for _, p := range completed {
		have[p.PartNumber] = true
	}
	for n := int32(1); n <= out.PartCount; n++ {
		if !have[n] {
			out.Missing = append(out.Missing, n)
		}
	}
	out.Completed = completed
	return out, nil
}

// liveUploadID returns this media item's existing S3 multipart upload id, if it still
// exists, or "" if there is none to reuse.
//
// The check against S3 is the point. A row can name an upload that S3 has since
// discarded — the AbortIncompleteMultipartUpload lifecycle rule and the stalled-upload
// reconciler both do that — and handing a dead upload id back to a client produces a
// NoSuchUpload on its first part, which reads like a server bug.
func (s *Service) liveUploadID(ctx context.Context, mediaID uuid.UUID, key string) (string, error) {
	session, err := s.q.GetUploadSession(ctx, mediaID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", problem.Internal(fmt.Errorf("get upload session: %w", err))
	}
	if session.S3UploadID == nil || session.AbortedAt != nil || session.CompletedAt != nil {
		return "", nil
	}

	if _, err := s.store.ListParts(ctx, key, *session.S3UploadID); err != nil {
		if errors.Is(err, s3store.ErrNotFound) {
			return "", nil // expired or aborted; the caller starts a fresh one
		}
		return "", problem.Internal(err)
	}
	return *session.S3UploadID, nil
}

// PartURLs signs a batch of part URLs for the parts the client asks about.
//
// The client supplies each part's SHA-256 because the signature has to cover it — see
// s3store.PresignParts for why that is S3's constraint and not ours.
//
// This is also the recovery path for expiry: a 400 MB upload on hotel wifi can outlive
// a presign, and the failure otherwise surfaces as a 403 on part 37, which reads like a
// bug in our code. The client re-requests the parts it has left.
func (s *Service) PartURLs(
	ctx context.Context, mediaID, userID uuid.UUID, want []s3store.PartToSign,
) ([]s3store.PresignedPart, error) {
	media, session, err := s.ownedUpload(ctx, mediaID, userID)
	if err != nil {
		return nil, err
	}
	if session.S3UploadID == nil {
		return nil, problem.Validation("That upload is not a multipart upload.", nil)
	}
	if media.State != sqlcgen.MediaStatePending {
		return nil, problem.Conflict("", "That upload has already been completed.")
	}
	if len(want) == 0 {
		return nil, problem.Validation("Ask for at least one part.", nil)
	}
	if len(want) > PartBatchSize {
		return nil, problem.Validation(
			fmt.Sprintf("Ask for at most %d parts at a time.", PartBatchSize),
			map[string]string{"parts": "too many"})
	}

	total := s3store.PartCount(media.ByteSize, derefInt64(session.PartSize, s.limits.MultipartPartSize))
	seen := make(map[int32]bool, len(want))
	for _, p := range want {
		if p.PartNumber < 1 || p.PartNumber > total {
			return nil, problem.Validation(
				fmt.Sprintf("Part %d is outside this upload's range of 1..%d.", p.PartNumber, total),
				map[string]string{"partNumber": "out of range"})
		}
		if seen[p.PartNumber] {
			// Two URLs for one part with different checksums is a client bug that
			// would otherwise show up as a corrupt object much later.
			return nil, problem.Validation(
				fmt.Sprintf("Part %d was asked for twice.", p.PartNumber),
				map[string]string{"partNumber": "duplicate"})
		}
		seen[p.PartNumber] = true
		if !validSHA256B64(p.SHA256B64) {
			return nil, problem.Validation(
				fmt.Sprintf("Part %d needs a base64-encoded sha256 of its bytes.", p.PartNumber),
				map[string]string{"sha256": "must be 32 bytes, base64"})
		}
	}

	parts, err := s.store.PresignParts(ctx, media.StorageKey, *session.S3UploadID, want)
	if err != nil {
		return nil, problem.Internal(err)
	}
	return parts, nil
}

// agreesWithS3 checks a client's claimed part list against what S3 actually holds.
//
// ETags are compared case-insensitively and with quotes stripped: S3 returns them
// quoted, and clients variously forward them verbatim, unquoted, or lowercased. A
// spurious mismatch here would block a perfectly good upload.
func agreesWithS3(claimed, stored []s3store.CompletedPart) error {
	have := make(map[int32]string, len(stored))
	for _, p := range stored {
		have[p.PartNumber] = normalizeETag(p.ETag)
	}
	for _, c := range claimed {
		got, ok := have[c.PartNumber]
		if !ok {
			return fmt.Errorf("part %d was reported but S3 does not have it", c.PartNumber)
		}
		// An empty claimed ETag is fine — the client simply did not track it, which
		// is now the expected case.
		if c.ETag != "" && normalizeETag(c.ETag) != got {
			return fmt.Errorf("part %d does not match what S3 stored", c.PartNumber)
		}
	}
	return nil
}

func normalizeETag(s string) string {
	return strings.ToLower(strings.Trim(s, `"`))
}

// validSHA256B64 checks the shape before it reaches the signer.
//
// Worth checking here because a malformed value produces a URL that S3 rejects with an
// opaque signature error at part-upload time, far from the cause.
func validSHA256B64(s string) bool {
	raw, err := base64.StdEncoding.DecodeString(s)
	return err == nil && len(raw) == sha256.Size
}

// assembleMultipart asks S3 to stitch the parts into the final object.
//
// Called by Complete, which then applies the SAME HeadObject verification the
// single-PUT path uses. Keeping the verification in one place is deliberate: two upload
// modes with two notions of "verified" is how one of them ends up not verified.
//
// Ownership and state were already checked by Complete.
func (s *Service) assembleMultipart(
	ctx context.Context,
	media sqlcgen.MediaItem,
	session sqlcgen.UploadSession,
	parts []s3store.CompletedPart,
) error {
	// Already assembled by an earlier attempt whose response was lost. HeadObject in
	// Complete will confirm the object, and asking S3 to complete twice is an error.
	if session.CompletedAt != nil {
		return nil
	}

	// The part list ALWAYS comes from S3, never from the client — the same rule as
	// Resume, and for the same reason. Two extra benefits fall out of it:
	//
	//   - S3 is the only source of the per-part checksums that CompleteMultipartUpload
	//     requires, since it computed them on arrival.
	//   - The client therefore does not have to persist ETags at all. Across an app
	//     kill it needs only {mediaId, uploadId}, which is one fewer thing to lose.
	//
	// A client-supplied list is treated as a claim to verify, not as input.
	stored, err := s.store.ListParts(ctx, media.StorageKey, *session.S3UploadID)
	if err != nil {
		if errors.Is(err, s3store.ErrNotFound) {
			return problem.Conflict(problem.TypeUploadExpired,
				"This upload expired before it finished. Start it again.")
		}
		return problem.Internal(err)
	}

	expected := s3store.PartCount(media.ByteSize, derefInt64(session.PartSize, s.limits.MultipartPartSize))
	if int64(len(stored)) != int64(expected) {
		return problem.Conflict(problem.TypeSizeMismatch,
			fmt.Sprintf("This upload needs %d parts but S3 has %d. Resume and send the rest.",
				expected, len(stored)))
	}

	// If the client told us what it thinks it uploaded, hold it to that. A mismatch
	// means the client and S3 disagree, and assembling anyway would produce an object
	// neither side expects.
	if len(parts) > 0 {
		if err := agreesWithS3(parts, stored); err != nil {
			return problem.Conflict(problem.TypeSizeMismatch, err.Error())
		}
	}

	if err := s.store.CompleteMultipart(ctx, media.StorageKey, *session.S3UploadID, stored); err != nil {
		return problem.Internal(err)
	}
	return nil
}

// AbortUpload discards an in-flight upload and its parts.
func (s *Service) AbortUpload(ctx context.Context, mediaID, userID uuid.UUID) error {
	media, session, err := s.ownedUpload(ctx, mediaID, userID)
	if err != nil {
		return err
	}
	if session.S3UploadID != nil {
		// Idempotent in the store: S3's NoSuchUpload is swallowed, so a client
		// retrying an abort after a dropped response gets 204 rather than an error.
		if err := s.store.AbortMultipart(ctx, media.StorageKey, *session.S3UploadID); err != nil {
			return problem.Internal(err)
		}
	}
	if err := s.q.AbortUploadSession(ctx, mediaID); err != nil {
		return problem.Internal(fmt.Errorf("abort upload session: %w", err))
	}
	if err := s.q.MarkMediaFailed(ctx, mediaID); err != nil {
		return problem.Internal(fmt.Errorf("mark failed: %w", err))
	}
	return nil
}

// ReconcileStalledUploads completes or abandons uploads whose client died between
// the last part PUT and the /complete call.
//
// This is the gap the client-callback design leaves open (docs/adr/0003), and the
// reason S3 event notifications are not needed: run this on a schedule and the
// outcome is the same, with behaviour identical on LocalStack and real S3.
func (s *Service) ReconcileStalledUploads(ctx context.Context, olderThan time.Duration, limit int32) (int, error) {
	stale, err := s.q.ListStalePendingUploads(ctx, sqlcgen.ListStalePendingUploadsParams{
		CreatedAt: time.Now().Add(-olderThan),
		Limit:     limit,
	})
	if err != nil {
		return 0, fmt.Errorf("list stale uploads: %w", err)
	}

	fixed := 0
	for i := range stale {
		media := stale[i]

		// Complete does the work for both modes: for a single PUT it verifies the
		// object, and for a multipart upload it assembles the parts first. So a client
		// that died after its last part — the exact gap this reconciler exists to
		// close — is finished here rather than abandoned.
		if _, err := s.Complete(ctx, media.ID, media.UploaderUserID, nil); err == nil {
			fixed++
			continue
		}

		// Complete refused: the bytes are absent or short, so the upload cannot be
		// salvaged. Abort it, or S3 keeps billing for the orphaned parts.
		if err := s.AbortUpload(ctx, media.ID, media.UploaderUserID); err == nil {
			fixed++
		}
	}
	return fixed, nil
}

// ownedUpload loads an upload and its session, enforcing that the caller owns it.
func (s *Service) ownedUpload(
	ctx context.Context, mediaID, userID uuid.UUID,
) (sqlcgen.MediaItem, sqlcgen.UploadSession, error) {
	media, err := s.q.GetMediaItem(ctx, mediaID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return sqlcgen.MediaItem{}, sqlcgen.UploadSession{}, problem.NotFound("No such upload.")
		}
		return sqlcgen.MediaItem{}, sqlcgen.UploadSession{},
			problem.Internal(fmt.Errorf("get media: %w", err))
	}
	// 404 rather than 403: only the uploader has any business with an in-flight
	// upload, and confirming it exists to anyone else is needless.
	if media.UploaderUserID != userID {
		return sqlcgen.MediaItem{}, sqlcgen.UploadSession{}, problem.NotFound("No such upload.")
	}

	session, err := s.q.GetUploadSession(ctx, mediaID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return sqlcgen.MediaItem{}, sqlcgen.UploadSession{},
				problem.NotFound("No such upload session.")
		}
		return sqlcgen.MediaItem{}, sqlcgen.UploadSession{},
			problem.Internal(fmt.Errorf("get upload session: %w", err))
	}
	return media, session, nil
}

func allParts(n int32) []int32 {
	out := make([]int32, 0, n)
	for i := int32(1); i <= n; i++ {
		out = append(out, i)
	}
	return out
}

func derefInt64(p *int64, fallback int64) int64 {
	if p == nil {
		return fallback
	}
	return *p
}
