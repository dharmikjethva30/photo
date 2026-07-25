// Package mediasvc implements the upload protocol from
// docs/adr/0003-upload-protocol.md: declare, upload direct to S3, complete.
package mediasvc

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/dharmikjethva30/photo/services/api/internal/adapter/postgres"
	"github.com/dharmikjethva30/photo/services/api/internal/adapter/postgres/sqlcgen"
	"github.com/dharmikjethva30/photo/services/api/internal/adapter/s3store"
	"github.com/dharmikjethva30/photo/services/api/internal/app/albumsvc"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/config"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/db"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/problem"
)

// Content types we accept. An allowlist, not a denylist: the worker decodes these
// bytes, and image decoders are a classic memory-safety surface.
var allowedTypes = map[string]struct {
	kind sqlcgen.MediaKind
	ext  string
}{
	"image/heic":      {sqlcgen.MediaKindPhoto, ".heic"},
	"image/heif":      {sqlcgen.MediaKindPhoto, ".heif"},
	"image/jpeg":      {sqlcgen.MediaKindPhoto, ".jpg"},
	"image/png":       {sqlcgen.MediaKindPhoto, ".png"},
	"video/quicktime": {sqlcgen.MediaKindVideo, ".mov"},
	"video/mp4":       {sqlcgen.MediaKindVideo, ".mp4"},
}

type Service struct {
	pool   db.Pool
	q      *sqlcgen.Queries
	albums *albumsvc.Service
	store  *s3store.Store
	vis    *postgres.VisibilityRepo
	limits config.Limits
}

func New(
	pool db.Pool, albums *albumsvc.Service, store *s3store.Store,
	vis *postgres.VisibilityRepo, limits config.Limits,
) *Service {
	return &Service{
		pool: pool, q: sqlcgen.New(pool), albums: albums,
		store: store, vis: vis, limits: limits,
	}
}

// DeclareInput is what the client promises to upload.
type DeclareInput struct {
	AlbumID uuid.UUID
	UserID  uuid.UUID
	// ClientMediaID is the local asset identifier. It makes this call idempotent:
	// a retry after a dropped response returns the SAME media item rather than
	// creating a duplicate photo.
	ClientMediaID     string
	ContentType       string
	ByteSize          int64
	SHA256B64         string
	OriginalFilename  string
	Width             *int32
	Height            *int32
	DurationMS        *int32
	CaptureTime       *time.Time
	TimezoneOffsetMin *int32
}

// DeclareResult tells the client where to PUT the bytes.
type DeclareResult struct {
	MediaID         uuid.UUID
	Mode            string
	Upload          s3store.PresignedPut
	AlreadyUploaded bool
}

// Declare validates the request, reserves a media row, and returns an upload plan.
func (s *Service) Declare(ctx context.Context, in DeclareInput) (DeclareResult, error) {
	spec, ok := allowedTypes[strings.ToLower(in.ContentType)]
	if !ok {
		return DeclareResult{}, problem.Validation(
			fmt.Sprintf("%s files are not supported.", in.ContentType),
			map[string]string{"contentType": "unsupported"})
	}
	if in.ByteSize <= 0 {
		return DeclareResult{}, problem.Validation("Declared size must be positive.",
			map[string]string{"byteSize": "must be > 0"})
	}

	maxBytes := s.limits.MaxImageBytes
	if spec.kind == sqlcgen.MediaKindVideo {
		maxBytes = s.limits.MaxVideoBytes
		if in.DurationMS == nil {
			return DeclareResult{}, problem.Validation("Videos must declare a duration.",
				map[string]string{"durationMs": "required"})
		}
		if int64(*in.DurationMS) > s.limits.MaxVideoDurationMS {
			return DeclareResult{}, problem.Validation(
				fmt.Sprintf("Videos are limited to %d seconds.", s.limits.MaxVideoDurationMS/1000),
				map[string]string{"durationMs": "too long"})
		}
	}
	if in.ByteSize > maxBytes {
		return DeclareResult{}, problem.Validation("That file is too large.",
			map[string]string{"byteSize": "exceeds limit"})
	}

	// Membership, album state and the upload window, in one check.
	album, err := s.albums.CanUpload(ctx, in.AlbumID, in.UserID)
	if err != nil {
		return DeclareResult{}, err
	}

	// M1 ships single-PUT only; the threshold is configured above the test assets.
	// Multipart lands in M2 WITHOUT changing this envelope — see ADR 0003.
	if in.ByteSize > s.limits.MultipartThreshold {
		return DeclareResult{}, problem.Validation(
			"Files this large need resumable upload, which is not enabled yet.",
			map[string]string{"byteSize": "exceeds single-upload threshold"})
	}

	ext := spec.ext
	if e := filepath.Ext(in.OriginalFilename); e != "" {
		ext = strings.ToLower(e)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DeclareResult{}, problem.Internal(fmt.Errorf("begin: %w", err))
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)

	var filename *string
	if in.OriginalFilename != "" {
		filename = &in.OriginalFilename
	}
	var sha *string
	if in.SHA256B64 != "" {
		sha = &in.SHA256B64
	}

	approval := sqlcgen.MediaApprovalStateNotRequired
	if album.PrivacyMode == sqlcgen.AlbumPrivacyModePrivate {
		// Creator review: the group does not see it until the owner approves.
		approval = sqlcgen.MediaApprovalStatePending
	}

	// The storage key needs the media id, which the insert generates — so declare
	// with a placeholder and update. Cheaper than a round-trip for an id, and keeps
	// the key derivable from the row rather than stored twice.
	media, err := q.DeclareMediaUpload(ctx, sqlcgen.DeclareMediaUploadParams{
		AlbumID:           in.AlbumID,
		UploaderUserID:    in.UserID,
		Kind:              spec.kind,
		ClientMediaID:     in.ClientMediaID,
		StorageKey:        "pending",
		ContentType:       strings.ToLower(in.ContentType),
		ByteSize:          in.ByteSize,
		Sha256B64:         sha,
		OriginalFilename:  filename,
		Width:             in.Width,
		Height:            in.Height,
		DurationMs:        in.DurationMS,
		CaptureTimeClient: in.CaptureTime,
		TimezoneOffsetMin: in.TimezoneOffsetMin,
		ApprovalState:     approval,
	})
	if err != nil {
		return DeclareResult{}, problem.Internal(fmt.Errorf("declare media: %w", err))
	}

	// Idempotency: a retry of an already-completed upload must not hand back a new
	// presigned URL that would let the bytes be replaced.
	if media.State != sqlcgen.MediaStatePending {
		if err := tx.Commit(ctx); err != nil {
			return DeclareResult{}, problem.Internal(fmt.Errorf("commit: %w", err))
		}
		return DeclareResult{MediaID: media.ID, AlreadyUploaded: true}, nil
	}

	key := s3store.OriginalKey(in.AlbumID.String(), media.ID.String(), ext)
	if _, err := tx.Exec(ctx,
		`UPDATE media_items SET storage_key = $2 WHERE id = $1`, media.ID, key,
	); err != nil {
		return DeclareResult{}, problem.Internal(fmt.Errorf("set storage key: %w", err))
	}

	if _, err := q.CreateUploadSession(ctx, sqlcgen.CreateUploadSessionParams{
		MediaItemID: media.ID,
	}); err != nil {
		return DeclareResult{}, problem.Internal(fmt.Errorf("create upload session: %w", err))
	}

	put, err := s.store.PresignPut(ctx, key, media.ContentType, in.ByteSize, in.SHA256B64)
	if err != nil {
		return DeclareResult{}, problem.Internal(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return DeclareResult{}, problem.Internal(fmt.Errorf("commit: %w", err))
	}

	return DeclareResult{MediaID: media.ID, Mode: "single", Upload: put}, nil
}

// Complete verifies the bytes actually landed, then enqueues processing.
//
// THIS IS THE TRUST BOUNDARY. The client declared a size and checksum; here we ask
// S3 what is really there. Without this, byte_size is a client-controlled number
// feeding quota accounting and storage cost, and a truncated upload would be served
// to the album as a valid photo.
func (s *Service) Complete(ctx context.Context, mediaID, userID uuid.UUID) (sqlcgen.MediaItem, error) {
	media, err := s.q.GetMediaItem(ctx, mediaID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return sqlcgen.MediaItem{}, problem.NotFound("No such upload.")
		}
		return sqlcgen.MediaItem{}, problem.Internal(fmt.Errorf("get media: %w", err))
	}
	if media.UploaderUserID != userID {
		// Only the uploader may complete their own upload.
		return sqlcgen.MediaItem{}, problem.NotFound("No such upload.")
	}
	if media.State != sqlcgen.MediaStatePending {
		// Idempotent: a retried /complete is a success, not a conflict.
		return media, nil
	}

	info, err := s.store.Head(ctx, s.store.MediaBucket(), media.StorageKey)
	if err != nil {
		if errors.Is(err, s3store.ErrNotFound) {
			return sqlcgen.MediaItem{}, problem.Conflict(problem.TypeSizeMismatch,
				"We could not find those bytes in storage. Please retry the upload.")
		}
		return sqlcgen.MediaItem{}, problem.Internal(err)
	}

	if info.SizeBytes != media.ByteSize {
		return sqlcgen.MediaItem{}, problem.Conflict(problem.TypeSizeMismatch,
			fmt.Sprintf("The upload is %d bytes but %d were declared. Please retry.",
				info.SizeBytes, media.ByteSize))
	}
	// Only compare when both sides have a checksum: S3 returns one only if the
	// client sent it, and it is optional in the declare step.
	if media.Sha256B64 != nil && info.ChecksumB64 != "" && info.ChecksumB64 != *media.Sha256B64 {
		return sqlcgen.MediaItem{}, problem.Conflict(problem.TypeSizeMismatch,
			"The uploaded bytes do not match the declared checksum. Please retry.")
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return sqlcgen.MediaItem{}, problem.Internal(fmt.Errorf("begin: %w", err))
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)

	updated, err := q.MarkMediaUploaded(ctx, sqlcgen.MarkMediaUploadedParams{
		ID:        mediaID,
		ByteSize:  info.SizeBytes,
		Sha256B64: nullIfEmpty(info.ChecksumB64),
	})
	if err != nil {
		return sqlcgen.MediaItem{}, problem.Internal(fmt.Errorf("mark uploaded: %w", err))
	}
	if err := q.CompleteUploadSession(ctx, mediaID); err != nil {
		return sqlcgen.MediaItem{}, problem.Internal(fmt.Errorf("complete session: %w", err))
	}

	// Enqueued in the SAME transaction as the state change, so a job can neither be
	// lost (committed state, no job) nor fire against uncommitted state.
	for _, kind := range []string{"thumbnail", "face"} {
		if _, err := q.EnqueueMediaJob(ctx, sqlcgen.EnqueueMediaJobParams{
			Kind:        kind,
			MediaItemID: mediaID,
			AlbumID:     media.AlbumID,
		}); err != nil {
			return sqlcgen.MediaItem{}, problem.Internal(fmt.Errorf("enqueue %s job: %w", kind, err))
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return sqlcgen.MediaItem{}, problem.Internal(fmt.Errorf("commit: %w", err))
	}
	return updated, nil
}

// RenditionURL authorizes a read and returns a short-lived presigned URL.
//
// The visibility check happens BEFORE signing, and must: a presigned URL bypasses
// authorization entirely once issued, so checking afterwards is not a check.
//
// Callers expose this behind a STABLE url (/v1/media/{id}/thumb) that 302s here,
// because presigned URLs rotate their query string and would defeat the client's
// image cache — re-downloading the whole grid on every screen focus.
func (s *Service) RenditionURL(
	ctx context.Context, mediaID, viewerID uuid.UUID, rendition string,
) (string, error) {
	if err := s.vis.CanView(ctx, mediaID, viewerID); err != nil {
		if errors.Is(err, postgres.ErrNotVisible) {
			// 404, never 403: distinguishing "exists but hidden from you" from
			// "does not exist" confirms a photo exists, which is exactly what
			// face-privacy protects.
			return "", problem.NotFound("No such photo.")
		}
		return "", problem.Internal(err)
	}

	if rendition == "original" {
		media, err := s.q.GetMediaItem(ctx, mediaID)
		if err != nil {
			return "", problem.Internal(fmt.Errorf("get media: %w", err))
		}
		return s.store.PresignGet(ctx, s.store.MediaBucket(), media.StorageKey)
	}

	row, err := s.q.GetRendition(ctx, sqlcgen.GetRenditionParams{
		MediaItemID: mediaID,
		Name:        rendition,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Visible, but not processed yet. 404 rather than a broken image.
			return "", problem.NotFound("That version of the photo is not ready yet.")
		}
		return "", problem.Internal(fmt.Errorf("get rendition: %w", err))
	}
	return s.store.PresignGet(ctx, s.store.MediaBucket(), row.StorageKey)
}

func nullIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
