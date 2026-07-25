package httpapi

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/dharmikjethva30/photo/services/api/internal/adapter/postgres/sqlcgen"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/problem"
)

type meResponse struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Email       string `json:"email,omitempty"`
	// FreeAlbumsUsed drives the Settings meter and the paywall decision. Sent from
	// the server because the client must never be the authority on it.
	FreeAlbumsUsed  int64 `json:"freeAlbumsUsed"`
	FreeAlbumsTotal int   `json:"freeAlbumsTotal"`
}

func (h *Handlers) getMe(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)

	user, err := h.Users().GetUserByID(r.Context(), uid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// The token verified but the user is gone — a deleted account still
			// holding a live access token. Treat as unauthenticated.
			respond(w, r, problem.Unauthorized("Please sign in again."))
			return
		}
		respond(w, r, problem.Internal(err))
		return
	}

	used, err := h.Users().CountFreeSlotsUsed(r.Context(), uid)
	if err != nil {
		respond(w, r, problem.Internal(err))
		return
	}

	out := meResponse{
		ID:              user.ID.String(),
		DisplayName:     user.DisplayName,
		FreeAlbumsUsed:  used,
		FreeAlbumsTotal: h.Config.Limit.FreeAlbumSlots,
	}
	if user.Email != nil {
		out.Email = *user.Email
	}
	respondJSON(w, r, http.StatusOK, out)
}

func (h *Handlers) updateMe(w http.ResponseWriter, r *http.Request) {
	var body struct {
		DisplayName *string `json:"displayName"`
	}
	if err := decodeJSON(r, &body); err != nil {
		respond(w, r, err)
		return
	}
	if body.DisplayName != nil && *body.DisplayName == "" {
		respond(w, r, problem.Validation("Your name cannot be empty.",
			map[string]string{"displayName": "required"}))
		return
	}

	user, err := h.Users().UpdateUserProfile(r.Context(), sqlcgen.UpdateUserProfileParams{
		ID:          userID(r),
		DisplayName: body.DisplayName,
	})
	if err != nil {
		respond(w, r, problem.Internal(err))
		return
	}

	out := meResponse{
		ID:              user.ID.String(),
		DisplayName:     user.DisplayName,
		FreeAlbumsTotal: h.Config.Limit.FreeAlbumSlots,
	}
	if user.Email != nil {
		out.Email = *user.Email
	}
	respondJSON(w, r, http.StatusOK, out)
}
