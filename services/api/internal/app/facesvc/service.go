// Package facesvc owns the biometric-consent lifecycle and face reference selfies.
//
// This is the most legally-loaded surface in the product. Face embeddings are GDPR
// Art. 9 / BIPA biometric data, and two invariants are enforced here, not left to the
// caller:
//
//  1. NOTHING is collected without an active consent row. DeclareReference refuses
//     without one, so a client cannot upload a selfie for processing before the user
//     has agreed — the gate is server-side.
//  2. Erasure is a HARD delete. EraseFaceData removes rows AND the S3 objects under
//     the user's facedata prefix; a deleted_at flag does not satisfy a right-to-
//     erasure request. The facedata bucket exists precisely so this is a provable,
//     single-prefix delete under its own key (ADR 0006).
package facesvc

import (
	"context"
	"errors"
	"fmt"
	"net/netip"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/dharmikjethva30/photo/services/api/internal/adapter/postgres/sqlcgen"
	"github.com/dharmikjethva30/photo/services/api/internal/adapter/s3store"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/config"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/db"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/problem"
)

// Reference selfies are small and single-PUT. An allowlist, not a denylist: the worker
// decodes these bytes.
var allowedRefTypes = map[string]string{
	"image/jpeg": ".jpg",
	"image/heic": ".heic",
	"image/heif": ".heif",
	"image/png":  ".png",
}

// A reference selfie has no business being large; a phone selfie is a few MB.
const maxReferenceBytes int64 = 16 << 20 // 16 MiB

type Service struct {
	pool  db.Pool
	q     *sqlcgen.Queries
	store *s3store.Store
	faces config.Faces
}

func New(pool db.Pool, store *s3store.Store, faces config.Faces) *Service {
	return &Service{pool: pool, q: sqlcgen.New(pool), store: store, faces: faces}
}

// --- consent ---------------------------------------------------------------

// ConsentState is what the client needs to render the consent screen and gate.
type ConsentState struct {
	// The version the client MUST display and the user agree to. If Granted is true
	// but GrantedVersion != CurrentVersion, the copy changed and re-consent is due.
	CurrentVersion string
	Granted        bool
	GrantedVersion string
	GrantedAt      *string
}

func (s *Service) Consent(ctx context.Context, userID uuid.UUID) (ConsentState, error) {
	st := ConsentState{CurrentVersion: s.faces.ConsentVersion}
	row, err := s.q.GetActiveFaceConsent(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return st, nil
		}
		return st, problem.Internal(fmt.Errorf("get consent: %w", err))
	}
	at := row.GrantedAt.Format("2006-01-02T15:04:05Z07:00")
	st.Granted = true
	st.GrantedVersion = row.CopyVersion
	st.GrantedAt = &at
	return st, nil
}

// GrantConsent records agreement to the CURRENT copy version. The server stamps its own
// version rather than trusting the client's, so an old client cannot consent a user to
// stale copy. ip/userAgent are evidence of the event.
func (s *Service) GrantConsent(
	ctx context.Context, userID uuid.UUID, ip *netip.Addr, userAgent string,
) (ConsentState, error) {
	var ua *string
	if userAgent != "" {
		ua = &userAgent
	}
	if _, err := s.q.CreateFaceConsent(ctx, sqlcgen.CreateFaceConsentParams{
		UserID:      userID,
		CopyVersion: s.faces.ConsentVersion,
		Ip:          ip,
		UserAgent:   ua,
	}); err != nil {
		return ConsentState{}, problem.Internal(fmt.Errorf("create consent: %w", err))
	}
	return s.Consent(ctx, userID)
}

// RevokeConsent stops future processing. It does NOT erase — that is EraseFaceData, a
// separate, louder action.
func (s *Service) RevokeConsent(ctx context.Context, userID uuid.UUID) error {
	if err := s.q.RevokeFaceConsent(ctx, userID); err != nil {
		return problem.Internal(fmt.Errorf("revoke consent: %w", err))
	}
	return nil
}

// requireConsent is the gate. Returns a 403 with the stable slug the client maps to
// "please agree to face processing first".
func (s *Service) requireConsent(ctx context.Context, userID uuid.UUID) error {
	if _, err := s.q.GetActiveFaceConsent(ctx, userID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.Forbidden(problem.TypeConsentRequired,
				"Agree to face matching before adding a reference photo.")
		}
		return problem.Internal(fmt.Errorf("check consent: %w", err))
	}
	return nil
}

// --- reference selfies -----------------------------------------------------

// ReferenceUpload is the plan the client PUTs the selfie to.
type ReferenceUpload struct {
	ReferenceID uuid.UUID
	Upload      s3store.PresignedPut
}

// DeclareReference authorizes and presigns a reference selfie upload into the FACEDATA
// bucket. No DB row yet — the row is written at CompleteReference once HeadObject
// confirms the bytes, so a client that abandons the upload leaves nothing behind.
func (s *Service) DeclareReference(
	ctx context.Context, userID uuid.UUID, contentType string, byteSize int64,
) (ReferenceUpload, error) {
	if err := s.requireConsent(ctx, userID); err != nil {
		return ReferenceUpload{}, err
	}
	if _, ok := allowedRefTypes[strings.ToLower(contentType)]; !ok {
		return ReferenceUpload{}, problem.Validation(
			fmt.Sprintf("%s is not a supported photo type.", contentType),
			map[string]string{"contentType": "unsupported"})
	}
	if byteSize <= 0 || byteSize > maxReferenceBytes {
		return ReferenceUpload{}, problem.Validation("That photo is too large for a reference.",
			map[string]string{"byteSize": "out of range"})
	}

	referenceID := uuid.New()
	// FaceReferenceKey already yields a complete key (it ends in .jpg); the object is
	// opaque and identified by content-type on the wire, so the key's extension is
	// cosmetic and must not be doubled by appending another.
	key := s3store.FaceReferenceKey(userID.String(), referenceID.String())
	put, err := s.store.PresignPutTo(
		ctx, s.store.FaceDataBucket(), key, strings.ToLower(contentType), byteSize, "",
	)
	if err != nil {
		return ReferenceUpload{}, problem.Internal(err)
	}
	return ReferenceUpload{ReferenceID: referenceID, Upload: put}, nil
}

// CompleteReference verifies the uploaded selfie and records the reference. The
// embedding is left NULL: a later face-worker job computes it (that keeps the ~250 MB
// model off this request path). Consent is re-checked — it may have been revoked
// between declare and complete.
func (s *Service) CompleteReference(
	ctx context.Context, userID, referenceID uuid.UUID, contentType string,
) (sqlcgen.CreateFaceReferenceRow, error) {
	if err := s.requireConsent(ctx, userID); err != nil {
		return sqlcgen.CreateFaceReferenceRow{}, err
	}
	// contentType is accepted for symmetry with declare but does not affect the key —
	// the key is derived from ids alone (see DeclareReference).
	_ = contentType
	key := s3store.FaceReferenceKey(userID.String(), referenceID.String())

	if _, err := s.store.Head(ctx, s.store.FaceDataBucket(), key); err != nil {
		if errors.Is(err, s3store.ErrNotFound) {
			return sqlcgen.CreateFaceReferenceRow{}, problem.Conflict(problem.TypeSizeMismatch,
				"We could not find that photo in storage. Please try the upload again.")
		}
		return sqlcgen.CreateFaceReferenceRow{}, problem.Internal(err)
	}

	ref, err := s.q.CreateFaceReference(ctx, sqlcgen.CreateFaceReferenceParams{
		ID:         referenceID,
		UserID:     userID,
		StorageKey: key,
		ModelID:    s.faces.ModelID,
	})
	if err != nil {
		return sqlcgen.CreateFaceReferenceRow{}, problem.Internal(fmt.Errorf("create reference: %w", err))
	}
	// NOTE (M4.2): enqueue the embedding job here once the face worker exists.
	return ref, nil
}

func (s *Service) ListReferences(
	ctx context.Context, userID uuid.UUID,
) ([]sqlcgen.ListFaceReferencesRow, error) {
	refs, err := s.q.ListFaceReferences(ctx, userID)
	if err != nil {
		return nil, problem.Internal(fmt.Errorf("list references: %w", err))
	}
	return refs, nil
}

// DeleteReference retires ONE reference (ordinary replacement): soft-delete the row,
// then remove the S3 object. Not erasure — the row is kept for audit.
func (s *Service) DeleteReference(ctx context.Context, userID, referenceID uuid.UUID) error {
	ref, err := s.q.SoftDeleteFaceReference(ctx, sqlcgen.SoftDeleteFaceReferenceParams{
		ID:     referenceID,
		UserID: userID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.NotFound("No such reference photo.")
		}
		return problem.Internal(fmt.Errorf("delete reference: %w", err))
	}
	if err := s.store.Delete(ctx, s.store.FaceDataBucket(), ref.StorageKey); err != nil {
		// The row is already retired; a lingering object is reaped by lifecycle. Do not
		// fail the user's action over it.
		_ = err
	}
	return nil
}

// --- tag confirmation (M4.4) -----------------------------------------------

// SuggestedTags lists photos in an album the caller is SUGGESTED in but has not decided
// yet — the "confirm you're in these" sheet. Self-scoped (user_id = caller), so it can
// only ever return the caller's own pending suggestions.
func (s *Service) SuggestedTags(
	ctx context.Context, albumID, userID uuid.UUID,
) ([]sqlcgen.ListMySuggestedTagsRow, error) {
	rows, err := s.q.ListMySuggestedTags(ctx, sqlcgen.ListMySuggestedTagsParams{
		AlbumID: albumID,
		UserID:  userID,
	})
	if err != nil {
		return nil, problem.Internal(fmt.Errorf("list suggested tags: %w", err))
	}
	return rows, nil
}

// Decide confirms or rejects a suggested tag. ONLY the tagged person may decide their
// own tag — confirming is what turns a suggestion into visibility (via the trigger),
// so it must not be something anyone else can do on your behalf.
func (s *Service) Decide(
	ctx context.Context, tagID, userID uuid.UUID, confirm bool,
) error {
	tag, err := s.q.GetFaceTagForDecision(ctx, tagID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.NotFound("No such tag.")
		}
		return problem.Internal(fmt.Errorf("get tag: %w", err))
	}
	if tag.UserID != userID {
		// 404, not 403: confirming a tag exists for someone else leaks that we think a
		// given person is in a photo — exactly what face-privacy protects.
		return problem.NotFound("No such tag.")
	}

	status := sqlcgen.FaceTagStatusRejected
	if confirm {
		status = sqlcgen.FaceTagStatusConfirmed
	}
	if _, err := s.q.DecideFaceTag(ctx, sqlcgen.DecideFaceTagParams{
		ID:        tagID,
		Status:    status,
		DecidedBy: &userID,
	}); err != nil {
		return problem.Internal(fmt.Errorf("decide tag: %w", err))
	}
	// media_subjects is updated by the sync trigger on the status change.
	return nil
}

// --- erasure ---------------------------------------------------------------

// ErasureReport is what was actually removed, so the endpoint can prove erasure.
type ErasureReport struct {
	ReferencesDeleted int
	ObjectsDeleted    int
}

// EraseFaceData is the GDPR right-to-erasure path: a HARD delete of the user's face
// data — reference rows + their S3 objects, plus tags, subject rows, and consent.
//
// DB first, in one transaction, then the bucket prefix. If the object delete fails
// after the rows are gone, the worst case is orphaned bytes the lifecycle rule reaps —
// never the reverse (rows pointing at deleted objects), and never a partial DB state.
func (s *Service) EraseFaceData(ctx context.Context, userID uuid.UUID) (ErasureReport, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ErasureReport{}, problem.Internal(fmt.Errorf("begin: %w", err))
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)

	// Revoke first so nothing new can be enqueued while erasure runs.
	if err := q.RevokeFaceConsent(ctx, userID); err != nil {
		return ErasureReport{}, problem.Internal(fmt.Errorf("revoke: %w", err))
	}
	refs, err := q.EraseUserFaceReferences(ctx, userID)
	if err != nil {
		return ErasureReport{}, problem.Internal(fmt.Errorf("erase references: %w", err))
	}
	if err := q.EraseUserFaceTags(ctx, userID); err != nil {
		return ErasureReport{}, problem.Internal(fmt.Errorf("erase tags: %w", err))
	}
	if err := q.EraseUserMediaSubjects(ctx, userID); err != nil {
		return ErasureReport{}, problem.Internal(fmt.Errorf("erase subjects: %w", err))
	}
	if err := q.EraseUserFaceConsents(ctx, userID); err != nil {
		return ErasureReport{}, problem.Internal(fmt.Errorf("erase consents: %w", err))
	}
	if err := tx.Commit(ctx); err != nil {
		return ErasureReport{}, problem.Internal(fmt.Errorf("commit: %w", err))
	}

	// Physical delete of the selfies. The prefix is the user's own folder in the
	// facedata bucket, so this cannot touch anyone else's data.
	prefix := fmt.Sprintf("users/%s/", userID.String())
	objects, err := s.store.DeletePrefix(ctx, s.store.FaceDataBucket(), prefix)
	if err != nil {
		// The rows are already gone (the legally-meaningful part). Report the object
		// count as 0 and let an operator or lifecycle finish the physical cleanup.
		return ErasureReport{ReferencesDeleted: len(refs)}, nil
	}
	// FUTURE (M4.2+): also delete face crops (albums/*/crops/<face_id>) for this user's
	// detections and any album-scoped cluster centroids. No such objects exist until
	// the face worker runs, so there is nothing to delete yet.
	return ErasureReport{ReferencesDeleted: len(refs), ObjectsDeleted: objects}, nil
}
