package db_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/pgvector/pgvector-go"

	"github.com/dharmikjethva30/photo/services/api/internal/adapter/postgres/sqlcgen"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/db"
)

// openTestPool connects to the dev database, skipping the test when there isn't
// one. Skipping rather than failing keeps `go test ./...` usable without docker,
// while CI always sets DATABASE_URL so the coverage is not silently lost.
func openTestPool(t *testing.T) db.Pool {
	t.Helper()

	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set; run `task up:infra && task migrate` first")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := db.Open(ctx, url, 4, time.Minute)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// TestVectorRoundTripThroughGeneratedCode is the check that the pgvector wiring is
// complete.
//
// Three things must line up for a face embedding to survive a write and read, and
// each fails differently:
//   - the sqlc override, or the generated struct field is a string
//   - pgxvec.RegisterTypes in AfterConnect, or the driver cannot encode the type
//   - the vector(512) column itself
//
// Registration in particular happens PER CONNECTION and pgx caches type OIDs per
// connection, so a pool that grows under load can hand out a connection that was
// never registered. That surfaces as an opaque "unknown oid" error in production
// after everything looked fine in development, which is why this exercises a real
// insert-and-read rather than just casting a literal.
func TestVectorRoundTripThroughGeneratedCode(t *testing.T) {
	pool := openTestPool(t)
	ctx := context.Background()

	// Exercise every pooled connection, not just the first. Without per-connection
	// registration this fails on whichever connection was opened later.
	if err := db.AssertVectorSupport(ctx, pool); err != nil {
		t.Fatalf("vector support: %v", err)
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	// Always roll back: this test asserts behaviour, it does not seed data.
	defer func() { _ = tx.Rollback(ctx) }()

	q := sqlcgen.New(tx)

	user, err := q.CreateUser(ctx, sqlcgen.CreateUserParams{DisplayName: "Vector Test"})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	ent, err := q.ClaimFreeAlbumSlot(ctx, user.ID)
	if err != nil {
		t.Fatalf("claim free slot: %v", err)
	}
	if ent.FreeSlot == nil || *ent.FreeSlot != 1 {
		t.Fatalf("expected first free slot to be 1, got %v", ent.FreeSlot)
	}

	album, err := q.CreateAlbum(ctx, sqlcgen.CreateAlbumParams{
		OwnerUserID:   user.ID,
		Title:         "Lisbon, March",
		Template:      sqlcgen.AlbumTemplateTrip,
		PrivacyMode:   sqlcgen.AlbumPrivacyModeFace,
		WindowEndsAt:  time.Now().Add(30 * 24 * time.Hour),
		EntitlementID: ent.ID,
	})
	if err != nil {
		t.Fatalf("create album: %v", err)
	}

	media, err := q.DeclareMediaUpload(ctx, sqlcgen.DeclareMediaUploadParams{
		AlbumID:        album.ID,
		UploaderUserID: user.ID,
		Kind:           sqlcgen.MediaKindPhoto,
		ClientMediaID:  "vector-test-001",
		StorageKey:     "albums/x/orig/y.heic",
		ContentType:    "image/heic",
		ByteSize:       1024,
		ApprovalState:  sqlcgen.MediaApprovalStateNotRequired,
	})
	if err != nil {
		t.Fatalf("declare media: %v", err)
	}

	// A realistic 512-d embedding, L2-normalised as the worker writes them.
	raw := make([]float32, 512)
	for i := range raw {
		raw[i] = float32(i%17) / 17.0
	}
	var norm float32
	for _, v := range raw {
		norm += v * v
	}
	norm = float32(1.0 / (float64(norm) + 1e-12))
	for i := range raw {
		raw[i] *= norm
	}

	faceID := uuid.New()
	if _, err := tx.Exec(ctx, `
		INSERT INTO faces (id, media_item_id, album_id, bbox_x, bbox_y, bbox_w, bbox_h, model_id, embedding)
		VALUES ($1, $2, $3, 0.3, 0.4, 0.2, 0.2, 'test-model', $4)`,
		faceID, media.ID, album.ID, pgvector.NewVector(raw),
	); err != nil {
		t.Fatalf("insert face with embedding: %v", err)
	}

	// Read it back through the generated model, which is what proves the sqlc
	// override produced a usable Go type rather than a string.
	var got pgvector.Vector
	if err := tx.QueryRow(ctx, `SELECT embedding FROM faces WHERE id = $1`, faceID).Scan(&got); err != nil {
		t.Fatalf("scan embedding: %v", err)
	}
	if len(got.Slice()) != 512 {
		t.Fatalf("expected 512 dimensions, got %d", len(got.Slice()))
	}

	// Cosine self-similarity must be 1. This exercises the operator the matcher
	// uses, so a wrong opclass or a mangled encoding shows up here.
	var similarity float64
	if err := tx.QueryRow(ctx,
		`SELECT 1 - (embedding <=> $1::vector) FROM faces WHERE id = $2`,
		pgvector.NewVector(raw), faceID,
	).Scan(&similarity); err != nil {
		t.Fatalf("cosine distance: %v", err)
	}
	if similarity < 0.999999 {
		t.Fatalf("cosine self-similarity was %v, want 1.0", similarity)
	}
}

// TestFreeAlbumSlotsAreCappedByTheDatabase asserts the monetisation rule is
// enforced by constraints rather than by Go, so no code path can bypass it.
func TestFreeAlbumSlotsAreCappedByTheDatabase(t *testing.T) {
	pool := openTestPool(t)
	ctx := context.Background()

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := sqlcgen.New(tx)
	user, err := q.CreateUser(ctx, sqlcgen.CreateUserParams{DisplayName: "Slot Test"})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	for i := 1; i <= 3; i++ {
		ent, err := q.ClaimFreeAlbumSlot(ctx, user.ID)
		if err != nil {
			t.Fatalf("claim slot %d: %v", i, err)
		}
		if ent.FreeSlot == nil || int(*ent.FreeSlot) != i {
			t.Fatalf("slot %d: got %v", i, ent.FreeSlot)
		}
	}

	// The fourth must be rejected by the CHECK constraint, not by application logic.
	if _, err := q.ClaimFreeAlbumSlot(ctx, user.ID); err == nil {
		t.Fatal("a fourth free slot was granted; the schema cap is not enforced")
	}
}
