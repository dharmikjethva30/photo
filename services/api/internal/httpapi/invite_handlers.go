package httpapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/dharmikjethva30/photo/services/api/internal/adapter/postgres/sqlcgen"
	"github.com/dharmikjethva30/photo/services/api/internal/app/invitesvc"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/problem"
)

// createInvite handles POST /v1/albums/{albumID}/invites.
func (h *Handlers) createInvite(w http.ResponseWriter, r *http.Request) {
	albumID, err := parseUUIDParam(chi.URLParam(r, "albumID"), "album")
	if err != nil {
		respond(w, r, err)
		return
	}

	var body struct {
		Channel   string     `json:"channel"`
		MaxUses   *int32     `json:"maxUses"`
		ExpiresAt *time.Time `json:"expiresAt"`
	}
	if r.ContentLength > 0 {
		if decErr := decodeJSON(r, &body); decErr != nil {
			respond(w, r, decErr)
			return
		}
	}

	invite, err := h.Invites.Create(r.Context(), invitesvc.CreateInput{
		AlbumID:   albumID,
		UserID:    userID(r),
		Channel:   body.Channel,
		MaxUses:   body.MaxUses,
		ExpiresAt: body.ExpiresAt,
	})
	if err != nil {
		respond(w, r, err)
		return
	}

	respondJSON(w, r, http.StatusCreated, h.inviteView(invite))
}

// listInvites handles GET /v1/albums/{albumID}/invites.
func (h *Handlers) listInvites(w http.ResponseWriter, r *http.Request) {
	albumID, err := parseUUIDParam(chi.URLParam(r, "albumID"), "album")
	if err != nil {
		respond(w, r, err)
		return
	}
	invites, err := h.Invites.List(r.Context(), albumID, userID(r))
	if err != nil {
		respond(w, r, err)
		return
	}
	views := make([]map[string]any, 0, len(invites))
	for i := range invites {
		views = append(views, h.inviteView(invites[i]))
	}
	respondJSON(w, r, http.StatusOK, map[string]any{"invites": views})
}

// revokeInvite handles DELETE /v1/albums/{albumID}/invites/{inviteID}.
func (h *Handlers) revokeInvite(w http.ResponseWriter, r *http.Request) {
	albumID, err := parseUUIDParam(chi.URLParam(r, "albumID"), "album")
	if err != nil {
		respond(w, r, err)
		return
	}
	inviteID, err := parseUUIDParam(chi.URLParam(r, "inviteID"), "invite")
	if err != nil {
		respond(w, r, err)
		return
	}
	if err := h.Invites.Revoke(r.Context(), albumID, inviteID, userID(r)); err != nil {
		respond(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// getInvite handles GET /v1/invites/{code}. PUBLIC — no auth: this backs the join
// landing, which a not-yet-signed-in user reaches by following a shared link. It
// returns only the album's public preview.
func (h *Handlers) getInvite(w http.ResponseWriter, r *http.Request) {
	code := normalizeCode(chi.URLParam(r, "code"))
	preview, err := h.Invites.Lookup(r.Context(), code)
	if err != nil {
		respond(w, r, err)
		return
	}
	respondJSON(w, r, http.StatusOK, previewView(preview))
}

// acceptInvite handles POST /v1/invites/{code}/accept. Authenticated: the signed-in
// user joins the album.
func (h *Handlers) acceptInvite(w http.ResponseWriter, r *http.Request) {
	code := normalizeCode(chi.URLParam(r, "code"))
	album, err := h.Invites.Accept(r.Context(), code, userID(r))
	if err != nil {
		respond(w, r, err)
		return
	}
	// Return the album so the client lands straight in it after joining.
	respondJSON(w, r, http.StatusOK, albumToResponse(album))
}

// inviteView is the owner-facing shape: the manage-invites screen shows the code, its
// shareable link, and how much life is left in it.
func (h *Handlers) inviteView(inv sqlcgen.Invite) map[string]any {
	v := map[string]any{
		"id":        inv.ID.String(),
		"code":      inv.Code,
		"url":       h.inviteURL(inv.Code),
		"channel":   string(inv.Channel),
		"useCount":  inv.UseCount,
		"createdAt": inv.CreatedAt,
	}
	if inv.MaxUses != nil {
		v["maxUses"] = *inv.MaxUses
	}
	if inv.ExpiresAt != nil {
		v["expiresAt"] = *inv.ExpiresAt
	}
	return v
}

// inviteURL builds the shareable link. It points at the WEB app, not the API: the web
// landing is what unfurls in a chat and what opens (via a Universal/App Link) either
// the app or the browser join page.
func (h *Handlers) inviteURL(code string) string {
	return strings.TrimRight(h.Config.WebBaseURL, "/") + "/a/" + code
}

func previewView(p invitesvc.Preview) map[string]any {
	v := map[string]any{
		"code":        p.Code,
		"albumId":     p.AlbumID.String(),
		"albumTitle":  p.AlbumTitle,
		"privacyMode": p.PrivacyMode,
		"albumState":  p.AlbumState,
		"valid":       p.Valid,
	}
	if p.CoverMediaID != nil {
		v["coverMediaId"] = p.CoverMediaID.String()
	}
	if !p.Valid {
		v["invalidReason"] = p.InvalidReason
	}
	return v
}

// normalizeCode makes lookups tolerant of how a code arrives: codes are minted from an
// uppercase, unambiguous alphabet, but a user may type or a link may lowercase them,
// and a pasted link can carry surrounding whitespace.
func normalizeCode(raw string) string {
	return strings.ToUpper(strings.TrimSpace(raw))
}

// TypeInviteUnusable is referenced by clients; kept here as a compile-time reminder
// that this handler set is the one that emits it (via the service).
var _ = problem.TypeInviteUnusable
