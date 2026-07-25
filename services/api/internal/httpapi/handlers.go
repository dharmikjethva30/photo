package httpapi

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/google/uuid"

	"github.com/dharmikjethva30/photo/services/api/internal/adapter/postgres/sqlcgen"
	"github.com/dharmikjethva30/photo/services/api/internal/app/albumsvc"
	"github.com/dharmikjethva30/photo/services/api/internal/app/invitesvc"
	"github.com/dharmikjethva30/photo/services/api/internal/app/mediasvc"
	"github.com/dharmikjethva30/photo/services/api/internal/auth"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/config"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/logging"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/problem"
)

// Handlers holds the services the HTTP layer delegates to. Explicit dependencies
// rather than a locator, so the compiler says what a new route needs.
type Handlers struct {
	Config  config.Config
	Auth    *auth.Service
	Albums  *albumsvc.Service
	Media   *mediasvc.Service
	Invites *invitesvc.Service
	// Queries backs the few endpoints that are genuinely a single read with no
	// business rule attached (the profile). Anything with a rule belongs in a
	// service — see the depguard rule keeping pgxpool out of this package.
	Queries *sqlcgen.Queries
}

// Users exposes the plain query set, named so call sites read as intent rather
// than as reaching into the database from a handler.
func (h *Handlers) Users() *sqlcgen.Queries { return h.Queries }

// --- authenticated request context -----------------------------------------

type userIDKey struct{}

// RequireAuth verifies the bearer token and puts the user id on the context.
func (h *Handlers) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw := auth.BearerFromRequest(r)
		if raw == "" {
			respond(w, r, problem.Unauthorized("Sign in to continue."))
			return
		}

		userID, err := h.Auth.VerifyAccessToken(raw)
		if err != nil {
			respond(w, r, err)
			return
		}

		// Bind the user to the request logger, so every subsequent line is
		// attributable without threading the id through call sites.
		l := logging.FromContext(r.Context()).With().Str("user_id", userID.String()).Logger()
		ctx := logging.WithContext(context.WithValue(r.Context(), userIDKey{}, userID), l)

		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// userID reads the authenticated user. Panicking rather than returning an error is
// correct here: reaching a handler without RequireAuth is a routing bug, and a
// silent uuid.Nil would be a serious authorization hole — every query would run as
// "the nil user" and quietly return nothing, or worse.
func userID(r *http.Request) uuid.UUID {
	id, ok := r.Context().Value(userIDKey{}).(uuid.UUID)
	if !ok {
		panic("httpapi: handler requires authentication but is not behind RequireAuth")
	}
	return id
}

// respondJSON writes a successful JSON response.
func respondJSON(w http.ResponseWriter, r *http.Request, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		// The status line is already sent, so the response cannot be corrected.
		// A serialisation failure here is a bug in a response type.
		l := logging.FromContext(r.Context())
		l.Error().Err(err).Msg("failed to encode response body")
	}
}

// parseUUIDParam turns a path parameter into a uuid, reporting a 404 rather than a
// 400 for a malformed one: an unparseable id cannot name a resource, and 404 avoids
// distinguishing "invalid" from "not yours".
func parseUUIDParam(raw, name string) (uuid.UUID, error) {
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, problem.NotFound("No such " + name + ".").WithCause(err)
	}
	return id, nil
}
