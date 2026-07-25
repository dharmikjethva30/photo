package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/dharmikjethva30/photo/services/api/internal/adapter/postgres/sqlcgen"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/config"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/db"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/problem"
)

// Session is what a successful sign-in or refresh returns.
type Session struct {
	AccessToken  string
	ExpiresAt    time.Time
	RefreshToken string
	UserID       uuid.UUID
	DisplayName  string
	IsNewUser    bool
}

type Service struct {
	pool       db.Pool
	q          *sqlcgen.Queries
	issuer     *TokenIssuer
	verifiers  map[string]IDTokenVerifier
	refreshTTL time.Duration
	env        config.Env
}

func NewService(
	ctx context.Context, cfg config.Config, pool db.Pool, issuer *TokenIssuer,
) (*Service, error) {
	verifiers := map[string]IDTokenVerifier{}

	if cfg.Env.IsLocal() {
		// Local and test only. Wiring this anywhere else would let anyone
		// authenticate as anyone, so it is gated on the environment rather than on
		// a feature flag that could be flipped.
		verifiers["apple"] = FakeVerifier{Provider: "apple"}
		verifiers["google"] = FakeVerifier{Provider: "google"}
	} else {
		apple, err := NewAppleVerifier(ctx, cfg.Auth.AppleBundleID, cfg.Auth.AppleServiceID)
		if err != nil {
			return nil, err
		}
		google, err := NewGoogleVerifier(ctx, cfg.Auth.GoogleClientIDs)
		if err != nil {
			return nil, err
		}
		verifiers["apple"] = apple
		verifiers["google"] = google
	}

	return &Service{
		pool:       pool,
		q:          sqlcgen.New(pool),
		issuer:     issuer,
		verifiers:  verifiers,
		refreshTTL: cfg.Auth.RefreshTokenTTL,
		env:        cfg.Env,
	}, nil
}

// SignInWithProvider exchanges a third-party ID token for our own session.
func (s *Service) SignInWithProvider(
	ctx context.Context, provider, rawIDToken, userAgent string,
) (Session, error) {
	v, ok := s.verifiers[provider]
	if !ok {
		return Session{}, problem.Validation(
			fmt.Sprintf("Unsupported sign-in provider %q.", provider), nil)
	}

	identity, err := v.Verify(ctx, rawIDToken)
	if err != nil {
		// The reason is logged, not returned: telling a caller precisely why a
		// token failed is a probing oracle.
		return Session{}, problem.Unauthorized("That sign-in could not be verified.").WithCause(err)
	}

	return s.establishSession(ctx, identity, userAgent)
}

// establishSession resolves an identity to a user, creating one on first sign-in,
// and issues a token pair. All in one transaction so a partially created account
// cannot exist.
func (s *Service) establishSession(
	ctx context.Context, identity Identity, userAgent string,
) (Session, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Session{}, problem.Internal(fmt.Errorf("begin tx: %w", err))
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := s.q.WithTx(tx)

	user, err := q.GetUserByProviderIdentity(ctx, sqlcgen.GetUserByProviderIdentityParams{
		Provider: sqlcgen.AuthProvider(identity.Provider),
		Subject:  identity.Subject,
	})

	isNew := false
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		isNew = true
		name := identity.Name
		if name == "" {
			// Apple only supplies a name on the very first authorization, and
			// never for a returning user re-linking. A placeholder keeps the
			// NOT NULL constraint satisfiable; onboarding asks for the real one.
			name = "New member"
		}
		var email *string
		if identity.Email != "" {
			email = &identity.Email
		}
		user, err = q.CreateUser(ctx, sqlcgen.CreateUserParams{DisplayName: name, Email: email})
		if err != nil {
			return Session{}, problem.Internal(fmt.Errorf("create user: %w", err))
		}
		if err := q.EnsureNotificationPrefs(ctx, user.ID); err != nil {
			return Session{}, problem.Internal(fmt.Errorf("create notification prefs: %w", err))
		}
	case err != nil:
		return Session{}, problem.Internal(fmt.Errorf("lookup identity: %w", err))
	}

	var email *string
	if identity.Email != "" {
		email = &identity.Email
	}
	if _, err := q.UpsertAuthIdentity(ctx, sqlcgen.UpsertAuthIdentityParams{
		UserID:   user.ID,
		Provider: sqlcgen.AuthProvider(identity.Provider),
		Subject:  identity.Subject,
		Email:    email,
	}); err != nil {
		return Session{}, problem.Internal(fmt.Errorf("upsert identity: %w", err))
	}

	// A new sign-in starts a new token family, so revoking one device's lineage
	// later does not sign the user out everywhere.
	session, err := s.mintTokens(ctx, q, user.ID, uuid.New(), userAgent)
	if err != nil {
		return Session{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Session{}, problem.Internal(fmt.Errorf("commit: %w", err))
	}

	session.DisplayName = user.DisplayName
	session.IsNewUser = isNew
	return session.Session, nil
}

// Refresh rotates a refresh token.
//
// THE IMPORTANT PART is reuse detection. A refresh token is single-use: presenting
// one that has already been rotated means either a replay or a stolen token, and
// the only safe response is to revoke the entire family — every token descended
// from that sign-in.
//
// This is also why the mobile client needs a single-flight refresh mutex: five
// concurrent 401s firing five refreshes would look exactly like an attack and log
// the user out. See docs/adr/0004.
func (s *Service) Refresh(ctx context.Context, rawRefresh, userAgent string) (Session, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Session{}, problem.Internal(fmt.Errorf("begin tx: %w", err))
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := s.q.WithTx(tx)

	stored, err := q.GetRefreshTokenByHash(ctx, HashToken(rawRefresh))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Session{}, problem.Unauthorized("Please sign in again.")
		}
		return Session{}, problem.Internal(fmt.Errorf("lookup refresh token: %w", err))
	}

	if stored.RevokedAt != nil {
		return Session{}, problem.Unauthorized("Please sign in again.")
	}
	if time.Now().After(stored.ExpiresAt) {
		return Session{}, problem.Unauthorized("Please sign in again.")
	}

	if stored.ReplacedBy != nil {
		// Reuse detected. Burn the whole family.
		if err := q.RevokeRefreshTokenFamily(ctx, stored.FamilyID); err != nil {
			return Session{}, problem.Internal(fmt.Errorf("revoke family: %w", err))
		}
		if err := tx.Commit(ctx); err != nil {
			return Session{}, problem.Internal(fmt.Errorf("commit revocation: %w", err))
		}
		return Session{}, problem.Unauthorized("Please sign in again.").
			WithCause(fmt.Errorf("refresh token reuse detected for family %s", stored.FamilyID))
	}

	session, err := s.mintTokens(ctx, q, stored.UserID, stored.FamilyID, userAgent)
	if err != nil {
		return Session{}, err
	}

	// Link the old token to its replacement, which is what makes the next
	// presentation of it detectable as reuse.
	if err := q.RotateRefreshToken(ctx, sqlcgen.RotateRefreshTokenParams{
		ID:         stored.ID,
		ReplacedBy: &session.refreshTokenID,
	}); err != nil {
		return Session{}, problem.Internal(fmt.Errorf("rotate: %w", err))
	}

	user, err := q.GetUserByID(ctx, stored.UserID)
	if err != nil {
		return Session{}, problem.Internal(fmt.Errorf("load user: %w", err))
	}

	if err := tx.Commit(ctx); err != nil {
		return Session{}, problem.Internal(fmt.Errorf("commit: %w", err))
	}

	session.DisplayName = user.DisplayName
	return session.Session, nil
}

// sessionWithID carries the new refresh row's id so Refresh can link the old one
// to it without a second lookup.
type sessionWithID struct {
	Session
	refreshTokenID uuid.UUID
}

func (s *Service) mintTokens(
	ctx context.Context, q *sqlcgen.Queries, userID, familyID uuid.UUID, userAgent string,
) (sessionWithID, error) {
	access, exp, err := s.issuer.IssueAccess(userID, UseAccess)
	if err != nil {
		return sessionWithID{}, problem.Internal(err)
	}

	refresh, err := NewRefreshToken()
	if err != nil {
		return sessionWithID{}, problem.Internal(err)
	}

	var ua *string
	if userAgent != "" {
		ua = &userAgent
	}

	row, err := q.CreateRefreshToken(ctx, sqlcgen.CreateRefreshTokenParams{
		UserID:      userID,
		TokenSha256: refresh.Hash,
		FamilyID:    familyID,
		ExpiresAt:   time.Now().Add(s.refreshTTL),
		UserAgent:   ua,
	})
	if err != nil {
		return sessionWithID{}, problem.Internal(fmt.Errorf("store refresh token: %w", err))
	}

	return sessionWithID{
		Session: Session{
			AccessToken:  access,
			ExpiresAt:    exp,
			RefreshToken: refresh.Raw,
			UserID:       userID,
		},
		refreshTokenID: row.ID,
	}, nil
}

// Logout revokes the presented token's whole family: signing out should end the
// session on that device, not just invalidate one short-lived token.
func (s *Service) Logout(ctx context.Context, rawRefresh string) error {
	stored, err := s.q.GetRefreshTokenByHash(ctx, HashToken(rawRefresh))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Already gone. Idempotent by design — a client retrying logout after a
			// dropped response should not see an error.
			return nil
		}
		return problem.Internal(fmt.Errorf("lookup refresh token: %w", err))
	}
	if err := s.q.RevokeRefreshTokenFamily(ctx, stored.FamilyID); err != nil {
		return problem.Internal(fmt.Errorf("revoke family: %w", err))
	}
	return nil
}

// VerifyAccessToken is what the bearer middleware calls.
func (s *Service) VerifyAccessToken(raw string) (uuid.UUID, error) {
	claims, err := s.issuer.VerifyAccess(raw)
	if err != nil {
		return uuid.Nil, problem.Unauthorized("Your session has expired.").WithCause(err)
	}
	if claims.TokenUse != UseAccess {
		// A scoped guest-upload token must never be accepted as a session.
		return uuid.Nil, problem.Unauthorized("That token cannot be used here.").
			WithCause(fmt.Errorf("token use %q is not %q", claims.TokenUse, UseAccess))
	}
	userID, err := uuid.Parse(claims.Subject)
	if err != nil {
		return uuid.Nil, problem.Unauthorized("Your session has expired.").WithCause(err)
	}
	return userID, nil
}

// JWKS is served at /.well-known/jwks.json.
func (s *Service) JWKS() map[string]any {
	return map[string]any{"keys": []map[string]any{s.issuer.PublicJWK()}}
}

// BearerFromRequest extracts the token, tolerating the common casings.
func BearerFromRequest(r *http.Request) string {
	const prefix = "Bearer "
	h := r.Header.Get("Authorization")
	if len(h) > len(prefix) && equalFold(h[:len(prefix)], prefix) {
		return h[len(prefix):]
	}
	return ""
}

func equalFold(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range len(a) {
		ca, cb := a[i], b[i]
		if 'A' <= ca && ca <= 'Z' {
			ca += 'a' - 'A'
		}
		if 'A' <= cb && cb <= 'Z' {
			cb += 'a' - 'A'
		}
		if ca != cb {
			return false
		}
	}
	return true
}
