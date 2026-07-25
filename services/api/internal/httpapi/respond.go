package httpapi

import (
	"net/http"

	"github.com/dharmikjethva30/photo/services/api/internal/platform/logging"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/problem"
)

// respond is the ONLY way handlers emit an error.
//
// It writes the problem document and logs it, because the two must not be
// separable: a *Problem carries an unexported cause that is deliberately not
// serialised to the client, so writing without logging silently discards the
// only record of why a 500 happened. Routing every error through here means that
// cannot be forgotten at a call site.
func respond(w http.ResponseWriter, r *http.Request, err error) {
	p := problem.Write(w, err)

	l := logging.FromContext(r.Context())
	if p.Status >= http.StatusInternalServerError {
		l.Error().Err(err).Str("type", p.Type).Int("status", p.Status).Msg("request failed")
		return
	}
	// Client errors are expected traffic, not incidents. Logged at debug so they
	// are available when investigating a specific client without flooding logs.
	l.Debug().Err(err).Str("type", p.Type).Int("status", p.Status).Msg("client error")
}
