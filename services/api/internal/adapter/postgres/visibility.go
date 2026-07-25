// Package postgres holds the SQL adapters.
//
// This file is the highest-risk code in the repository. It decides who can see
// which photo, and face-privacy is the feature the product's entire trust promise
// rests on. Read docs/adr/0005-face-privacy-enforced-in-sql.md before changing it.
package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/dharmikjethva30/photo/services/api/internal/platform/db"
)

// visibilityPredicate is the ONE definition of "may this viewer see this photo".
//
// It is a const string rather than two sqlc queries on purpose. sqlc cannot share
// a SQL fragment between queries, so expressing this twice — once for the feed and
// once for the single-item fetch — is how they drift apart, and how a photo becomes
// fetchable by id while invisible in the feed. Every read path composes THIS.
//
// Expects a `ctx` CTE in scope (see visibilityCTE) and an alias `mi` for
// media_items.
//
// Ordering of the OR branches is deliberate: the cheap column checks come first so
// Postgres can short-circuit before touching a subquery, and the whole face block
// is skipped outright when the album is not in face mode.
const visibilityPredicate = `
      mi.album_id = ctx.album_id
  AND mi.deleted_at IS NULL
  -- Only fully-processed media is ever visible to anyone but its uploader. An item
  -- still being processed has detected_face_count = 0, which would otherwise read
  -- as "no people detected" and be shown to everyone.
  AND mi.state = 'ready'
  -- The subject veto is absolute: one active hide removes the photo for every
  -- other subject, for the photographer's feed, and for the owner.
  AND mi.is_hidden = false
  -- Creator review, for 'private' albums. The uploader can always see their own
  -- pending item, and the owner sees the queue.
  AND (mi.approval_state <> 'pending'
       OR ctx.is_owner
       OR mi.uploader_user_id = ctx.viewer_id)
  AND (
        -- open and private modes do not filter by face at all.
        ctx.privacy_mode <> 'face'

        -- You always see what you uploaded.
        OR mi.uploader_user_id = ctx.viewer_id

        -- Photos with no people in them. face_proc_state must be 'done': a queued
        -- or failed item also has zero faces, and treating that as "no people"
        -- would leak it. Failing closed here is the whole point.
        OR (mi.detected_face_count = 0 AND mi.face_proc_state = 'done')

        -- Photos you appear in. media_subjects is written by trigger ONLY from
        -- confirmed face tags, never from automatic matches — which is what makes
        -- a matching error unable to leak a photo.
        OR EXISTS (SELECT 1
                     FROM media_subjects ms
                    WHERE ms.media_item_id = mi.id
                      AND ms.user_id = ctx.viewer_id)

        -- A subject shared this specific photo with you.
        OR EXISTS (SELECT 1
                     FROM media_access_grants g
                    WHERE g.grantee_user_id = ctx.viewer_id
                      AND g.revoked_at IS NULL
                      AND g.scope = 'single_media'
                      AND g.media_item_id = mi.id)

        -- A subject granted you every photo they appear in ("show them all photos
        -- of me"). This is forward-looking — it covers photos uploaded AFTER the
        -- grant — which is precisely why visibility cannot be materialised.
        OR EXISTS (SELECT 1
                     FROM media_access_grants g
                     JOIN media_subjects gs
                       ON gs.media_item_id = mi.id
                      AND gs.user_id = g.grantor_user_id
                    WHERE g.grantee_user_id = ctx.viewer_id
                      AND g.revoked_at IS NULL
                      AND g.scope = 'all_media_of_grantor'
                      AND g.album_id = ctx.album_id)
      )`

// visibilityCTE resolves the viewer's relationship to the album once, so the
// predicate does not re-read `albums` per row.
//
// MEMBERSHIP IS ENFORCED HERE, structurally. The join on album_members means a
// non-member produces NO ctx row, so the CROSS JOIN in every consuming query
// yields nothing and the answer is "sees nothing" — without the predicate needing
// a membership clause it could forget.
//
// This was originally left to the caller, and the conformance test immediately
// caught it: a non-member could view any photo by id through CanView, which is the
// function the image redirect handler calls before minting a presigned URL.
//
// Guest access (browse-by-invite and the magic-link uploader) is NOT a member and
// deliberately does not pass through here — it needs its own ctx resolving the
// grant instead, and under face-privacy such a viewer sees only zero-people
// photos. See docs/adr/0004.
//
// $1 = album id, $2 = viewer id.
const visibilityCTE = `
WITH ctx AS (
  SELECT a.id                              AS album_id,
         a.privacy_mode                    AS privacy_mode,
         $2::uuid                          AS viewer_id,
         (a.owner_user_id = $2::uuid)      AS is_owner
    FROM albums a
    JOIN album_members m
      ON m.album_id = a.id
     AND m.user_id = $2::uuid
     AND m.state = 'active'
   WHERE a.id = $1::uuid
     AND a.deleted_at IS NULL
)`

// FeedFilter is the album feed's filter chip.
type FeedFilter string

const (
	FeedFilterAll FeedFilter = "all"
	// FeedFilterJustMe is the "Just me" chip: only photos the viewer appears in.
	FeedFilterJustMe FeedFilter = "just-me"
)

// FeedGrouping changes only the ORDER BY, so the same predicate serves all three.
type FeedGrouping string

const (
	GroupByCaptureTime FeedGrouping = "capture_time"
	GroupByUploader    FeedGrouping = "uploader"
	GroupByScene       FeedGrouping = "scene"
)

// Cursor is keyset pagination state. Never an offset: an offset shifts under
// concurrent uploads, silently duplicating or skipping photos mid-scroll.
type Cursor struct {
	CaptureTime time.Time
	ID          uuid.UUID
}

// FeedItem is what a feed row needs. Deliberately narrow — the feed must not carry
// EXIF, storage keys, or anything else a client has no business seeing.
type FeedItem struct {
	ID             uuid.UUID
	AlbumID        uuid.UUID
	UploaderUserID uuid.UUID
	UploaderName   string
	Kind           string
	CaptureTime    time.Time
	Width          *int32
	Height         *int32
	DurationMS     *int32
	SceneLabel     *string
	// ViewerAppears drives the small face marker the design puts on photos you are
	// in. Computed here rather than by a second round of queries per row.
	ViewerAppears bool
}

const feedColumns = `
  mi.id, mi.album_id, mi.uploader_user_id, u.display_name,
  mi.kind::text, mi.capture_time, mi.width, mi.height, mi.duration_ms, mi.scene_label,
  EXISTS (SELECT 1 FROM media_subjects ms2
           WHERE ms2.media_item_id = mi.id AND ms2.user_id = ctx.viewer_id) AS viewer_appears`

// VisibilityRepo answers visibility questions. One type so there is one place to
// audit.
type VisibilityRepo struct {
	pool db.Pool
}

func NewVisibilityRepo(pool db.Pool) *VisibilityRepo {
	return &VisibilityRepo{pool: pool}
}

// ErrNotVisible means the item does not exist OR the viewer may not see it.
//
// The two cases are deliberately indistinguishable. Under face-privacy,
// distinguishing them would confirm that a photo exists — which is exactly what
// the feature protects. Callers must map this to 404, never 403.
var ErrNotVisible = errors.New("media not visible to viewer")

// Feed returns one page of visible media, newest-last (chronological, as the
// design's day groups require).
func (r *VisibilityRepo) Feed(
	ctx context.Context,
	albumID, viewerID uuid.UUID,
	filter FeedFilter,
	grouping FeedGrouping,
	cursor *Cursor,
	limit int32,
) ([]FeedItem, *Cursor, error) {
	// The cursor is expressed so that a nil cursor means "from the beginning",
	// without needing a second query shape.
	var cursorTime time.Time
	var cursorID uuid.UUID
	if cursor != nil {
		cursorTime = cursor.CaptureTime
		cursorID = cursor.ID
	}

	extra := ""
	if filter == FeedFilterJustMe {
		// Composes onto the same predicate rather than forking it.
		extra = `
  AND EXISTS (SELECT 1 FROM media_subjects ms3
               WHERE ms3.media_item_id = mi.id AND ms3.user_id = ctx.viewer_id)`
	}

	// Grouping changes ORDER BY only. Each variant has a matching partial index
	// (media_feed_idx, media_uploader_idx, media_scene_idx) so Postgres can walk
	// the index and stop at LIMIT.
	orderBy := `mi.capture_time, mi.id`
	switch grouping {
	case GroupByUploader:
		orderBy = `mi.uploader_user_id, mi.capture_time, mi.id`
	case GroupByScene:
		orderBy = `mi.scene_label NULLS LAST, mi.capture_time, mi.id`
	case GroupByCaptureTime:
	}

	query := fmt.Sprintf(`%s
SELECT %s
  FROM media_items mi
  JOIN users u ON u.id = mi.uploader_user_id
  CROSS JOIN ctx
 WHERE %s
   %s
   AND ($3::timestamptz IS NULL OR (mi.capture_time, mi.id) > ($3::timestamptz, $4::uuid))
 ORDER BY %s
 LIMIT $5`,
		visibilityCTE, feedColumns, visibilityPredicate, extra, orderBy)

	var timeArg any
	if cursor != nil {
		timeArg = cursorTime
	}

	rows, err := r.pool.Query(ctx, query, albumID, viewerID, timeArg, cursorID, limit)
	if err != nil {
		return nil, nil, fmt.Errorf("query feed: %w", err)
	}
	defer rows.Close()

	items := make([]FeedItem, 0, limit)
	for rows.Next() {
		var it FeedItem
		if err := rows.Scan(
			&it.ID, &it.AlbumID, &it.UploaderUserID, &it.UploaderName,
			&it.Kind, &it.CaptureTime, &it.Width, &it.Height, &it.DurationMS,
			&it.SceneLabel, &it.ViewerAppears,
		); err != nil {
			return nil, nil, fmt.Errorf("scan feed row: %w", err)
		}
		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("iterate feed: %w", err)
	}

	// Only advertise a next cursor when the page was full. Returning one on a short
	// page makes clients issue a guaranteed-empty extra request.
	//
	// Comparing as int rather than casting len() to int32: the cast is what gosec
	// flags, and widening is always safe where narrowing is not.
	var next *Cursor
	if len(items) > 0 && len(items) == int(limit) {
		last := items[len(items)-1]
		next = &Cursor{CaptureTime: last.CaptureTime, ID: last.ID}
	}

	return items, next, nil
}

// CanView answers the single-item question using the IDENTICAL predicate.
//
// This is the function the image redirect handler must call before minting a
// presigned URL. A presigned URL bypasses authorization entirely once issued, so
// checking after signing is not a check at all.
func (r *VisibilityRepo) CanView(ctx context.Context, mediaID, viewerID uuid.UUID) error {
	// The album is derived FROM the media item rather than passed in: a caller that
	// supplied both could pass a mismatched pair and widen the check.
	//
	// This query numbers its parameters independently of Feed's, which is safe
	// precisely because visibilityPredicate contains NO positional parameters — it
	// reads everything from the `ctx` CTE. (An earlier version padded the argument
	// list to keep the positions aligned; Postgres rejected it, because it cannot
	// infer a type for a parameter that is never referenced.)
	query := fmt.Sprintf(`
WITH target AS (
  SELECT album_id FROM media_items WHERE id = $2::uuid AND deleted_at IS NULL
),
ctx AS (
  SELECT a.id                         AS album_id,
         a.privacy_mode               AS privacy_mode,
         $1::uuid                     AS viewer_id,
         (a.owner_user_id = $1::uuid) AS is_owner
    FROM albums a
    JOIN target t ON t.album_id = a.id
    -- Same structural membership check as visibilityCTE. Kept in both because a
    -- non-member reaching this function is the leak path that matters.
    JOIN album_members m
      ON m.album_id = a.id
     AND m.user_id = $1::uuid
     AND m.state = 'active'
   WHERE a.deleted_at IS NULL
)
SELECT EXISTS (
  SELECT 1
    FROM media_items mi
    CROSS JOIN ctx
   WHERE mi.id = $2::uuid
     AND %s
)`, visibilityPredicate)

	var visible bool
	if err := r.pool.QueryRow(ctx, query, viewerID, mediaID).Scan(&visible); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotVisible
		}
		return fmt.Errorf("check visibility: %w", err)
	}
	if !visible {
		return ErrNotVisible
	}
	return nil
}

// IsAlbumMember is an authorization precondition, not a visibility check. A
// non-member gets nothing regardless of the predicate above.
func (r *VisibilityRepo) IsAlbumMember(ctx context.Context, albumID, userID uuid.UUID) (bool, error) {
	var ok bool
	err := r.pool.QueryRow(ctx, `
		SELECT EXISTS (
		  SELECT 1 FROM album_members
		   WHERE album_id = $1 AND user_id = $2 AND state = 'active')`,
		albumID, userID,
	).Scan(&ok)
	if err != nil {
		return false, fmt.Errorf("check membership: %w", err)
	}
	return ok, nil
}
