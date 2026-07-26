package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// hideMedia handles POST /v1/media/{mediaID}/hide — the subject veto.
func (h *Handlers) hideMedia(w http.ResponseWriter, r *http.Request) {
	mediaID, err := parseUUIDParam(chi.URLParam(r, "mediaID"), "media")
	if err != nil {
		respond(w, r, err)
		return
	}
	if err := h.Share.Hide(r.Context(), mediaID, userID(r)); err != nil {
		respond(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// unhideMedia handles DELETE /v1/media/{mediaID}/hide — lift the caller's own veto.
func (h *Handlers) unhideMedia(w http.ResponseWriter, r *http.Request) {
	mediaID, err := parseUUIDParam(chi.URLParam(r, "mediaID"), "media")
	if err != nil {
		respond(w, r, err)
		return
	}
	if err := h.Share.Unhide(r.Context(), mediaID, userID(r)); err != nil {
		respond(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// grantSingle handles POST /v1/media/{mediaID}/grants — "show this photo of me to X".
func (h *Handlers) grantSingle(w http.ResponseWriter, r *http.Request) {
	mediaID, err := parseUUIDParam(chi.URLParam(r, "mediaID"), "media")
	if err != nil {
		respond(w, r, err)
		return
	}
	var body struct {
		GranteeUserID string `json:"granteeUserId"`
	}
	if err := decodeJSON(r, &body); err != nil {
		respond(w, r, err)
		return
	}
	granteeID, err := parseUUIDParam(body.GranteeUserID, "granteeUserId")
	if err != nil {
		respond(w, r, err)
		return
	}
	id, err := h.Share.GrantSingle(r.Context(), mediaID, userID(r), granteeID)
	if err != nil {
		respond(w, r, err)
		return
	}
	respondJSON(w, r, http.StatusCreated, map[string]any{"grantId": id.String()})
}

// grantBulk handles POST /v1/albums/{albumID}/grants — "show X every photo of me here".
func (h *Handlers) grantBulk(w http.ResponseWriter, r *http.Request) {
	albumID, err := parseUUIDParam(chi.URLParam(r, "albumID"), "album")
	if err != nil {
		respond(w, r, err)
		return
	}
	var body struct {
		GranteeUserID string `json:"granteeUserId"`
	}
	if err := decodeJSON(r, &body); err != nil {
		respond(w, r, err)
		return
	}
	granteeID, err := parseUUIDParam(body.GranteeUserID, "granteeUserId")
	if err != nil {
		respond(w, r, err)
		return
	}
	id, err := h.Share.GrantBulk(r.Context(), albumID, userID(r), granteeID)
	if err != nil {
		respond(w, r, err)
		return
	}
	respondJSON(w, r, http.StatusCreated, map[string]any{"grantId": id.String()})
}

// listGrants handles GET /v1/albums/{albumID}/grants — grants the caller has issued.
func (h *Handlers) listGrants(w http.ResponseWriter, r *http.Request) {
	albumID, err := parseUUIDParam(chi.URLParam(r, "albumID"), "album")
	if err != nil {
		respond(w, r, err)
		return
	}
	rows, err := h.Share.MyGrants(r.Context(), albumID, userID(r))
	if err != nil {
		respond(w, r, err)
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for i := range rows {
		row := rows[i]
		v := map[string]any{
			"grantId":       row.ID.String(),
			"scope":         string(row.Scope),
			"granteeUserId": row.GranteeUserID.String(),
			"createdAt":     row.CreatedAt,
		}
		if row.MediaItemID != nil {
			v["mediaId"] = row.MediaItemID.String()
		}
		out = append(out, v)
	}
	respondJSON(w, r, http.StatusOK, map[string]any{"grants": out})
}

// revokeGrant handles DELETE /v1/grants/{grantID}.
func (h *Handlers) revokeGrant(w http.ResponseWriter, r *http.Request) {
	grantID, err := parseUUIDParam(chi.URLParam(r, "grantID"), "grant")
	if err != nil {
		respond(w, r, err)
		return
	}
	if err := h.Share.Revoke(r.Context(), grantID, userID(r)); err != nil {
		respond(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
