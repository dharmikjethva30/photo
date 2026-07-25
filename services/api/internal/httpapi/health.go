package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/dharmikjethva30/photo/services/api/internal/platform/db"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/logging"
)

// Prober reports whether a dependency is usable.
type Prober interface {
	Ping(ctx context.Context) error
}

// HealthHandler serves liveness and readiness.
//
// The distinction matters operationally: /healthz answers "is this process
// alive" (so an orchestrator does not restart a pod because its database blipped),
// while /readyz answers "can this process serve traffic" and therefore checks
// real dependencies.
type HealthHandler struct {
	Pool    db.Pool
	Storage Prober
	Version string
}

// Healthz is liveness. Deliberately checks nothing external.
func (h HealthHandler) Healthz(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok", "version": h.Version})
}

// Readyz verifies the database AND S3 with real calls.
//
// Real calls, not cached flags: the point is to catch a misconfigured S3
// endpoint or a path-style mistake at startup rather than on the first upload
// from a device. This is also the first thing that proves the two-client S3
// wiring resolves.
func (h HealthHandler) Readyz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	checks := map[string]string{}
	ready := true

	if err := h.Pool.Ping(ctx); err != nil {
		checks["postgres"] = err.Error()
		ready = false
	} else {
		checks["postgres"] = "ok"
	}

	if err := h.Storage.Ping(ctx); err != nil {
		checks["s3"] = err.Error()
		ready = false
	} else {
		checks["s3"] = "ok"
	}

	status := http.StatusOK
	if !ready {
		status = http.StatusServiceUnavailable
		// zerolog's level methods have pointer receivers, so the logger must be
		// held in an addressable variable rather than chained off the call.
		l := logging.FromContext(r.Context())
		l.Warn().Interface("checks", checks).Msg("readiness check failed")
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":  map[bool]string{true: "ready", false: "not_ready"}[ready],
		"version": h.Version,
		"checks":  checks,
	})
}
