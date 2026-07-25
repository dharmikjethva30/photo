package httpapi

import (
	"encoding/base64"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/dharmikjethva30/photo/services/api/internal/adapter/postgres"
	"github.com/dharmikjethva30/photo/services/api/internal/adapter/postgres/sqlcgen"
	"github.com/dharmikjethva30/photo/services/api/internal/app/albumsvc"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/problem"
)

type albumResponse struct {
	ID           string    `json:"id"`
	Title        string    `json:"title"`
	Template     string    `json:"template"`
	State        string    `json:"state"`
	PrivacyMode  string    `json:"privacyMode"`
	OwnerUserID  string    `json:"ownerUserId"`
	WindowEndsAt time.Time `json:"windowEndsAt"`
	MediaCount   int32     `json:"mediaCount"`
	MemberCount  int32     `json:"memberCount"`
	CoverMediaID *string   `json:"coverMediaId"`
	CreatedAt    time.Time `json:"createdAt"`
}

func albumToResponse(a sqlcgen.Album) albumResponse {
	var cover *string
	if a.CoverMediaID != nil {
		s := a.CoverMediaID.String()
		cover = &s
	}
	return albumResponse{
		ID:           a.ID.String(),
		Title:        a.Title,
		Template:     string(a.Template),
		State:        string(a.State),
		PrivacyMode:  string(a.PrivacyMode),
		OwnerUserID:  a.OwnerUserID.String(),
		WindowEndsAt: a.WindowEndsAt,
		MediaCount:   a.MediaCount,
		MemberCount:  a.MemberCount,
		CoverMediaID: cover,
		CreatedAt:    a.CreatedAt,
	}
}

func (h *Handlers) createAlbum(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title        string     `json:"title"`
		Template     string     `json:"template"`
		PrivacyMode  string     `json:"privacyMode"`
		WindowEndsAt *time.Time `json:"windowEndsAt"`
	}
	if err := decodeJSON(r, &body); err != nil {
		respond(w, r, err)
		return
	}

	if body.Template == "" {
		body.Template = string(sqlcgen.AlbumTemplateOther)
	}
	if body.PrivacyMode == "" {
		// The spec's default for trips and weddings, and the safer default in
		// general: face-privacy on unless someone opts out.
		body.PrivacyMode = string(sqlcgen.AlbumPrivacyModeFace)
	}

	in := albumsvc.CreateInputFrom(userID(r), body.Title, body.Template, body.PrivacyMode)
	if body.WindowEndsAt != nil {
		in.WindowEndsAt = *body.WindowEndsAt
	}

	album, err := h.Albums.Create(r.Context(), in)
	if err != nil {
		respond(w, r, err)
		return
	}
	respondJSON(w, r, http.StatusCreated, albumToResponse(album))
}

// parseLimit reads a page size, clamping rather than trusting the client.
//
// ParseInt with an explicit bit size, not Atoi-then-cast: a caller passing
// limit=99999999999 would otherwise wrap to a negative int32 and skip the
// service's own bounds check.
func parseLimit(raw string, def, upperBound int32) int32 {
	if raw == "" {
		return def
	}
	n, err := strconv.ParseInt(raw, 10, 32)
	if err != nil || n <= 0 {
		return def
	}
	// Compare in 64-bit and only narrow once the value is known to be in range,
	// so there is no point at which a truncating cast could change the comparison.
	if n > int64(upperBound) {
		return upperBound
	}
	return int32(n)
}

func (h *Handlers) listAlbums(w http.ResponseWriter, r *http.Request) {
	limit := parseLimit(r.URL.Query().Get("limit"), 50, 100)

	albums, err := h.Albums.List(r.Context(), userID(r), limit)
	if err != nil {
		respond(w, r, err)
		return
	}

	out := make([]albumResponse, 0, len(albums))
	// Indexed rather than ranged by value: sqlcgen.Album is large enough that the
	// copy shows up in a lint pass, and the library screen is a hot path.
	for i := range albums {
		out = append(out, albumToResponse(albums[i]))
	}
	respondJSON(w, r, http.StatusOK, map[string]any{"albums": out})
}

func (h *Handlers) getAlbum(w http.ResponseWriter, r *http.Request) {
	albumID, err := parseUUIDParam(chi.URLParam(r, "albumID"), "album")
	if err != nil {
		respond(w, r, err)
		return
	}
	album, err := h.Albums.Get(r.Context(), albumID, userID(r))
	if err != nil {
		respond(w, r, err)
		return
	}
	respondJSON(w, r, http.StatusOK, albumToResponse(album))
}

func (h *Handlers) listAlbumMembers(w http.ResponseWriter, r *http.Request) {
	albumID, err := parseUUIDParam(chi.URLParam(r, "albumID"), "album")
	if err != nil {
		respond(w, r, err)
		return
	}
	rows, err := h.Albums.Members(r.Context(), albumID, userID(r))
	if err != nil {
		respond(w, r, err)
		return
	}

	type member struct {
		UserID      string `json:"userId"`
		DisplayName string `json:"displayName"`
		Role        string `json:"role"`
	}
	out := make([]member, 0, len(rows))
	for i := range rows {
		out = append(out, member{
			UserID:      rows[i].UserID.String(),
			DisplayName: rows[i].DisplayName,
			Role:        string(rows[i].Role),
		})
	}
	respondJSON(w, r, http.StatusOK, map[string]any{"members": out})
}

// --- feed ------------------------------------------------------------------

type feedItemResponse struct {
	ID            string    `json:"id"`
	Kind          string    `json:"kind"`
	CaptureTime   time.Time `json:"captureTime"`
	Width         *int32    `json:"width"`
	Height        *int32    `json:"height"`
	DurationMS    *int32    `json:"durationMs"`
	UploaderID    string    `json:"uploaderId"`
	UploaderName  string    `json:"uploaderName"`
	ViewerAppears bool      `json:"viewerAppears"`
	// Stable URLs, not presigned ones. A presigned URL rotates its query string on
	// every request, which would defeat the client's image cache and re-download the
	// whole grid on each screen focus. These 302 to a short-lived presigned URL
	// after re-checking visibility. See docs/adr/0003.
	ThumbURL   string `json:"thumbUrl"`
	PreviewURL string `json:"previewUrl"`
}

func (h *Handlers) albumFeed(w http.ResponseWriter, r *http.Request) {
	albumID, err := parseUUIDParam(chi.URLParam(r, "albumID"), "album")
	if err != nil {
		respond(w, r, err)
		return
	}

	q := r.URL.Query()

	filter := postgres.FeedFilterAll
	if q.Get("filter") == string(postgres.FeedFilterJustMe) {
		filter = postgres.FeedFilterJustMe
	}

	grouping := postgres.GroupByCaptureTime
	switch q.Get("groupBy") {
	case string(postgres.GroupByUploader):
		grouping = postgres.GroupByUploader
	case string(postgres.GroupByScene):
		grouping = postgres.GroupByScene
	}

	limit := parseLimit(q.Get("limit"), 50, 200)

	cursor, err := decodeCursor(q.Get("cursor"))
	if err != nil {
		respond(w, r, err)
		return
	}

	items, next, err := h.Albums.Feed(r.Context(), albumID, userID(r), filter, grouping, cursor, limit)
	if err != nil {
		respond(w, r, err)
		return
	}

	out := make([]feedItemResponse, 0, len(items))
	// Indexed: FeedItem is 144 bytes and a page is up to 200 of them.
	for i := range items {
		it := &items[i]
		out = append(out, feedItemResponse{
			ID:            it.ID.String(),
			Kind:          it.Kind,
			CaptureTime:   it.CaptureTime,
			Width:         it.Width,
			Height:        it.Height,
			DurationMS:    it.DurationMS,
			UploaderID:    it.UploaderUserID.String(),
			UploaderName:  it.UploaderName,
			ViewerAppears: it.ViewerAppears,
			ThumbURL:      h.mediaURL(it.ID, "thumb_256"),
			PreviewURL:    h.mediaURL(it.ID, "preview_1024"),
		})
	}

	body := map[string]any{"items": out}
	if next != nil {
		body["nextCursor"] = encodeCursor(*next)
	}
	respondJSON(w, r, http.StatusOK, body)
}

func (h *Handlers) mediaURL(mediaID uuid.UUID, rendition string) string {
	return h.Config.PublicBaseURL + "/v1/media/" + mediaID.String() + "/" + rendition
}

// Cursors are opaque base64 so clients cannot construct one and paginate past the
// visibility rules by hand.
func encodeCursor(c postgres.Cursor) string {
	return base64.RawURLEncoding.EncodeToString(
		[]byte(c.CaptureTime.UTC().Format(time.RFC3339Nano) + "|" + c.ID.String()))
}

func decodeCursor(raw string) (*postgres.Cursor, error) {
	if raw == "" {
		return nil, nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil, problem.Validation("That page cursor is not valid.", nil).WithCause(err)
	}
	parts := strings.SplitN(string(decoded), "|", 2)
	if len(parts) != 2 {
		return nil, problem.Validation("That page cursor is not valid.", nil)
	}
	ts, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return nil, problem.Validation("That page cursor is not valid.", nil).WithCause(err)
	}
	id, err := uuid.Parse(parts[1])
	if err != nil {
		return nil, problem.Validation("That page cursor is not valid.", nil).WithCause(err)
	}
	return &postgres.Cursor{CaptureTime: ts, ID: id}, nil
}
