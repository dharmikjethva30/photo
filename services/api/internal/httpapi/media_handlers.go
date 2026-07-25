package httpapi

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/dharmikjethva30/photo/services/api/internal/app/mediasvc"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/problem"
)

// declareUpload handles POST /v1/albums/{albumID}/uploads.
func (h *Handlers) declareUpload(w http.ResponseWriter, r *http.Request) {
	albumID, err := parseUUIDParam(chi.URLParam(r, "albumID"), "album")
	if err != nil {
		respond(w, r, err)
		return
	}

	var body struct {
		ClientMediaID     string     `json:"clientMediaId"`
		ContentType       string     `json:"contentType"`
		ByteSize          int64      `json:"byteSize"`
		SHA256            string     `json:"sha256"`
		OriginalFilename  string     `json:"originalFilename"`
		Width             *int32     `json:"width"`
		Height            *int32     `json:"height"`
		DurationMS        *int32     `json:"durationMs"`
		CaptureTime       *time.Time `json:"captureTime"`
		TimezoneOffsetMin *int32     `json:"timezoneOffsetMin"`
	}
	if err := decodeJSON(r, &body); err != nil {
		respond(w, r, err)
		return
	}
	if body.ClientMediaID == "" {
		// Without this the call is not idempotent, and a retry after a dropped
		// response would create a duplicate photo.
		respond(w, r, problem.Validation("A clientMediaId is required so retries are safe.",
			map[string]string{"clientMediaId": "required"}))
		return
	}

	res, err := h.Media.Declare(r.Context(), mediasvc.DeclareInput{
		AlbumID:           albumID,
		UserID:            userID(r),
		ClientMediaID:     body.ClientMediaID,
		ContentType:       body.ContentType,
		ByteSize:          body.ByteSize,
		SHA256B64:         body.SHA256,
		OriginalFilename:  body.OriginalFilename,
		Width:             body.Width,
		Height:            body.Height,
		DurationMS:        body.DurationMS,
		CaptureTime:       body.CaptureTime,
		TimezoneOffsetMin: body.TimezoneOffsetMin,
	})
	if err != nil {
		respond(w, r, err)
		return
	}

	if res.AlreadyUploaded {
		// A retry of a finished upload. Reporting success without a new presigned
		// URL is deliberate: handing one back would let the bytes be replaced after
		// they were verified.
		respondJSON(w, r, http.StatusOK, map[string]any{
			"mediaId":         res.MediaID.String(),
			"alreadyUploaded": true,
		})
		return
	}

	respondJSON(w, r, http.StatusCreated, map[string]any{
		"mediaId": res.MediaID.String(),
		"mode":    res.Mode,
		"upload": map[string]any{
			"url":       res.Upload.URL,
			"headers":   res.Upload.Headers,
			"expiresAt": res.Upload.ExpiresAt,
		},
	})
}

// completeUpload handles POST /v1/uploads/{mediaID}/complete.
func (h *Handlers) completeUpload(w http.ResponseWriter, r *http.Request) {
	mediaID, err := parseUUIDParam(chi.URLParam(r, "mediaID"), "upload")
	if err != nil {
		respond(w, r, err)
		return
	}

	media, err := h.Media.Complete(r.Context(), mediaID, userID(r))
	if err != nil {
		respond(w, r, err)
		return
	}

	respondJSON(w, r, http.StatusOK, map[string]any{
		"mediaId":    media.ID.String(),
		"state":      string(media.State),
		"byteSize":   media.ByteSize,
		"processing": true,
	})
}

// renditionRedirect handles GET /v1/media/{mediaID}/{rendition}.
//
// A STABLE url that 302s to a short-lived presigned one. Two reasons this
// indirection exists rather than returning presigned URLs in the feed:
//
//  1. Presigned URLs rotate their query string, so an image cache keyed on URL
//     never hits and the whole grid re-downloads on every screen focus.
//  2. Authorization runs on EVERY image fetch. A presigned URL is a bearer token
//     that bypasses authorization once issued, so the check has to happen here,
//     before signing.
func (h *Handlers) renditionRedirect(w http.ResponseWriter, r *http.Request) {
	mediaID, err := parseUUIDParam(chi.URLParam(r, "mediaID"), "photo")
	if err != nil {
		respond(w, r, err)
		return
	}

	rendition := chi.URLParam(r, "rendition")
	switch rendition {
	case "thumb_256", "preview_1024", "poster", "original":
	default:
		respond(w, r, problem.NotFound("No such version of that photo."))
		return
	}

	url, err := h.Media.RenditionURL(r.Context(), mediaID, userID(r), rendition)
	if err != nil {
		respond(w, r, err)
		return
	}

	// private, because the response is viewer-specific: it is authorized for this
	// user and must never be held in a shared cache. max-age is shorter than the
	// presigned URL's own lifetime so a client never follows an expired redirect.
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("Location", url)
	w.WriteHeader(http.StatusFound)
}
