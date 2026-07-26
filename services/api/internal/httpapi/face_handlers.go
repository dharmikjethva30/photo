package httpapi

import (
	"net/http"
	"net/netip"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/dharmikjethva30/photo/services/api/internal/platform/problem"
)

// getFaceConsent handles GET /v1/me/face-consent.
func (h *Handlers) getFaceConsent(w http.ResponseWriter, r *http.Request) {
	st, err := h.Faces.Consent(r.Context(), userID(r))
	if err != nil {
		respond(w, r, err)
		return
	}
	respondJSON(w, r, http.StatusOK, map[string]any{
		"currentVersion": st.CurrentVersion,
		"granted":        st.Granted,
		"grantedVersion": st.GrantedVersion,
		"grantedAt":      st.GrantedAt,
		// The client re-shows the consent copy when the granted version is behind.
		"needsConsent": !st.Granted || st.GrantedVersion != st.CurrentVersion,
	})
}

// grantFaceConsent handles POST /v1/me/face-consent.
func (h *Handlers) grantFaceConsent(w http.ResponseWriter, r *http.Request) {
	st, err := h.Faces.GrantConsent(r.Context(), userID(r), clientIP(r), r.UserAgent())
	if err != nil {
		respond(w, r, err)
		return
	}
	respondJSON(w, r, http.StatusOK, map[string]any{
		"granted":        st.Granted,
		"grantedVersion": st.GrantedVersion,
		"grantedAt":      st.GrantedAt,
	})
}

// revokeFaceConsent handles DELETE /v1/me/face-consent.
func (h *Handlers) revokeFaceConsent(w http.ResponseWriter, r *http.Request) {
	if err := h.Faces.RevokeConsent(r.Context(), userID(r)); err != nil {
		respond(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// declareFaceReference handles POST /v1/me/face-references.
func (h *Handlers) declareFaceReference(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ContentType string `json:"contentType"`
		ByteSize    int64  `json:"byteSize"`
	}
	if err := decodeJSON(r, &body); err != nil {
		respond(w, r, err)
		return
	}
	res, err := h.Faces.DeclareReference(r.Context(), userID(r), body.ContentType, body.ByteSize)
	if err != nil {
		respond(w, r, err)
		return
	}
	respondJSON(w, r, http.StatusCreated, map[string]any{
		"referenceId": res.ReferenceID.String(),
		"upload": map[string]any{
			"url":       res.Upload.URL,
			"headers":   res.Upload.Headers,
			"expiresAt": res.Upload.ExpiresAt,
		},
	})
}

// completeFaceReference handles POST /v1/me/face-references/{referenceID}/complete.
func (h *Handlers) completeFaceReference(w http.ResponseWriter, r *http.Request) {
	referenceID, err := parseUUIDParam(chi.URLParam(r, "referenceID"), "reference")
	if err != nil {
		respond(w, r, err)
		return
	}
	var body struct {
		ContentType string `json:"contentType"`
	}
	if r.ContentLength > 0 {
		if decErr := decodeJSON(r, &body); decErr != nil {
			respond(w, r, decErr)
			return
		}
	}
	ref, err := h.Faces.CompleteReference(r.Context(), userID(r), referenceID, body.ContentType)
	if err != nil {
		respond(w, r, err)
		return
	}
	respondJSON(w, r, http.StatusOK, referenceView(ref.ID, ref.CreatedAt, ref.Processed))
}

// listFaceReferences handles GET /v1/me/face-references.
func (h *Handlers) listFaceReferences(w http.ResponseWriter, r *http.Request) {
	refs, err := h.Faces.ListReferences(r.Context(), userID(r))
	if err != nil {
		respond(w, r, err)
		return
	}
	views := make([]map[string]any, 0, len(refs))
	for i := range refs {
		views = append(views, referenceView(refs[i].ID, refs[i].CreatedAt, refs[i].Processed))
	}
	respondJSON(w, r, http.StatusOK, map[string]any{"references": views})
}

// deleteFaceReference handles DELETE /v1/me/face-references/{referenceID}.
func (h *Handlers) deleteFaceReference(w http.ResponseWriter, r *http.Request) {
	referenceID, err := parseUUIDParam(chi.URLParam(r, "referenceID"), "reference")
	if err != nil {
		respond(w, r, err)
		return
	}
	if err := h.Faces.DeleteReference(r.Context(), userID(r), referenceID); err != nil {
		respond(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// listSuggestedTags handles GET /v1/albums/{albumID}/my-suggested-tags — the photos in
// this album the caller is auto-suggested in and hasn't decided yet.
func (h *Handlers) listSuggestedTags(w http.ResponseWriter, r *http.Request) {
	albumID, err := parseUUIDParam(chi.URLParam(r, "albumID"), "album")
	if err != nil {
		respond(w, r, err)
		return
	}
	rows, err := h.Faces.SuggestedTags(r.Context(), albumID, userID(r))
	if err != nil {
		respond(w, r, err)
		return
	}
	base := strings.TrimRight(h.Config.PublicBaseURL, "/")
	out := make([]map[string]any, 0, len(rows))
	for i := range rows {
		row := rows[i]
		v := map[string]any{
			"tagId":   row.TagID.String(),
			"mediaId": row.MediaItemID.String(),
			// The stable thumb URL (same 302-redirect the feed uses) so the sheet can
			// show the photo; bbox lets it highlight which face is meant.
			"thumbUrl": base + "/v1/media/" + row.MediaItemID.String() + "/thumb_256",
			"bbox": map[string]float32{
				"x": row.BboxX, "y": row.BboxY, "w": row.BboxW, "h": row.BboxH,
			},
		}
		if row.Similarity != nil {
			v["similarity"] = *row.Similarity
		}
		out = append(out, v)
	}
	respondJSON(w, r, http.StatusOK, map[string]any{"suggestions": out})
}

// confirmFaceTag handles POST /v1/face-tags/{tagID}/confirm.
func (h *Handlers) confirmFaceTag(w http.ResponseWriter, r *http.Request) {
	h.decideFaceTag(w, r, true)
}

// rejectFaceTag handles POST /v1/face-tags/{tagID}/reject.
func (h *Handlers) rejectFaceTag(w http.ResponseWriter, r *http.Request) {
	h.decideFaceTag(w, r, false)
}

func (h *Handlers) decideFaceTag(w http.ResponseWriter, r *http.Request, confirm bool) {
	tagID, err := parseUUIDParam(chi.URLParam(r, "tagID"), "tag")
	if err != nil {
		respond(w, r, err)
		return
	}
	if err := h.Faces.Decide(r.Context(), tagID, userID(r), confirm); err != nil {
		respond(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// eraseFaceData handles DELETE /v1/me/face-data — the GDPR erasure path.
func (h *Handlers) eraseFaceData(w http.ResponseWriter, r *http.Request) {
	report, err := h.Faces.EraseFaceData(r.Context(), userID(r))
	if err != nil {
		respond(w, r, err)
		return
	}
	respondJSON(w, r, http.StatusOK, map[string]any{
		"erased":            true,
		"referencesDeleted": report.ReferencesDeleted,
		"objectsDeleted":    report.ObjectsDeleted,
	})
}

func referenceView(id uuid.UUID, createdAt time.Time, processed bool) map[string]any {
	return map[string]any{
		"id":        id.String(),
		"createdAt": createdAt,
		// processed = the embedding exists; false until the face worker runs (M4.2).
		"processed": processed,
	}
}

// clientIP extracts the caller's IP as evidence on a consent row. RealIP middleware is
// deliberately NOT trusted (it is spoofable — see the router), so this reads
// RemoteAddr directly; behind a known proxy this becomes the trusted forwarded hop.
func clientIP(r *http.Request) *netip.Addr {
	host := r.RemoteAddr
	if i := strings.LastIndex(host, ":"); i != -1 {
		host = host[:i]
	}
	host = strings.Trim(host, "[]")
	addr, err := netip.ParseAddr(host)
	if err != nil {
		return nil
	}
	return &addr
}

var _ = problem.TypeConsentRequired
