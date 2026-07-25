package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/dharmikjethva30/photo/services/api/internal/platform/logging"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/problem"
)

// RequestLogger attaches a request-scoped logger carrying a request id, and logs
// one line per completed request.
func RequestLogger(root zerolog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			reqID := r.Header.Get("X-Request-Id")
			if reqID == "" {
				reqID = uuid.NewString()
			}
			w.Header().Set("X-Request-Id", reqID)

			l := root.With().Str("request_id", reqID).Logger()
			ctx := logging.WithContext(r.Context(), l)

			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			start := time.Now()

			next.ServeHTTP(ww, r.WithContext(ctx))

			ev := l.Info()
			if ww.Status() >= 500 {
				ev = l.Error()
			} else if ww.Status() >= 400 {
				ev = l.Warn()
			}
			ev.Str("method", r.Method).
				Str("path", r.URL.Path).
				Int("status", ww.Status()).
				Int("bytes", ww.BytesWritten()).
				Dur("duration", time.Since(start)).
				Msg("request")
		})
	}
}

// Recoverer converts a panic into a 500 problem document rather than dropping
// the connection, and logs the stack.
func Recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				// http.ErrAbortHandler is the documented way to abandon a
				// response; suppressing it here would hide a deliberate abort.
				// errors.Is rather than ==, since the value may be wrapped.
				if err, ok := rec.(error); ok && errors.Is(err, http.ErrAbortHandler) {
					panic(rec)
				}
				// Addressable variable: zerolog's level methods take a pointer
				// receiver, so they cannot be chained off a function call.
				l := logging.FromContext(r.Context())
				l.Error().
					Interface("panic", rec).
					Bytes("stack", debugStack()).
					Msg("panic recovered")
				// Pass the panic value as the cause so it reaches the log even if
				// the stack line above is filtered out by log level.
				respond(w, r, problem.Internal(fmt.Errorf("panic: %v", rec)))
			}
		}()
		next.ServeHTTP(w, r)
	})
}
