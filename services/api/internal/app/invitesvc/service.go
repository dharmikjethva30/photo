// Package invitesvc owns album invites: minting shareable codes and turning an
// accepted code into album membership.
//
// The security model is docs/adr/0004's: a code carries NO authority on its own. It
// is a public, shareable identifier — anyone holding it can look up the album's name
// to decide whether to join, but joining requires a signed-in session, and access
// then comes from membership, never from the code. So codes are stored in clear and
// the sensitive step (accept) is fully authenticated.
package invitesvc

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/dharmikjethva30/photo/services/api/internal/adapter/postgres/sqlcgen"
	"github.com/dharmikjethva30/photo/services/api/internal/app/albumsvc"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/config"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/db"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/problem"
)

// codeAlphabet excludes 0/O/1/I/L and vowels: no ambiguous glyphs when a code is read
// off a screen or typed, and no accidental words. 8 chars over this 27-symbol set is
// ~38 bits — far beyond guessable for a value that grants nothing until accepted.
const codeAlphabet = "23456789BCDFGHJKMNPQRSTVWXYZ"

const codeLen = 8

// codeMintAttempts bounds retries when a generated code collides with the unique
// index. At 27^8 keyspace a collision is astronomically unlikely; the loop exists so
// a collision is a retry rather than a 500.
const codeMintAttempts = 5

type Service struct {
	pool   db.Pool
	q      *sqlcgen.Queries
	albums *albumsvc.Service
	limits config.Limits
}

func New(pool db.Pool, albums *albumsvc.Service, limits config.Limits) *Service {
	return &Service{pool: pool, q: sqlcgen.New(pool), albums: albums, limits: limits}
}

// allowedChannels mirrors the invite_channel enum. Validated here so a bad channel is
// a 400 with a clear message rather than a Postgres enum error surfaced as a 500.
var allowedChannels = map[string]sqlcgen.InviteChannel{
	"link":        sqlcgen.InviteChannelLink,
	"qr":          sqlcgen.InviteChannelQr,
	"contact":     sqlcgen.InviteChannelContact,
	"share_sheet": sqlcgen.InviteChannelShareSheet,
	"sms":         sqlcgen.InviteChannelSms,
}

type CreateInput struct {
	AlbumID   uuid.UUID
	UserID    uuid.UUID
	Channel   string
	MaxUses   *int32
	ExpiresAt *time.Time
}

// Create mints an invite for an album the caller is a member of.
func (s *Service) Create(ctx context.Context, in CreateInput) (sqlcgen.Invite, error) {
	// Membership check, reusing the album read path: a non-member gets 404, which is
	// the same non-leaking behaviour every album endpoint has.
	if _, err := s.albums.Get(ctx, in.AlbumID, in.UserID); err != nil {
		return sqlcgen.Invite{}, err
	}

	channel := sqlcgen.InviteChannelLink
	if in.Channel != "" {
		c, ok := allowedChannels[in.Channel]
		if !ok {
			return sqlcgen.Invite{}, problem.Validation(
				fmt.Sprintf("%q is not a valid invite channel.", in.Channel),
				map[string]string{"channel": "unsupported"})
		}
		channel = c
	}

	if in.MaxUses != nil && *in.MaxUses <= 0 {
		return sqlcgen.Invite{}, problem.Validation("maxUses must be positive.",
			map[string]string{"maxUses": "must be > 0"})
	}

	var lastErr error
	for range codeMintAttempts {
		code, err := mintCode()
		if err != nil {
			return sqlcgen.Invite{}, problem.Internal(err)
		}
		invite, err := s.q.CreateInvite(ctx, sqlcgen.CreateInviteParams{
			AlbumID:   in.AlbumID,
			CreatedBy: in.UserID,
			Code:      code,
			Channel:   channel,
			MaxUses:   in.MaxUses,
			ExpiresAt: in.ExpiresAt,
		})
		if err == nil {
			return invite, nil
		}
		if isUniqueViolation(err, "invites_code_uk") {
			lastErr = err
			continue // vanishingly rare; try another code
		}
		return sqlcgen.Invite{}, problem.Internal(fmt.Errorf("create invite: %w", err))
	}
	return sqlcgen.Invite{}, problem.Internal(fmt.Errorf("could not mint a unique code: %w", lastErr))
}

// List returns an album's live (non-revoked) invites, for the manage-invites screen.
func (s *Service) List(ctx context.Context, albumID, userID uuid.UUID) ([]sqlcgen.Invite, error) {
	if _, err := s.albums.Get(ctx, albumID, userID); err != nil {
		return nil, err
	}
	invites, err := s.q.ListAlbumInvites(ctx, albumID)
	if err != nil {
		return nil, problem.Internal(fmt.Errorf("list invites: %w", err))
	}
	return invites, nil
}

// Revoke deactivates an invite. Idempotent and scoped to an album the caller belongs
// to, so a revoked code stops working immediately.
func (s *Service) Revoke(ctx context.Context, albumID, inviteID, userID uuid.UUID) error {
	if _, err := s.albums.Get(ctx, albumID, userID); err != nil {
		return err
	}
	if _, err := s.q.RevokeInvite(ctx, sqlcgen.RevokeInviteParams{
		ID:      inviteID,
		AlbumID: albumID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.NotFound("No such invite.")
		}
		return problem.Internal(fmt.Errorf("revoke invite: %w", err))
	}
	return nil
}

// Preview is the public, unauthenticated view of an invite: just enough for the join
// landing to render before the user commits. Deliberately minimal — no member list,
// no media — because the holder of a code is not yet trusted with the album.
type Preview struct {
	Code         string
	AlbumID      uuid.UUID
	AlbumTitle   string
	PrivacyMode  string
	AlbumState   string
	CoverMediaID *uuid.UUID
	Valid        bool
	// Reason a code is unusable, for the landing copy: "revoked" | "expired" | "full".
	InvalidReason string
}

// Lookup resolves a code for the join landing. UNAUTHENTICATED: it returns only the
// public preview and never mutates. Whether the code can still be accepted is reported
// as a flag rather than an error, so the landing can say "this invite has expired"
// instead of showing a generic failure.
func (s *Service) Lookup(ctx context.Context, code string) (Preview, error) {
	row, err := s.q.GetInviteByCode(ctx, code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Preview{}, problem.NotFound("That invite link is not valid.")
		}
		return Preview{}, problem.Internal(fmt.Errorf("get invite: %w", err))
	}

	p := Preview{
		Code:         row.Code,
		AlbumID:      row.AlbumID,
		AlbumTitle:   row.AlbumTitle,
		PrivacyMode:  string(row.AlbumPrivacyMode),
		AlbumState:   string(row.AlbumState),
		CoverMediaID: row.AlbumCoverMediaID,
		Valid:        true,
	}
	switch {
	case row.RevokedAt != nil:
		p.Valid, p.InvalidReason = false, "revoked"
	case row.ExpiresAt != nil && row.ExpiresAt.Before(time.Now()):
		p.Valid, p.InvalidReason = false, "expired"
	case row.MaxUses != nil && row.UseCount >= *row.MaxUses:
		p.Valid, p.InvalidReason = false, "full"
	}
	return p, nil
}

// Accept turns a code into membership for the signed-in user.
//
// The whole operation is one transaction so the two facts that must agree — "a use was
// consumed" and "a member was added" — cannot diverge under a crash or a concurrent
// accept. Re-accepting when already a member is a no-op that consumes nothing, so a
// double-tap on "Join" does not burn a single-use invite.
func (s *Service) Accept(ctx context.Context, code string, userID uuid.UUID) (sqlcgen.Album, error) {
	row, err := s.q.GetInviteByCode(ctx, code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return sqlcgen.Album{}, problem.NotFound("That invite link is not valid.")
		}
		return sqlcgen.Album{}, problem.Internal(fmt.Errorf("get invite: %w", err))
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return sqlcgen.Album{}, problem.Internal(fmt.Errorf("begin: %w", err))
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)

	// Already a member: return the album without consuming a use. This is what makes
	// Accept safe to retry and safe to call from a deep link the user follows twice.
	if _, err := q.GetAlbumMember(ctx, sqlcgen.GetAlbumMemberParams{
		AlbumID: row.AlbumID,
		UserID:  userID,
	}); err == nil {
		album, gerr := q.GetAlbum(ctx, row.AlbumID)
		if gerr != nil {
			return sqlcgen.Album{}, problem.Internal(fmt.Errorf("get album: %w", gerr))
		}
		if cerr := tx.Commit(ctx); cerr != nil {
			return sqlcgen.Album{}, problem.Internal(fmt.Errorf("commit: %w", cerr))
		}
		return album, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return sqlcgen.Album{}, problem.Internal(fmt.Errorf("check membership: %w", err))
	}

	// The member cap is checked inside the transaction, against the current count, so a
	// burst of accepts cannot push an album past its limit.
	count, err := q.CountAlbumMembers(ctx, row.AlbumID)
	if err != nil {
		return sqlcgen.Album{}, problem.Internal(fmt.Errorf("count members: %w", err))
	}
	if int(count) >= s.limits.MaxAlbumMembers {
		return sqlcgen.Album{}, problem.Forbidden(problem.TypeMemberLimit,
			"This album has reached its member limit.")
	}

	// ConsumeInvite re-checks validity while locking the row: revoked/expired/spent all
	// return no row here, closing the gap between Lookup and Accept.
	if _, err := q.ConsumeInvite(ctx, row.ID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return sqlcgen.Album{}, problem.Conflict(problem.TypeInviteUnusable,
				"That invite link can no longer be used.")
		}
		return sqlcgen.Album{}, problem.Internal(fmt.Errorf("consume invite: %w", err))
	}

	if _, err := q.AddAlbumMember(ctx, sqlcgen.AddAlbumMemberParams{
		AlbumID: row.AlbumID,
		UserID:  userID,
		Role:    sqlcgen.AlbumMemberRoleMember,
	}); err != nil {
		return sqlcgen.Album{}, problem.Internal(fmt.Errorf("add member: %w", err))
	}

	// A new member changes who can see what — bump the generation that keys the
	// visibility cache path (docs/adr/0005).
	if err := q.BumpAlbumVisibilityGeneration(ctx, row.AlbumID); err != nil {
		return sqlcgen.Album{}, problem.Internal(fmt.Errorf("bump generation: %w", err))
	}

	album, err := q.GetAlbum(ctx, row.AlbumID)
	if err != nil {
		return sqlcgen.Album{}, problem.Internal(fmt.Errorf("get album: %w", err))
	}
	if err := tx.Commit(ctx); err != nil {
		return sqlcgen.Album{}, problem.Internal(fmt.Errorf("commit: %w", err))
	}
	return album, nil
}

// mintCode returns a random code over codeAlphabet using rejection sampling, so every
// symbol is equally likely (a plain byte % len would bias toward the first symbols).
func mintCode() (string, error) {
	out := make([]byte, codeLen)
	// A generous buffer of random bytes; refill if rejection sampling exhausts it.
	buf := make([]byte, codeLen*2)
	n := 0
	for i := 0; i < codeLen; {
		if n >= len(buf) {
			n = 0
		}
		if n == 0 {
			if _, err := rand.Read(buf); err != nil {
				return "", fmt.Errorf("read random: %w", err)
			}
		}
		b := buf[n]
		n++
		// 256 is not a multiple of 28, so bytes >= 252 (9*28) would bias the last four
		// symbols; reject them.
		if int(b) >= (256/len(codeAlphabet))*len(codeAlphabet) {
			continue
		}
		out[i] = codeAlphabet[int(b)%len(codeAlphabet)]
		i++
	}
	return string(out), nil
}

func isUniqueViolation(err error, constraint string) bool {
	var pgErr interface{ SQLState() string }
	if errors.As(err, &pgErr) && pgErr.SQLState() == "23505" {
		return true // a unique violation; good enough to trigger a code retry
	}
	_ = constraint
	return false
}
