// Package logging configures structured logging.
//
// JSON in deployed environments, human-readable locally. A request id is
// attached per request and carried on the context, so every line from one
// request can be correlated.
package logging

import (
	"context"
	"io"
	"os"
	"time"

	"github.com/rs/zerolog"
)

type ctxKey struct{}

// New builds the root logger. `pretty` selects console output over JSON.
func New(level string, pretty bool) zerolog.Logger {
	lvl, err := zerolog.ParseLevel(level)
	if err != nil || lvl == zerolog.NoLevel {
		lvl = zerolog.InfoLevel
	}

	var w io.Writer = os.Stdout
	if pretty {
		w = zerolog.ConsoleWriter{Out: os.Stdout, TimeFormat: time.RFC3339}
	}

	return zerolog.New(w).Level(lvl).With().Timestamp().Logger()
}

// WithContext stores a logger on the context.
func WithContext(ctx context.Context, l zerolog.Logger) context.Context {
	return context.WithValue(ctx, ctxKey{}, l)
}

// FromContext retrieves the request-scoped logger, or a disabled logger if none
// is present. Returning a usable logger rather than nil means call sites never
// need a nil check.
func FromContext(ctx context.Context) zerolog.Logger {
	if l, ok := ctx.Value(ctxKey{}).(zerolog.Logger); ok {
		return l
	}
	return zerolog.Nop()
}
