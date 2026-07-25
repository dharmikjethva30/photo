package httpapi

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/dharmikjethva30/photo/services/api/internal/auth"
	"github.com/dharmikjethva30/photo/services/api/internal/platform/problem"
)

type sessionResponse struct {
	AccessToken  string    `json:"accessToken"`
	ExpiresAt    time.Time `json:"expiresAt"`
	RefreshToken string    `json:"refreshToken"`
	User         userBrief `json:"user"`
	IsNewUser    bool      `json:"isNewUser"`
}

type userBrief struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
}

func sessionToResponse(s auth.Session) sessionResponse {
	return sessionResponse{
		AccessToken:  s.AccessToken,
		ExpiresAt:    s.ExpiresAt,
		RefreshToken: s.RefreshToken,
		User:         userBrief{ID: s.UserID.String(), DisplayName: s.DisplayName},
		IsNewUser:    s.IsNewUser,
	}
}

// signIn handles POST /v1/auth/{provider}.
func (h *Handlers) signIn(w http.ResponseWriter, r *http.Request) {
	provider := chi.URLParam(r, "provider")

	var body struct {
		IDToken string `json:"idToken"`
	}
	if err := decodeJSON(r, &body); err != nil {
		respond(w, r, err)
		return
	}
	if body.IDToken == "" {
		respond(w, r, problem.Validation("An ID token is required.",
			map[string]string{"idToken": "required"}))
		return
	}

	session, err := h.Auth.SignInWithProvider(r.Context(), provider, body.IDToken, r.UserAgent())
	if err != nil {
		respond(w, r, err)
		return
	}
	respondJSON(w, r, http.StatusOK, sessionToResponse(session))
}

// refresh handles POST /v1/auth/refresh.
func (h *Handlers) refresh(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RefreshToken string `json:"refreshToken"`
	}
	if err := decodeJSON(r, &body); err != nil {
		respond(w, r, err)
		return
	}
	if body.RefreshToken == "" {
		respond(w, r, problem.Validation("A refresh token is required.",
			map[string]string{"refreshToken": "required"}))
		return
	}

	session, err := h.Auth.Refresh(r.Context(), body.RefreshToken, r.UserAgent())
	if err != nil {
		respond(w, r, err)
		return
	}
	respondJSON(w, r, http.StatusOK, sessionToResponse(session))
}

// logout handles POST /v1/auth/logout.
func (h *Handlers) logout(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RefreshToken string `json:"refreshToken"`
	}
	if err := decodeJSON(r, &body); err != nil {
		respond(w, r, err)
		return
	}
	if err := h.Auth.Logout(r.Context(), body.RefreshToken); err != nil {
		respond(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// jwks handles GET /.well-known/jwks.json, so a future service can verify our
// access tokens without sharing a secret.
func (h *Handlers) jwks(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "public, max-age=3600")
	respondJSON(w, r, http.StatusOK, h.Auth.JWKS())
}

// decodeJSON reads a JSON body, rejecting unknown fields.
//
// DisallowUnknownFields is deliberate: a client sending `refresh_token` when the
// API expects `refreshToken` otherwise gets a confusing "required" error for a
// field it believes it sent. Failing loudly on the typo is kinder.
func decodeJSON(r *http.Request, dst any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return problem.Validation("That request body could not be read.", nil).WithCause(err)
	}
	return nil
}
