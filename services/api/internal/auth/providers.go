package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
)

// Identity is what a verified third-party ID token tells us.
type Identity struct {
	// Provider is 'apple' | 'google' | 'phone'.
	Provider string
	// Subject is the provider's stable `sub`. The only durable identifier —
	// notably, an Apple user with Hide My Email has a relay address that can
	// change, so email must never be the key.
	Subject string
	Email   string
	// Name is only ever supplied by Apple on the FIRST authorization. Treat a
	// blank one as normal, not an error.
	Name string
}

// IDTokenVerifier verifies a provider's ID token.
type IDTokenVerifier interface {
	Verify(ctx context.Context, rawIDToken string) (Identity, error)
}

const (
	appleIssuer  = "https://appleid.apple.com"
	googleIssuer = "https://accounts.google.com"
)

// oidcVerifier verifies against a provider's published JWKS.
//
// go-oidc handles the parts that are easy to get subtly wrong: fetching and
// caching the key set, selecting by `kid`, and checking iss/aud/exp/signature
// together rather than piecemeal.
type oidcVerifier struct {
	provider  string
	audiences []string
	verifier  *oidc.IDTokenVerifier
}

// NewAppleVerifier verifies Sign in with Apple tokens.
//
// Two audiences, because the same Apple account signs in from two places: the
// native app (audience = bundle id) and the web uploader (audience = service id).
func NewAppleVerifier(ctx context.Context, bundleID, serviceID string) (IDTokenVerifier, error) {
	auds := nonEmpty(bundleID, serviceID)
	if len(auds) == 0 {
		return nil, errors.New("apple verifier needs at least a bundle id")
	}
	return newOIDCVerifier(ctx, "apple", appleIssuer, auds)
}

// NewGoogleVerifier verifies Google ID tokens.
//
// Google issues a DIFFERENT client id per platform (iOS, Android, web), and all of
// them are legitimate audiences for the same account — so this takes a list. A
// verifier accepting only one would reject Android users on an iOS-configured
// build with a confusing "invalid audience".
func NewGoogleVerifier(ctx context.Context, clientIDs []string) (IDTokenVerifier, error) {
	auds := nonEmpty(clientIDs...)
	if len(auds) == 0 {
		return nil, errors.New("google verifier needs at least one client id")
	}
	return newOIDCVerifier(ctx, "google", googleIssuer, auds)
}

func newOIDCVerifier(ctx context.Context, name, issuer string, audiences []string) (IDTokenVerifier, error) {
	// Discovery happens once at startup. Failing here rather than on first sign-in
	// makes a misconfiguration obvious immediately.
	provider, err := oidc.NewProvider(ctx, issuer)
	if err != nil {
		return nil, fmt.Errorf("discover %s oidc config: %w", name, err)
	}

	cfg := &oidc.Config{
		// Checked manually below, because go-oidc accepts only one audience.
		SkipClientIDCheck: true,
		// Allow a second of clock skew; a phone's clock is not ours to trust.
		Now: time.Now,
	}

	return &oidcVerifier{
		provider:  name,
		audiences: audiences,
		verifier:  provider.Verifier(cfg),
	}, nil
}

func (v *oidcVerifier) Verify(ctx context.Context, raw string) (Identity, error) {
	tok, err := v.verifier.Verify(ctx, raw)
	if err != nil {
		return Identity{}, fmt.Errorf("verify %s id token: %w", v.provider, err)
	}

	// Audience is validated here rather than by go-oidc, which supports a single
	// client id. Any one of our platform client ids is acceptable; none is not.
	if !audienceMatches(tok.Audience, v.audiences) {
		return Identity{}, fmt.Errorf(
			"%s id token audience %v is not one of this app's client ids", v.provider, tok.Audience)
	}

	var claims struct {
		Email         string `json:"email"`
		EmailVerified any    `json:"email_verified"`
		Name          string `json:"name"`
	}
	if err := tok.Claims(&claims); err != nil {
		return Identity{}, fmt.Errorf("read %s claims: %w", v.provider, err)
	}

	return Identity{
		Provider: v.provider,
		Subject:  tok.Subject,
		Email:    claims.Email,
		Name:     claims.Name,
	}, nil
}

func audienceMatches(tokenAud, allowed []string) bool {
	for _, a := range tokenAud {
		for _, want := range allowed {
			if a == want {
				return true
			}
		}
	}
	return false
}

func nonEmpty(in ...string) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		if strings.TrimSpace(s) != "" {
			out = append(out, s)
		}
	}
	return out
}

// --- local development -----------------------------------------------------

// FakeVerifier accepts any token and echoes it back as the subject, so local
// development and the smoke script can sign in without Apple or Google
// credentials.
//
// It is wired ONLY when APP_ENV is local or test — see NewService. Reaching it in
// any other environment would mean anyone can authenticate as anyone.
type FakeVerifier struct{ Provider string }

func (f FakeVerifier) Verify(_ context.Context, raw string) (Identity, error) {
	if strings.TrimSpace(raw) == "" {
		return Identity{}, errors.New("fake verifier requires a non-empty token to use as the subject")
	}
	return Identity{
		Provider: f.Provider,
		Subject:  "fake:" + raw,
		Email:    raw + "@example.test",
		Name:     raw,
	}, nil
}
