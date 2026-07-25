# ADR 0004 — Auth and token model

**Status:** accepted · **Date:** 2026-07-25

## Context

Sign in with Apple, Google, and phone number are all P0. There is also a
magic-link web upload flow for people with no account at all, and a browse-only
mode for invitees who have not signed in yet. Options considered: Firebase Auth,
Supabase Auth, or owning identity in Go.

## Decision

**Own it in Go.**

- Verify Apple and Google **ID tokens** against their JWKS endpoints (cached, with
  `kid` selection), checking `iss`, `aud`, `exp` and `nonce`. Upsert
  `users` + `auth_identities`.
- Issue our own **Ed25519 access JWT, 15-minute TTL**, with the public key served
  at `/.well-known/jwks.json`.
- **Refresh token = 32 random bytes**, stored SHA-256-hashed at rest, rotating on
  every use with **reuse detection**: each row records `replaced_by`, and
  presenting an already-rotated token revokes the whole family.
- Phone OTP sits behind an `SMSSender` port. The `fake` implementation logs the
  code and exposes `GET /v1/dev/otp/{phone}` **only when `APP_ENV=local`**.

Rejected **Firebase Auth**: least auth code and phone OTP works day one, but it
adds a Google dependency and a second source of user identity, and we would still
be writing the album/entitlement authorization layer ourselves. Rejected
**Supabase Auth**: fits the Postgres choice but pulls in its schema and another
container in local dev.

The deciding factor is that invite tokens and magic-link grants need to reuse the
same signing and revocation infrastructure. With a third-party IdP those become a
second, parallel token system.

## Why Ed25519 and 15 minutes

Ed25519 keeps tokens short and verification cheap, and publishing a JWKS means a
future second service can verify access tokens without a shared secret or a call
back to the API.

15 minutes is short enough that revocation lag is tolerable without maintaining a
denylist on the hot path, and long enough that refresh traffic stays low. The
refresh token is the long-lived credential, it is opaque, it is hashed at rest,
and it rotates — so a stolen database gives an attacker neither usable access
tokens nor usable refresh tokens.

## Client-side storage

| Token | Where | Why |
|---|---|---|
| Access | in memory (zustand) | never touches disk |
| Refresh | `expo-secure-store` | Keychain / Android Keystore |

The API client needs a **single-flight refresh mutex**. Without it, a screen that
fires five parallel requests on a cold start produces five concurrent 401s, five
concurrent refresh attempts, and the reuse detection above then revokes the user's
session — turning a correctness feature into a logout bug. This is the kind of
thing that only reproduces on slow networks.

## Guest and magic-link identities

- **Browse-only invitee** — resolves an invite token to a read path with no user.
  Under face-privacy such a viewer is never a subject and holds no grants, so they
  see only zero-people photos. That is correct, and the empty state must explain
  it, because it will otherwise be reported as a bug.
- **Magic-link uploader** — a scoped, single-purpose token exchanged for a
  short-lived access token that can *only* declare and complete uploads against
  one album, with a quota. It is not a login.

## Consequences

- We own the "delete account" path completely, which matters because it must also
  hard-delete biometric data (ADR 0005) and because the free-album ledger has to
  survive it (see `consumed_identity_ledger`).
- Apple's Hide My Email and phone-number recycling mean identity is fuzzier than
  it looks. Don't over-engineer anti-abuse against a £1.49 product.
- SMS delivery is a real cost and a real integration; the `fake` port keeps it out
  of the critical path until M9.
- Tests must not hit Google or Apple. JWKS verification is unit-tested against a
  locally generated keypair plus a canned JWKS document, with one manual
  real-token check.
