// Package httpapi owns the HTTP surface: routing, middleware, and the mapping
// between domain errors and RFC 9457 problem documents.
//
// Handlers here are thin. They parse, delegate to internal/app, and render. No
// business rules and no SQL — see the depguard layering rule in .golangci.yml.
package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/rs/zerolog"

	"github.com/dharmikjethva30/photo/services/api/internal/platform/config"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/problem"
)

// Deps is everything the HTTP layer needs. Explicit rather than a service
// locator, so the compiler tells us what a new route depends on.
type Deps struct {
	Config   config.Config
	Logger   zerolog.Logger
	Health   HealthHandler
	Handlers *Handlers
}

func NewRouter(d Deps) http.Handler {
	r := chi.NewRouter()

	// NOTE: chi's middleware.RealIP is deliberately NOT used. It rewrites
	// r.RemoteAddr from X-Forwarded-For / True-Client-IP / X-Real-IP whether or
	// not our infrastructure actually sets them, so any client can spoof its own
	// IP (GHSA-3fxj-6jh8-hvhx). Rate limiting and abuse controls must not be
	// built on a spoofable value. When this sits behind a known proxy, add a
	// middleware that trusts only that proxy's header, at a known hop depth.
	r.Use(RequestLogger(d.Logger))
	r.Use(Recoverer)
	// Bounded request bodies. Media never flows through this API — clients PUT
	// directly to S3 — so any large body here is a mistake or an attack.
	r.Use(middleware.RequestSize(1 << 20)) // 1 MiB

	// Liveness and readiness sit outside /v1: they are operational, not product
	// API, and must not move when the API version does.
	r.Get("/healthz", d.Health.Healthz)
	r.Get("/readyz", d.Health.Readyz)

	h := d.Handlers
	// Published so a future service can verify our access tokens without sharing a
	// secret. Outside /v1 because the path is fixed by convention.
	r.Get("/.well-known/jwks.json", h.jwks)

	r.Route("/v1", func(r chi.Router) {
		// --- public ---------------------------------------------------------
		// Sign-in cannot require a session. Everything else does.
		r.Post("/auth/{provider}", h.signIn)
		r.Post("/auth/refresh", h.refresh)
		r.Post("/auth/logout", h.logout)

		// --- authenticated --------------------------------------------------
		r.Group(func(r chi.Router) {
			r.Use(h.RequireAuth)

			r.Get("/me", h.getMe)
			r.Patch("/me", h.updateMe)

			r.Route("/albums", func(r chi.Router) {
				r.Post("/", h.createAlbum)
				r.Get("/", h.listAlbums)

				r.Route("/{albumID}", func(r chi.Router) {
					r.Get("/", h.getAlbum)
					r.Get("/members", h.listAlbumMembers)
					r.Get("/media", h.albumFeed)
					r.Post("/uploads", h.declareUpload)
				})
			})

			r.Post("/uploads/{mediaID}/complete", h.completeUpload)

			// The stable image URL the feed hands out. Re-checks visibility, then
			// redirects to a short-lived presigned URL.
			r.Get("/media/{mediaID}/{rendition}", h.renditionRedirect)
		})

		r.NotFound(notFound)
		r.MethodNotAllowed(methodNotAllowed)
	})

	r.NotFound(notFound)
	r.MethodNotAllowed(methodNotAllowed)

	return r
}

func notFound(w http.ResponseWriter, r *http.Request) {
	respond(w, r, problem.NotFound("No such endpoint."))
}

func methodNotAllowed(w http.ResponseWriter, r *http.Request) {
	respond(w, r, problem.New(http.StatusMethodNotAllowed, "method_not_allowed",
		"That method is not supported on this endpoint."))
}
