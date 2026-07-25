// Package auth owns identity: verifying third-party ID tokens, issuing our own,
// and rotating refresh tokens. See docs/adr/0004-auth-token-model.md.
package auth

import (
	"crypto"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// Claims is our access token payload. Deliberately minimal: an access token is a
// bearer credential that may be logged by a proxy, so it carries an identifier and
// nothing else about the user.
type Claims struct {
	jwt.RegisteredClaims
	// TokenUse distinguishes an access token from a scoped guest token, so a
	// magic-link upload token can never be replayed as a full session.
	TokenUse string `json:"use"`
}

const (
	// UseAccess is a full user session.
	UseAccess = "access"
	// UseGuestUpload is a magic-link capability: it may declare and complete
	// uploads for ONE album and nothing else. Not a login.
	UseGuestUpload = "guest_upload"
)

// TokenIssuer signs and verifies access tokens.
//
// Ed25519 rather than HMAC: the public key can be published at
// /.well-known/jwks.json so a future service verifies tokens without sharing a
// secret with us.
type TokenIssuer struct {
	priv      ed25519.PrivateKey
	pub       ed25519.PublicKey
	keyID     string
	issuer    string
	accessTTL time.Duration
}

func NewTokenIssuer(privPEM, keyID, issuer string, accessTTL time.Duration) (*TokenIssuer, error) {
	priv, err := parseEd25519PrivateKeyPEM(privPEM)
	if err != nil {
		return nil, err
	}
	pub, ok := priv.Public().(ed25519.PublicKey)
	if !ok {
		return nil, errors.New("private key does not yield an ed25519 public key")
	}
	return &TokenIssuer{priv: priv, pub: pub, keyID: keyID, issuer: issuer, accessTTL: accessTTL}, nil
}

// GenerateDevKeyPEM produces a throwaway signing key for local development, so a
// developer never has to source a real one to run the app. Refuses to be useful in
// production by virtue of only being called from `task keys:dev`.
func GenerateDevKeyPEM() (string, error) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return "", fmt.Errorf("generate ed25519 key: %w", err)
	}
	der, err := marshalPKCS8(priv)
	if err != nil {
		return "", err
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})), nil
}

// IssueAccess mints a short-lived access token.
func (t *TokenIssuer) IssueAccess(userID uuid.UUID, use string) (string, time.Time, error) {
	now := time.Now()
	exp := now.Add(t.accessTTL)

	claims := Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID.String(),
			Issuer:    t.issuer,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(exp),
			// A unique id per token, so a specific token can be denylisted if that
			// ever becomes necessary without invalidating the whole family.
			ID: uuid.NewString(),
		},
		TokenUse: use,
	}

	tok := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
	tok.Header["kid"] = t.keyID

	signed, err := tok.SignedString(t.priv)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("sign access token: %w", err)
	}
	return signed, exp, nil
}

// VerifyAccess parses and validates one of our own tokens.
func (t *TokenIssuer) VerifyAccess(raw string) (*Claims, error) {
	parsed, err := jwt.ParseWithClaims(raw, &Claims{},
		func(_ *jwt.Token) (any, error) { return t.pub, nil },
		// Pin the algorithm. Without this, a token could claim "alg": "none" or a
		// symmetric algorithm and be verified against the public key as a secret —
		// the classic JWT algorithm-confusion attack.
		jwt.WithValidMethods([]string{jwt.SigningMethodEdDSA.Alg()}),
		jwt.WithIssuer(t.issuer),
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return nil, fmt.Errorf("verify access token: %w", err)
	}

	claims, ok := parsed.Claims.(*Claims)
	if !ok || !parsed.Valid {
		return nil, errors.New("invalid access token claims")
	}
	return claims, nil
}

// PublicJWK renders the verification key as a JWKS entry.
func (t *TokenIssuer) PublicJWK() map[string]any {
	return map[string]any{
		"kty": "OKP",
		"crv": "Ed25519",
		"use": "sig",
		"alg": "EdDSA",
		"kid": t.keyID,
		"x":   base64.RawURLEncoding.EncodeToString(t.pub),
	}
}

// --- refresh tokens --------------------------------------------------------

// RefreshToken is a freshly minted opaque credential.
type RefreshToken struct {
	// Raw goes to the client exactly once and is never stored.
	Raw string
	// Hash is what the database holds, so a dump yields no usable credential.
	Hash []byte
}

// NewRefreshToken mints 32 bytes of entropy.
//
// Opaque and random rather than a JWT: a refresh token must be revocable, and
// revoking a stateless token means maintaining a denylist anyway. Since state is
// unavoidable, an opaque token is simpler and leaks nothing if logged.
func NewRefreshToken() (RefreshToken, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return RefreshToken{}, fmt.Errorf("generate refresh token: %w", err)
	}
	raw := base64.RawURLEncoding.EncodeToString(buf)
	return RefreshToken{Raw: raw, Hash: HashToken(raw)}, nil
}

// HashToken is the at-rest representation of any bearer string we must be able to
// look up but must not be able to reproduce: refresh tokens, magic-link tokens,
// OTP codes.
func HashToken(raw string) []byte {
	sum := sha256.Sum256([]byte(raw))
	return sum[:]
}

// --- key helpers -----------------------------------------------------------

func parseEd25519PrivateKeyPEM(pemStr string) (ed25519.PrivateKey, error) {
	if pemStr == "" {
		return nil, errors.New("empty private key PEM (run `task keys:dev` for local development)")
	}
	// A PEM block is multi-line, but a dotenv value is one line — so the key is
	// stored with literal \n escapes and restored here. Without this the PEM decode
	// fails with the unhelpful "not valid PEM".
	pemStr = strings.ReplaceAll(pemStr, `\n`, "\n")

	block, _ := pem.Decode([]byte(pemStr))
	if block == nil {
		return nil, errors.New("private key is not valid PEM")
	}
	key, err := parsePKCS8(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse private key: %w", err)
	}
	priv, ok := key.(ed25519.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("expected an ed25519 private key, got %T", key)
	}
	return priv, nil
}

// Indirection so the crypto/x509 import stays in one place and the intent is
// explicit at the call sites above.
func parsePKCS8(der []byte) (crypto.PrivateKey, error)   { return x509ParsePKCS8(der) }
func marshalPKCS8(key crypto.PrivateKey) ([]byte, error) { return x509MarshalPKCS8(key) }
