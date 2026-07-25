// Command api serves the photu HTTP API.
package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/dharmikjethva30/photo/services/api/internal/adapter/s3store"
	"github.com/dharmikjethva30/photo/services/api/internal/httpapi"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/config"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/db"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/logging"
)

// version is stamped at build time: -ldflags "-X main.version=$(git rev-parse --short HEAD)"
var version = "dev"

func main() {
	if err := run(); err != nil {
		// Logging may not be up yet, so write plainly to stderr.
		fmt.Fprintf(os.Stderr, "fatal: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	log := logging.New(cfg.LogLevel, cfg.Env.IsLocal())
	log.Info().
		Str("env", string(cfg.Env)).
		Str("version", version).
		Int("port", cfg.Port).
		Str("public_base_url", cfg.PublicBaseURL).
		Msg("starting photu api")

	// Signal-aware context: cancelled on SIGINT/SIGTERM so startup work aborts
	// promptly rather than hanging a container shutdown.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.Open(ctx, cfg.DatabaseURL, cfg.DBMaxConns, cfg.DBMaxConnLife)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer pool.Close()

	// Fail fast if pgvector is missing or unusable. Discovering this when the
	// first face job runs would be far more confusing than refusing to start.
	if err := db.AssertVectorSupport(ctx, pool); err != nil {
		return err
	}
	log.Info().Msg("database ready (pgvector verified)")

	storage, err := s3store.New(ctx, cfg.S3)
	if err != nil {
		return fmt.Errorf("init s3: %w", err)
	}
	if err := storage.Ping(ctx); err != nil {
		// Not fatal: S3 may come up after the API, and /readyz already reports
		// this. Failing to boot would make the API's health depend on start order.
		log.Warn().Err(err).Msg("s3 not reachable at startup; /readyz will report not_ready")
	} else {
		log.Info().
			Str("media_bucket", cfg.S3.MediaBucket).
			Str("facedata_bucket", cfg.S3.FaceDataBucket).
			Msg("s3 ready")
	}

	handler := httpapi.NewRouter(httpapi.Deps{
		Config: cfg,
		Logger: log,
		Health: httpapi.HealthHandler{Pool: pool, Storage: storage, Version: version},
	})

	srv := &http.Server{
		Addr:    fmt.Sprintf(":%d", cfg.Port),
		Handler: handler,
		// Generous read timeout: clients on poor connections still need to
		// complete small JSON requests. Media bytes do not pass through here.
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       90 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		log.Info().Str("addr", srv.Addr).Msg("listening")
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		return fmt.Errorf("serve: %w", err)
	case <-ctx.Done():
		log.Info().Msg("shutdown signal received")
	}

	// Drain in-flight requests before exiting.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("graceful shutdown: %w", err)
	}
	log.Info().Msg("stopped cleanly")
	return nil
}
