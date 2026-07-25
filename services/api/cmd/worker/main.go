// Command worker runs photu's scheduled server-side jobs.
//
// These are the jobs nothing else can trigger: no client asks for them and no
// request is waiting on them. Right now that is upload reconciliation; album
// lifecycle transitions, notification fan-out and the retention sweeps join it in
// later milestones.
//
// It is a plain ticker loop, not riverqueue, deliberately. River earns its keep when
// jobs are *enqueued* by a transaction — that is what makes "job enqueued but the
// transaction rolled back" impossible — and none of these are. A cron does not need a
// queue. When the first transactionally-enqueued Go job lands (notification fan-out,
// M9), river goes in and these sweeps become river periodic jobs; the sweep functions
// themselves are already in internal/app so that move touches only this file.
//
// Safe to run more than one replica: every sweep takes a Postgres advisory lock, and
// the work each sweep does is idempotent regardless.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/dharmikjethva30/photo/services/api/internal/adapter/postgres"
	"github.com/dharmikjethva30/photo/services/api/internal/adapter/s3store"
	"github.com/dharmikjethva30/photo/services/api/internal/app/albumsvc"
	"github.com/dharmikjethva30/photo/services/api/internal/app/mediasvc"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/config"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/db"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/logging"
)

var version = "dev"

// Advisory lock keys. Arbitrary but must be stable and unique per job — two jobs
// sharing a key would serialize against each other for no reason.
const lockReconcileUploads int64 = 0x70686f7401 // "photu" + 01

// reconcileEvery is how often stalled uploads are swept.
//
// Tuned against reconcileOlderThan, not against urgency: an upload is only a
// candidate 30 minutes after it was declared, so checking more often than every few
// minutes just re-reads the same empty result set.
const (
	reconcileEvery     = 5 * time.Minute
	reconcileOlderThan = 30 * time.Minute
	reconcileBatch     = 100
)

var (
	// once runs every sweep a single time and exits. For ops (force a sweep now
	// without waiting for the tick) and for scripts/smoke-multipart.sh, which
	// needs a deterministic sweep rather than a race against a timer.
	once = flag.Bool("once", false, "run each job once and exit")
	// staleAfter overrides reconcileOlderThan. A sweep that only considers uploads
	// older than 30 minutes cannot be tested in a 30-second script otherwise.
	staleAfter = flag.Duration("stale-after", reconcileOlderThan,
		"how old a pending upload must be before it is reconciled")
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "fatal: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	log := logging.New(cfg.LogLevel, cfg.Env.IsLocal()).With().Str("component", "worker").Logger()
	log.Info().Str("env", string(cfg.Env)).Str("version", version).Msg("starting photu worker")

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.Open(ctx, cfg.DatabaseURL, cfg.DBMaxConns, cfg.DBMaxConnLife)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer pool.Close()

	storage, err := s3store.New(ctx, cfg.S3)
	if err != nil {
		return fmt.Errorf("init s3: %w", err)
	}

	visibility := postgres.NewVisibilityRepo(pool)
	albums := albumsvc.New(pool, visibility, cfg.Limit)
	media := mediasvc.New(pool, albums, storage, visibility, cfg.Limit)

	reconcile := func(ctx context.Context) error {
		return withAdvisoryLock(ctx, pool, lockReconcileUploads, func(ctx context.Context) error {
			n, err := media.ReconcileStalledUploads(ctx, *staleAfter, reconcileBatch)
			if err != nil {
				return err
			}
			if n > 0 {
				// Only logged when it did something. A line every 5 minutes saying
				// "0" trains people to ignore this logger.
				log.Info().Int("resolved", n).Msg("reconciled stalled uploads")
			}
			return nil
		})
	}

	if *once {
		log.Info().Dur("stale_after", *staleAfter).Msg("running one sweep")
		if err := reconcile(ctx); err != nil {
			return fmt.Errorf("reconcile: %w", err)
		}
		log.Info().Msg("sweep complete")
		return nil
	}

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		every(ctx, log, reconcileEvery, "reconcile_uploads", reconcile)
	}()

	<-ctx.Done()
	log.Info().Msg("shutdown signal received")
	wg.Wait()
	log.Info().Msg("stopped cleanly")
	return nil
}

// every runs fn on an interval until ctx is cancelled.
//
// It runs fn once immediately: a deploy or a crash-restart should not mean waiting a
// full interval before anything happens, and a restart loop is exactly when there is
// most likely to be a backlog.
func every(
	ctx context.Context, log zerolog.Logger, interval time.Duration,
	name string, fn func(context.Context) error,
) {
	run := func() {
		// Bounded, so a wedged sweep cannot stall the ticker forever.
		runCtx, cancel := context.WithTimeout(ctx, interval)
		defer cancel()
		start := time.Now()
		if err := fn(runCtx); err != nil {
			// Log and carry on. A failed sweep is not fatal — the next tick retries,
			// and exiting would turn a transient DB blip into a dead worker.
			log.Error().Err(err).Str("job", name).Dur("took", time.Since(start)).Msg("job failed")
		}
	}

	run()
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			run()
		}
	}
}

// withAdvisoryLock runs fn only if no other worker holds the lock.
//
// try, not wait: if another replica is already sweeping, the right move is to skip
// this tick, not to queue up behind it and then repeat work that was just done.
// The lock is session-scoped, so it is released by returning the connection to the
// pool even if fn panics.
func withAdvisoryLock(
	ctx context.Context, pool *pgxpool.Pool, key int64, fn func(context.Context) error,
) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire connection: %w", err)
	}
	defer conn.Release()

	var got bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, key).Scan(&got); err != nil {
		return fmt.Errorf("take advisory lock: %w", err)
	}
	if !got {
		return nil
	}
	defer func() {
		// Unlock on a fresh context: ctx is likely already cancelled during shutdown,
		// and leaving the lock held would make the next worker skip its first tick.
		unlockCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := conn.Exec(unlockCtx, `SELECT pg_advisory_unlock($1)`, key); err != nil {
			// Not worth failing the job over: the lock also dies with the session.
			_ = err
		}
	}()

	return fn(ctx)
}
