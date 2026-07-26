// Package sharesvc owns the subject's controls over their own photos: the hide-me
// veto and the "show photos of me to X" allowlist grants (M5).
//
// The governing rule, enforced here rather than trusted from the client: only a person
// who is a CONFIRMED subject of a photo may hide it or share it. media_subjects is the
// same table the visibility predicate reads, so "may act" and "appears in" are the same
// fact — a caller who isn't in the photo gets 404, never a hint that the photo exists.
//
// Both the veto and grants take effect through the schema, not through app writes to
// the visibility state: hiding flips media_items.is_hidden via a trigger; a grant is a
// row the visibility predicate joins against. So this service only writes intent.
package sharesvc

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/dharmikjethva30/photo/services/api/internal/adapter/postgres/sqlcgen"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/db"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/problem"
)

// memberChecker is the album-membership gate, satisfied by the visibility repo.
type memberChecker interface {
	IsAlbumMember(ctx context.Context, albumID, userID uuid.UUID) (bool, error)
}

type Service struct {
	pool    db.Pool
	q       *sqlcgen.Queries
	members memberChecker
}

func New(pool db.Pool, members memberChecker) *Service {
	return &Service{pool: pool, q: sqlcgen.New(pool), members: members}
}

// mediaForAction loads the photo and asserts the caller is a confirmed subject of it.
// Returns the album id (grants and hides are album-scoped). 404 on anything else, so a
// non-subject learns nothing about the photo — the face-privacy stance end to end.
func (s *Service) mediaForAction(
	ctx context.Context, mediaID, callerID uuid.UUID,
) (uuid.UUID, error) {
	mi, err := s.q.GetMediaItem(ctx, mediaID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, problem.NotFound("No such photo.")
		}
		return uuid.Nil, problem.Internal(fmt.Errorf("get media: %w", err))
	}
	subject, err := s.q.IsMediaSubject(ctx, sqlcgen.IsMediaSubjectParams{
		MediaItemID: mediaID,
		UserID:      callerID,
	})
	if err != nil {
		return uuid.Nil, problem.Internal(fmt.Errorf("is subject: %w", err))
	}
	if !subject {
		return uuid.Nil, problem.NotFound("No such photo.")
	}
	return mi.AlbumID, nil
}

// --- hide-me veto ----------------------------------------------------------

// Hide records the caller's absolute veto on a photo they appear in. The trigger then
// removes the photo for every viewer (owner and photographer included); only the
// uploader keeps a private copy. Idempotent: re-hiding an undone veto reactivates it.
func (s *Service) Hide(ctx context.Context, mediaID, callerID uuid.UUID) error {
	albumID, err := s.mediaForAction(ctx, mediaID, callerID)
	if err != nil {
		return err
	}
	if _, err := s.q.HideMedia(ctx, sqlcgen.HideMediaParams{
		MediaItemID: mediaID,
		AlbumID:     albumID,
		UserID:      callerID,
	}); err != nil {
		return problem.Internal(fmt.Errorf("hide media: %w", err))
	}
	_ = s.q.BumpAlbumVisibilityGeneration(ctx, albumID)
	return nil
}

// Unhide lifts the caller's OWN veto. Only the subject who hid it can (query is scoped
// to their user id) — the owner cannot un-hide someone, and a veto survives the subject
// being removed from the album.
func (s *Service) Unhide(ctx context.Context, mediaID, callerID uuid.UUID) error {
	// No subject re-check: if the caller has an active hide, they are self-evidently a
	// subject, and scoping the UPDATE to their user id makes lifting another person's
	// veto impossible regardless.
	if _, err := s.q.UnhideMedia(ctx, sqlcgen.UnhideMediaParams{
		MediaItemID: mediaID,
		UserID:      callerID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.NotFound("You have no active hide on this photo.")
		}
		return problem.Internal(fmt.Errorf("unhide media: %w", err))
	}
	// Bump on a best-effort basis; the album id is cheap to look up but not required
	// for correctness (the trigger already fixed is_hidden).
	if mi, err := s.q.GetMediaItem(ctx, mediaID); err == nil {
		_ = s.q.BumpAlbumVisibilityGeneration(ctx, mi.AlbumID)
	}
	return nil
}

// --- allowlist grants ------------------------------------------------------

// GrantSingle shares one photo the caller appears in with another album member.
func (s *Service) GrantSingle(
	ctx context.Context, mediaID, grantorID, granteeID uuid.UUID,
) (uuid.UUID, error) {
	if grantorID == granteeID {
		return uuid.Nil, problem.New(400, "invalid_grant", "You cannot grant access to yourself.")
	}
	albumID, err := s.mediaForAction(ctx, mediaID, grantorID)
	if err != nil {
		return uuid.Nil, err
	}
	if err := s.requireMember(ctx, albumID, granteeID); err != nil {
		return uuid.Nil, err
	}
	id, err := s.q.CreateSingleGrant(ctx, sqlcgen.CreateSingleGrantParams{
		GrantorUserID: grantorID,
		GranteeUserID: granteeID,
		MediaItemID:   &mediaID,
		AlbumID:       albumID,
	})
	if err != nil {
		return uuid.Nil, problem.Internal(fmt.Errorf("create single grant: %w", err))
	}
	_ = s.q.BumpAlbumVisibilityGeneration(ctx, albumID)
	return id, nil
}

// GrantBulk shares every photo the caller appears in — now and in future — in an album
// with another member. The forward-looking scope is honoured by the visibility
// predicate joining grants→media_subjects at read time (ADR 0005).
func (s *Service) GrantBulk(
	ctx context.Context, albumID, grantorID, granteeID uuid.UUID,
) (uuid.UUID, error) {
	if grantorID == granteeID {
		return uuid.Nil, problem.New(400, "invalid_grant", "You cannot grant access to yourself.")
	}
	// Both parties must be members of the album the grant is scoped to.
	if err := s.requireMember(ctx, albumID, grantorID); err != nil {
		return uuid.Nil, err
	}
	if err := s.requireMember(ctx, albumID, granteeID); err != nil {
		return uuid.Nil, err
	}
	id, err := s.q.CreateBulkGrant(ctx, sqlcgen.CreateBulkGrantParams{
		GrantorUserID: grantorID,
		GranteeUserID: granteeID,
		AlbumID:       albumID,
	})
	if err != nil {
		return uuid.Nil, problem.Internal(fmt.Errorf("create bulk grant: %w", err))
	}
	_ = s.q.BumpAlbumVisibilityGeneration(ctx, albumID)
	return id, nil
}

// Revoke withdraws a grant the caller issued. Scoped to grantor, so you can only revoke
// your own grants.
func (s *Service) Revoke(ctx context.Context, grantID, callerID uuid.UUID) error {
	row, err := s.q.RevokeGrant(ctx, sqlcgen.RevokeGrantParams{
		ID:            grantID,
		GrantorUserID: callerID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.NotFound("No such grant.")
		}
		return problem.Internal(fmt.Errorf("revoke grant: %w", err))
	}
	_ = row
	return nil
}

// MyGrants lists the grants the caller has issued in an album.
func (s *Service) MyGrants(
	ctx context.Context, albumID, callerID uuid.UUID,
) ([]sqlcgen.ListMyGrantsRow, error) {
	if err := s.requireMember(ctx, albumID, callerID); err != nil {
		return nil, err
	}
	rows, err := s.q.ListMyGrants(ctx, sqlcgen.ListMyGrantsParams{
		GrantorUserID: callerID,
		AlbumID:       albumID,
	})
	if err != nil {
		return nil, problem.Internal(fmt.Errorf("list grants: %w", err))
	}
	return rows, nil
}

func (s *Service) requireMember(ctx context.Context, albumID, userID uuid.UUID) error {
	member, err := s.members.IsAlbumMember(ctx, albumID, userID)
	if err != nil {
		return problem.Internal(err)
	}
	if !member {
		return problem.NotFound("No such album member.")
	}
	return nil
}
