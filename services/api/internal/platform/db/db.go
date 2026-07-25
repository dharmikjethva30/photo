// Package db owns the Postgres connection pool.
package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pgvector/pgvector-go"
	pgxvec "github.com/pgvector/pgvector-go/pgx"
)

// Pool is the interface the adapters depend on. Narrow on purpose: it is
// satisfied by both *pgxpool.Pool and a transaction wrapper, so a repository
// method works inside or outside a transaction without duplication.
type Pool = *pgxpool.Pool

// Open builds a pool and verifies it can actually serve queries.
//
// Registers pgvector's types on every new connection. This must happen per
// connection, not once globally: pgx caches type OIDs per connection, so a
// connection opened later without registration cannot scan a vector(512) column
// and fails with an opaque "unknown oid" error under load, after everything
// looked fine in development.
func Open(ctx context.Context, url string, maxConns int32, maxConnLife time.Duration) (Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}

	cfg.MaxConns = maxConns
	cfg.MaxConnLifetime = maxConnLife
	cfg.MaxConnIdleTime = 5 * time.Minute
	cfg.HealthCheckPeriod = 30 * time.Second

	cfg.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		if err := pgxvec.RegisterTypes(ctx, conn); err != nil {
			return fmt.Errorf("register pgvector types: %w", err)
		}
		return nil
	}

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	return pool, nil
}

// AssertVectorSupport confirms pgvector is installed AND usable, not merely that
// the extension row exists. A vector round-trip through the driver is the only
// check that also proves type registration worked.
func AssertVectorSupport(ctx context.Context, pool Pool) error {
	var out pgvector.Vector
	err := pool.QueryRow(ctx, `SELECT $1::vector`, pgvector.NewVector([]float32{1, 2, 3})).Scan(&out)
	if err != nil {
		return fmt.Errorf("pgvector round-trip failed (is the extension installed?): %w", err)
	}
	if len(out.Slice()) != 3 {
		return fmt.Errorf("pgvector round-trip returned %d dimensions, want 3", len(out.Slice()))
	}
	return nil
}
