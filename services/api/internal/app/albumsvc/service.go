// Package albumsvc holds album use cases: creation (which consumes an
// entitlement), membership, and the feed.
package albumsvc

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/dharmikjethva30/photo/services/api/internal/adapter/postgres"
	"github.com/dharmikjethva30/photo/services/api/internal/adapter/postgres/sqlcgen"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/config"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/db"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/problem"
)

// Occasion templates and their default upload-window lengths, from the spec.
var templateWindows = map[sqlcgen.AlbumTemplate]time.Duration{
	sqlcgen.AlbumTemplateTrip:     30 * 24 * time.Hour,
	sqlcgen.AlbumTemplateWedding:  14 * 24 * time.Hour,
	sqlcgen.AlbumTemplateDinner:   3 * 24 * time.Hour,
	sqlcgen.AlbumTemplateBirthday: 7 * 24 * time.Hour,
	sqlcgen.AlbumTemplateFamily:   60 * 24 * time.Hour,
	sqlcgen.AlbumTemplateOther:    30 * 24 * time.Hour,
}

// DefaultWindow is the spec's headline: a 30-day window, presented as a feature.
const DefaultWindow = 30 * 24 * time.Hour

type Service struct {
	pool       db.Pool
	q          *sqlcgen.Queries
	visibility *postgres.VisibilityRepo
	limits     config.Limits
}

func New(pool db.Pool, visibility *postgres.VisibilityRepo, limits config.Limits) *Service {
	return &Service{pool: pool, q: sqlcgen.New(pool), visibility: visibility, limits: limits}
}

type CreateInput struct {
	OwnerUserID uuid.UUID
	Title       string
	Template    sqlcgen.AlbumTemplate
	PrivacyMode sqlcgen.AlbumPrivacyMode
	// WindowEndsAt is optional; the template's default is used when zero.
	WindowEndsAt time.Time
}

// CreateInputFrom builds a CreateInput from wire strings.
//
// The string-to-enum conversion lives here rather than in the HTTP handler so the
// set of valid templates and privacy modes is owned by the service. Invalid values
// pass through unchanged and are rejected by Create's validation, which keeps the
// error message in one place.
func CreateInputFrom(ownerID uuid.UUID, title, template, privacyMode string) CreateInput {
	return CreateInput{
		OwnerUserID: ownerID,
		Title:       title,
		Template:    sqlcgen.AlbumTemplate(template),
		PrivacyMode: sqlcgen.AlbumPrivacyMode(privacyMode),
	}
}

// Create makes an album, consuming exactly one entitlement.
//
// The whole thing is one transaction: an album that exists without having consumed
// an entitlement would be a free album, and an entitlement consumed without an
// album would be a lost purchase.
func (s *Service) Create(ctx context.Context, in CreateInput) (sqlcgen.Album, error) {
	if in.Title == "" {
		return sqlcgen.Album{}, problem.Validation("An album needs a name.",
			map[string]string{"title": "required"})
	}
	if _, ok := templateWindows[in.Template]; !ok {
		return sqlcgen.Album{}, problem.Validation(
			fmt.Sprintf("Unknown occasion template %q.", in.Template), nil)
	}

	endsAt := in.WindowEndsAt
	if endsAt.IsZero() {
		endsAt = time.Now().Add(templateWindows[in.Template])
	}
	if !endsAt.After(time.Now()) {
		return sqlcgen.Album{}, problem.Validation("The upload window must end in the future.",
			map[string]string{"windowEndsAt": "must be in the future"})
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return sqlcgen.Album{}, problem.Internal(fmt.Errorf("begin: %w", err))
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := s.q.WithTx(tx)

	entitlement, err := s.claimEntitlement(ctx, q, in.OwnerUserID)
	if err != nil {
		return sqlcgen.Album{}, err
	}

	album, err := q.CreateAlbum(ctx, sqlcgen.CreateAlbumParams{
		OwnerUserID:   in.OwnerUserID,
		Title:         in.Title,
		Template:      in.Template,
		PrivacyMode:   in.PrivacyMode,
		WindowEndsAt:  endsAt,
		EntitlementID: entitlement.ID,
	})
	if err != nil {
		return sqlcgen.Album{}, problem.Internal(fmt.Errorf("create album: %w", err))
	}

	// The creator is the owner AND a member: membership is what the visibility
	// predicate joins on, so an owner who is not a member would see nothing in
	// their own album.
	if _, err := q.AddAlbumMember(ctx, sqlcgen.AddAlbumMemberParams{
		AlbumID: album.ID,
		UserID:  in.OwnerUserID,
		Role:    sqlcgen.AlbumMemberRoleOwner,
	}); err != nil {
		return sqlcgen.Album{}, problem.Internal(fmt.Errorf("add owner as member: %w", err))
	}

	if err := tx.Commit(ctx); err != nil {
		return sqlcgen.Album{}, problem.Internal(fmt.Errorf("commit: %w", err))
	}
	return album, nil
}

// claimEntitlement finds an already-paid-for entitlement, or claims a free slot.
//
// A unique-violation here is not an error to surface: it means a concurrent request
// took the same free slot, which is precisely the database enforcing the cap. It is
// reported as "you are out of free albums", because by the time the loser retries
// either a slot exists or it genuinely does not.
func (s *Service) claimEntitlement(
	ctx context.Context, q *sqlcgen.Queries, userID uuid.UUID,
) (sqlcgen.AlbumEntitlement, error) {
	// An unconsumed purchase always wins: the user paid, so spend that before a
	// free slot.
	existing, err := q.GetUnconsumedEntitlement(ctx, userID)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return sqlcgen.AlbumEntitlement{}, problem.Internal(fmt.Errorf("find entitlement: %w", err))
	}

	claimed, err := q.ClaimFreeAlbumSlot(ctx, userID)
	if err == nil {
		return claimed, nil
	}

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		// 23505 unique_violation — a concurrent request took this slot.
		// 23514 check_violation — all three lifetime slots are gone.
		if pgErr.Code == "23505" || pgErr.Code == "23514" {
			return sqlcgen.AlbumEntitlement{}, problem.PaymentRequired(
				problem.TypeFreeAlbumsUsed,
				"You have used all three free albums. The next one is a one-time purchase.",
			).WithCause(err)
		}
	}
	return sqlcgen.AlbumEntitlement{}, problem.Internal(fmt.Errorf("claim free slot: %w", err))
}

// ProcessingCount reports how many items in the album are uploaded but not yet
// viewable, so the client knows whether to keep polling.
func (s *Service) ProcessingCount(ctx context.Context, albumID uuid.UUID) (int64, error) {
	n, err := s.q.CountProcessingMedia(ctx, albumID)
	if err != nil {
		return 0, problem.Internal(fmt.Errorf("count processing media: %w", err))
	}
	return n, nil
}

// Get returns an album the viewer is a member of.
func (s *Service) Get(ctx context.Context, albumID, viewerID uuid.UUID) (sqlcgen.Album, error) {
	member, err := s.visibility.IsAlbumMember(ctx, albumID, viewerID)
	if err != nil {
		return sqlcgen.Album{}, problem.Internal(err)
	}
	if !member {
		// 404 rather than 403: confirming an album exists to a non-member leaks
		// that someone they know is in an album, which is the kind of thing
		// face-privacy exists to prevent.
		return sqlcgen.Album{}, problem.NotFound("No such album.")
	}

	album, err := s.q.GetAlbum(ctx, albumID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return sqlcgen.Album{}, problem.NotFound("No such album.")
		}
		return sqlcgen.Album{}, problem.Internal(fmt.Errorf("get album: %w", err))
	}
	return album, nil
}

// List returns the viewer's library.
func (s *Service) List(ctx context.Context, userID uuid.UUID, limit int32) ([]sqlcgen.Album, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	albums, err := s.q.ListAlbumsForUser(ctx, sqlcgen.ListAlbumsForUserParams{
		UserID: userID,
		Limit:  limit,
	})
	if err != nil {
		return nil, problem.Internal(fmt.Errorf("list albums: %w", err))
	}
	return albums, nil
}

// Members lists active members, for the album header's avatar stack.
func (s *Service) Members(
	ctx context.Context, albumID, viewerID uuid.UUID,
) ([]sqlcgen.ListAlbumMembersRow, error) {
	member, err := s.visibility.IsAlbumMember(ctx, albumID, viewerID)
	if err != nil {
		return nil, problem.Internal(err)
	}
	if !member {
		return nil, problem.NotFound("No such album.")
	}
	rows, err := s.q.ListAlbumMembers(ctx, albumID)
	if err != nil {
		return nil, problem.Internal(fmt.Errorf("list members: %w", err))
	}
	return rows, nil
}

// Feed is the album grid, filtered by the shared visibility predicate.
func (s *Service) Feed(
	ctx context.Context,
	albumID, viewerID uuid.UUID,
	filter postgres.FeedFilter,
	grouping postgres.FeedGrouping,
	cursor *postgres.Cursor,
	limit int32,
) ([]postgres.FeedItem, *postgres.Cursor, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	// No explicit membership check: visibilityCTE joins album_members, so a
	// non-member gets an empty page structurally.
	return s.visibility.Feed(ctx, albumID, viewerID, filter, grouping, cursor, limit)
}

// CanUpload reports whether the album currently accepts uploads.
func (s *Service) CanUpload(ctx context.Context, albumID, userID uuid.UUID) (sqlcgen.Album, error) {
	album, err := s.Get(ctx, albumID, userID)
	if err != nil {
		return sqlcgen.Album{}, err
	}
	if album.State != sqlcgen.AlbumStateActive {
		return sqlcgen.Album{}, problem.Forbidden(problem.TypeAlbumLocked,
			"This album is locked. It is a keepsake now.")
	}
	if time.Now().After(album.WindowEndsAt) {
		// The window has passed but the scheduled job has not run yet. Refuse on the
		// timestamp rather than the state, so the boundary does not depend on job
		// latency.
		return sqlcgen.Album{}, problem.Forbidden(problem.TypeUploadWindowShut,
			"The upload window for this album has closed.")
	}

	count, err := s.q.CountAlbumMembers(ctx, albumID)
	if err != nil {
		return sqlcgen.Album{}, problem.Internal(fmt.Errorf("count members: %w", err))
	}
	if int(count) > s.limits.MaxAlbumMembers {
		return sqlcgen.Album{}, problem.Forbidden(problem.TypeMemberLimit,
			"This album has reached its member limit.")
	}
	return album, nil
}
