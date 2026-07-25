package postgres_test

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/dharmikjethva30/photo/services/api/internal/adapter/postgres"
	"github.com/dharmikjethva30/photo/services/api/internal/domain/access"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/db"
)

// This is the load-bearing test of the whole codebase.
//
// There are two implementations of the visibility rule — the SQL predicate in
// visibility.go and the pure-Go mirror in internal/domain/access — and two
// implementations that are never compared are worse than one. This test drives
// BOTH over the same fixture matrix and asserts they agree on every cell.
//
// Matrix: 3 privacy modes × 8 viewer roles × 6 media states.
//
// If you change either implementation, this is what tells you the other still
// agrees. See docs/adr/0005.

type fixtureUsers struct {
	owner       uuid.UUID // album owner; sees the creator-review queue
	uploader    uuid.UUID // uploaded most of the media
	subject     uuid.UUID // has a CONFIRMED tag on one photo
	other       uuid.UUID // member who appears in nothing
	granteeOne  uuid.UUID // holds a single-photo grant from `subject`
	granteeBulk uuid.UUID // holds an all-photos-of-grantor grant from `subject`
	noFaceRef   uuid.UUID // member who never uploaded a face reference
	nonMember   uuid.UUID // not in the album at all
}

type fixtureMedia struct {
	withSubject     uuid.UUID // ready, one confirmed subject
	noPeople        uuid.UUID // ready, zero faces, processing DONE
	unprocessed     uuid.UUID // ready, zero faces, processing QUEUED — must fail closed
	hidden          uuid.UUID // ready, one subject, vetoed by that subject
	pendingApproval uuid.UUID // ready, awaiting creator review
	notReady        uuid.UUID // state = uploaded, no renditions yet
}

type fixture struct {
	albumID uuid.UUID
	mode    access.PrivacyMode
	users   fixtureUsers
	media   fixtureMedia
	grants  []access.Grant
}

func openPool(t *testing.T) *pgxpool.Pool {
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

// mkUser creates a user with a unique name so parallel runs cannot collide.
func mkUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, label string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(ctx,
		`INSERT INTO users (display_name) VALUES ($1) RETURNING id`,
		fmt.Sprintf("%s-%s", label, uuid.NewString()[:8]),
	).Scan(&id)
	if err != nil {
		t.Fatalf("create user %s: %v", label, err)
	}
	return id
}

func mkMedia(
	t *testing.T, ctx context.Context, pool *pgxpool.Pool,
	albumID, uploader uuid.UUID, clientID, state, approval string,
) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(ctx, `
		INSERT INTO media_items (
		  album_id, uploader_user_id, kind, state, approval_state, client_media_id,
		  storage_key, content_type, byte_size, capture_time
		) VALUES ($1, $2, 'photo', $3::media_state, $4::media_approval_state, $5,
		          'k/' || $5, 'image/jpeg', 1024, now())
		RETURNING id`,
		albumID, uploader, state, approval, clientID,
	).Scan(&id)
	if err != nil {
		t.Fatalf("create media %s: %v", clientID, err)
	}
	return id
}

// addConfirmedSubject inserts a face plus a CONFIRMED tag, which is what the
// trigger turns into a media_subjects row. Going through the real tables rather
// than inserting into media_subjects directly is the point: it exercises the
// trigger the production path depends on.
func addConfirmedSubject(
	t *testing.T, ctx context.Context, pool *pgxpool.Pool,
	albumID, mediaID, userID uuid.UUID,
) {
	t.Helper()
	var faceID uuid.UUID
	err := pool.QueryRow(ctx, `
		INSERT INTO faces (media_item_id, album_id, bbox_x, bbox_y, bbox_w, bbox_h, model_id)
		VALUES ($1, $2, 0.3, 0.4, 0.2, 0.2, 'test-model') RETURNING id`,
		mediaID, albumID,
	).Scan(&faceID)
	if err != nil {
		t.Fatalf("insert face: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO face_tags (media_item_id, album_id, face_id, user_id, source, status, decided_at)
		VALUES ($1, $2, $3, $4, 'member_assigned', 'confirmed', now())`,
		mediaID, albumID, faceID, userID,
	); err != nil {
		t.Fatalf("insert confirmed tag: %v", err)
	}
}

func setFaceProcDone(t *testing.T, ctx context.Context, pool *pgxpool.Pool, mediaID uuid.UUID) {
	t.Helper()
	if _, err := pool.Exec(ctx,
		`UPDATE media_items SET face_proc_state = 'done' WHERE id = $1`, mediaID,
	); err != nil {
		t.Fatalf("set face_proc_state: %v", err)
	}
}

func buildFixture(
	t *testing.T, ctx context.Context, pool *pgxpool.Pool, mode access.PrivacyMode,
) fixture {
	t.Helper()

	u := fixtureUsers{
		owner:       mkUser(t, ctx, pool, "owner"),
		uploader:    mkUser(t, ctx, pool, "uploader"),
		subject:     mkUser(t, ctx, pool, "subject"),
		other:       mkUser(t, ctx, pool, "other"),
		granteeOne:  mkUser(t, ctx, pool, "grantee1"),
		granteeBulk: mkUser(t, ctx, pool, "granteeBulk"),
		noFaceRef:   mkUser(t, ctx, pool, "noFaceRef"),
		nonMember:   mkUser(t, ctx, pool, "nonMember"),
	}

	var entID, albumID uuid.UUID
	if err := pool.QueryRow(ctx,
		`INSERT INTO album_entitlements (user_id, source, free_slot)
		 VALUES ($1, 'free_slot', 1) RETURNING id`, u.owner,
	).Scan(&entID); err != nil {
		t.Fatalf("claim entitlement: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO albums (owner_user_id, title, privacy_mode, window_ends_at, entitlement_id)
		VALUES ($1, 'Conformance', $2::album_privacy_mode, now() + interval '30 days', $3)
		RETURNING id`,
		u.owner, string(mode), entID,
	).Scan(&albumID); err != nil {
		t.Fatalf("create album: %v", err)
	}

	// Everyone except nonMember is an active member.
	members := []struct {
		id   uuid.UUID
		role string
	}{
		{u.owner, "owner"},
		{u.uploader, "member"},
		{u.subject, "member"},
		{u.other, "member"},
		{u.granteeOne, "member"},
		{u.granteeBulk, "member"},
		{u.noFaceRef, "member"},
	}
	for _, m := range members {
		if _, err := pool.Exec(ctx,
			`INSERT INTO album_members (album_id, user_id, role) VALUES ($1, $2, $3::album_member_role)`,
			albumID, m.id, m.role,
		); err != nil {
			t.Fatalf("add member: %v", err)
		}
	}

	approval := "not_required"
	if mode == access.ModePrivate {
		approval = "approved"
	}

	m := fixtureMedia{
		withSubject:     mkMedia(t, ctx, pool, albumID, u.uploader, "m-subject", "ready", approval),
		noPeople:        mkMedia(t, ctx, pool, albumID, u.uploader, "m-nopeople", "ready", approval),
		unprocessed:     mkMedia(t, ctx, pool, albumID, u.uploader, "m-unproc", "ready", approval),
		hidden:          mkMedia(t, ctx, pool, albumID, u.uploader, "m-hidden", "ready", approval),
		pendingApproval: mkMedia(t, ctx, pool, albumID, u.uploader, "m-pending", "ready", "pending"),
		notReady:        mkMedia(t, ctx, pool, albumID, u.uploader, "m-notready", "uploaded", approval),
	}

	addConfirmedSubject(t, ctx, pool, albumID, m.withSubject, u.subject)
	setFaceProcDone(t, ctx, pool, m.withSubject)

	// Zero faces AND processing finished — the genuine "no people" case.
	setFaceProcDone(t, ctx, pool, m.noPeople)

	// m.unprocessed keeps face_proc_state = 'queued': zero faces but NOT yet known
	// to be people-free. Must be uploader-only.

	addConfirmedSubject(t, ctx, pool, albumID, m.hidden, u.subject)
	setFaceProcDone(t, ctx, pool, m.hidden)
	if _, err := pool.Exec(ctx,
		`INSERT INTO media_hides (media_item_id, album_id, user_id) VALUES ($1, $2, $3)`,
		m.hidden, albumID, u.subject,
	); err != nil {
		t.Fatalf("insert hide: %v", err)
	}

	setFaceProcDone(t, ctx, pool, m.pendingApproval)

	// A single-photo grant, and a bulk grant, both from `subject`.
	if _, err := pool.Exec(ctx, `
		INSERT INTO media_access_grants (scope, grantor_user_id, grantee_user_id, media_item_id, album_id)
		VALUES ('single_media', $1, $2, $3, $4)`,
		u.subject, u.granteeOne, m.withSubject, albumID,
	); err != nil {
		t.Fatalf("insert single grant: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO media_access_grants (scope, grantor_user_id, grantee_user_id, album_id)
		VALUES ('all_media_of_grantor', $1, $2, $3)`,
		u.subject, u.granteeBulk, albumID,
	); err != nil {
		t.Fatalf("insert bulk grant: %v", err)
	}

	return fixture{
		albumID: albumID,
		mode:    mode,
		users:   u,
		media:   m,
		grants: []access.Grant{
			{
				GrantorUserID: u.subject.String(),
				GranteeUserID: u.granteeOne.String(),
				AlbumID:       albumID.String(),
				MediaID:       m.withSubject.String(),
			},
			{
				GrantorUserID: u.subject.String(),
				GranteeUserID: u.granteeBulk.String(),
				AlbumID:       albumID.String(),
			},
		},
	}
}

// goMedia rebuilds the Go-side Media struct for one fixture item, so the mirror is
// fed exactly what the database holds.
func (f fixture) goMedia(id uuid.UUID) access.Media {
	base := access.Media{
		ID:             id.String(),
		UploaderUserID: f.users.uploader.String(),
		State:          access.StateReady,
		ApprovalState:  access.ApprovalNotRequired,
		FaceProcState:  access.ProcDone,
	}
	if f.mode == access.ModePrivate {
		base.ApprovalState = access.ApprovalApproved
	}

	switch id {
	case f.media.withSubject:
		base.DetectedFaceCount = 1
		base.Subjects = []string{f.users.subject.String()}
	case f.media.noPeople:
		base.DetectedFaceCount = 0
	case f.media.unprocessed:
		base.DetectedFaceCount = 0
		base.FaceProcState = access.ProcQueued
	case f.media.hidden:
		base.DetectedFaceCount = 1
		base.Subjects = []string{f.users.subject.String()}
		base.Hidden = true
	case f.media.pendingApproval:
		base.ApprovalState = access.ApprovalPending
	case f.media.notReady:
		base.State = access.StateUploaded
	}
	return base
}

func TestVisibilityConformance(t *testing.T) {
	pool := openPool(t)
	ctx := context.Background()
	repo := postgres.NewVisibilityRepo(pool)

	for _, mode := range []access.PrivacyMode{access.ModeOpen, access.ModeFace, access.ModePrivate} {
		t.Run(string(mode), func(t *testing.T) {
			f := buildFixture(t, ctx, pool, mode)

			viewers := []struct {
				name string
				id   uuid.UUID
				v    access.Viewer
			}{
				{"owner", f.users.owner, access.Viewer{UserID: f.users.owner.String(), IsOwner: true, IsMember: true}},
				{"uploader", f.users.uploader, access.Viewer{UserID: f.users.uploader.String(), IsMember: true}},
				{"subject", f.users.subject, access.Viewer{UserID: f.users.subject.String(), IsMember: true}},
				{"other", f.users.other, access.Viewer{UserID: f.users.other.String(), IsMember: true}},
				{"granteeSingle", f.users.granteeOne, access.Viewer{UserID: f.users.granteeOne.String(), IsMember: true}},
				{"granteeBulk", f.users.granteeBulk, access.Viewer{UserID: f.users.granteeBulk.String(), IsMember: true}},
				{"noFaceRef", f.users.noFaceRef, access.Viewer{UserID: f.users.noFaceRef.String(), IsMember: true}},
				{"nonMember", f.users.nonMember, access.Viewer{UserID: f.users.nonMember.String(), IsMember: false}},
			}

			items := []struct {
				name string
				id   uuid.UUID
			}{
				{"withSubject", f.media.withSubject},
				{"noPeople", f.media.noPeople},
				{"unprocessed", f.media.unprocessed},
				{"hidden", f.media.hidden},
				{"pendingApproval", f.media.pendingApproval},
				{"notReady", f.media.notReady},
			}

			album := access.Album{
				ID:          f.albumID.String(),
				PrivacyMode: mode,
				OwnerUserID: f.users.owner.String(),
			}

			for _, vw := range viewers {
				for _, it := range items {
					t.Run(vw.name+"/"+it.name, func(t *testing.T) {
						wantGo := access.CanView(vw.v, album, f.goMedia(it.id), f.grants)

						sqlErr := repo.CanView(ctx, it.id, vw.id)
						gotSQL := sqlErr == nil
						if sqlErr != nil && !isNotVisible(sqlErr) {
							t.Fatalf("SQL check errored: %v", sqlErr)
						}

						if wantGo != gotSQL {
							t.Errorf(
								"DIVERGENCE: Go policy says %v, SQL says %v\n"+
									"  mode=%s viewer=%s media=%s\n"+
									"  The two implementations of the visibility rule disagree. "+
									"Fix whichever is wrong — do not change this test to match.",
								wantGo, gotSQL, mode, vw.name, it.name,
							)
						}
					})
				}
			}
		})
	}
}

func isNotVisible(err error) bool {
	return err != nil && err.Error() == postgres.ErrNotVisible.Error()
}

// TestUnprocessedMediaFailsClosed calls out the single most dangerous branch.
//
// An item still being processed has detected_face_count = 0, exactly like a photo
// with genuinely no people in it. If the predicate checked only the count, every
// photo would be world-visible to the album for the seconds or minutes between
// upload and face detection.
func TestUnprocessedMediaFailsClosed(t *testing.T) {
	pool := openPool(t)
	ctx := context.Background()
	repo := postgres.NewVisibilityRepo(pool)

	f := buildFixture(t, ctx, pool, access.ModeFace)

	// A member who appears in nothing must NOT see the unprocessed item...
	if err := repo.CanView(ctx, f.media.unprocessed, f.users.other); err == nil {
		t.Fatal("unprocessed media was visible to a non-subject: face detection had not run, " +
			"so zero faces does not yet mean zero people")
	}
	// ...but its uploader must.
	if err := repo.CanView(ctx, f.media.unprocessed, f.users.uploader); err != nil {
		t.Fatalf("unprocessed media hidden from its own uploader: %v", err)
	}

	// Once processing completes it becomes the genuine "no people" case.
	setFaceProcDone(t, ctx, pool, f.media.unprocessed)
	if err := repo.CanView(ctx, f.media.unprocessed, f.users.other); err != nil {
		t.Fatalf("people-free media should be visible once processed: %v", err)
	}
}

// TestSubjectVetoIsAbsolute pins the spec's "the person in the photo wins".
func TestSubjectVetoIsAbsolute(t *testing.T) {
	pool := openPool(t)
	ctx := context.Background()
	repo := postgres.NewVisibilityRepo(pool)

	f := buildFixture(t, ctx, pool, access.ModeOpen)

	// Even in `open` mode, and even for the owner and the photographer.
	for name, viewer := range map[string]uuid.UUID{
		"owner":       f.users.owner,
		"uploader":    f.users.uploader,
		"othermember": f.users.other,
		"subject":     f.users.subject,
	} {
		if err := repo.CanView(ctx, f.media.hidden, viewer); err == nil {
			t.Errorf("%s could still see a photo a subject had vetoed", name)
		}
	}
}

// TestFeedMatchesPerItemChecks guards the divergence ADR 0005 is most worried
// about: the feed and the single-item endpoint drifting apart.
func TestFeedMatchesPerItemChecks(t *testing.T) {
	pool := openPool(t)
	ctx := context.Background()
	repo := postgres.NewVisibilityRepo(pool)

	f := buildFixture(t, ctx, pool, access.ModeFace)

	all := []uuid.UUID{
		f.media.withSubject, f.media.noPeople, f.media.unprocessed,
		f.media.hidden, f.media.pendingApproval, f.media.notReady,
	}

	for _, viewer := range []uuid.UUID{
		f.users.owner, f.users.uploader, f.users.subject,
		f.users.other, f.users.granteeOne, f.users.granteeBulk,
	} {
		items, _, err := repo.Feed(
			ctx, f.albumID, viewer,
			postgres.FeedFilterAll, postgres.GroupByCaptureTime, nil, 100,
		)
		if err != nil {
			t.Fatalf("feed: %v", err)
		}

		inFeed := make(map[uuid.UUID]bool, len(items))
		for _, it := range items {
			inFeed[it.ID] = true
		}

		for _, id := range all {
			perItem := repo.CanView(ctx, id, viewer) == nil
			if inFeed[id] != perItem {
				t.Errorf(
					"feed and per-item disagree for viewer %s on media %s: feed=%v single=%v\n"+
						"  Both must use visibilityPredicate. A photo fetchable by id but absent "+
						"from the feed (or vice versa) is the exact bug ADR 0005 warns about.",
					viewer, id, inFeed[id], perItem,
				)
			}
		}
	}
}
