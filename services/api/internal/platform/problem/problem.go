// Package problem implements RFC 9457 "Problem Details for HTTP APIs".
//
// Every error response from this API has the same shape, and carries a stable
// `type` slug the clients switch on. That slug is part of the API contract:
// mobile maps it to user-facing copy, so renaming one is a breaking change.
//
// Messages must never leak internal detail (SQL text, file paths, wrapped driver
// errors). Detail is for the user; the underlying error goes to the log.
package problem

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
)

// ContentType is the media type required by RFC 9457.
const ContentType = "application/problem+json"

// Stable error type slugs. These are API surface — treat renames as breaking.
const (
	TypeValidation      = "validation_failed"
	TypeUnauthorized    = "unauthorized"
	TypeForbidden       = "forbidden"
	TypeNotFound        = "not_found"
	TypeConflict        = "conflict"
	TypePaymentRequired = "payment_required"
	TypeRateLimited     = "rate_limited"
	TypeInternal        = "internal_error"

	// Domain-specific slugs the clients need to branch on.
	TypeAlbumLocked      = "album_locked"
	TypeUploadWindowShut = "upload_window_closed"
	TypeFreeAlbumsUsed   = "free_albums_exhausted"
	TypeSizeMismatch     = "upload_size_mismatch"
	// TypeUploadExpired means the S3 multipart upload is gone (aborted or expired).
	// The client must re-declare; resuming is no longer possible, and it needs to
	// tell those two cases apart to avoid retrying forever.
	TypeUploadExpired   = "upload_expired"
	TypeMemberLimit     = "album_member_limit_reached"
	TypeExtensionUsed   = "window_extension_already_used"
	TypeConsentRequired = "face_consent_required"
	// TypeInviteUnusable means the code is revoked, expired, or spent. The client
	// tells these apart from "wrong code" (404) to show the right landing copy.
	TypeInviteUnusable = "invite_unusable"
)

// Problem is the wire format. Field names are fixed by RFC 9457.
type Problem struct {
	Type   string `json:"type"`
	Title  string `json:"title"`
	Status int    `json:"status"`
	Detail string `json:"detail,omitempty"`
	// Errors carries per-field validation messages, keyed by field name.
	Errors map[string]string `json:"errors,omitempty"`

	// cause is logged, never serialised.
	cause error
}

func (p *Problem) Error() string {
	if p.cause != nil {
		return fmt.Sprintf("%s: %s: %v", p.Type, p.Detail, p.cause)
	}
	return fmt.Sprintf("%s: %s", p.Type, p.Detail)
}

func (p *Problem) Unwrap() error { return p.cause }

// WithCause attaches an underlying error for logging without exposing it.
func (p *Problem) WithCause(err error) *Problem {
	clone := *p
	clone.cause = err
	return &clone
}

func New(status int, slug, detail string) *Problem {
	return &Problem{Type: slug, Title: http.StatusText(status), Status: status, Detail: detail}
}

func Validation(detail string, fields map[string]string) *Problem {
	p := New(http.StatusBadRequest, TypeValidation, detail)
	p.Errors = fields
	return p
}

func Unauthorized(detail string) *Problem {
	return New(http.StatusUnauthorized, TypeUnauthorized, detail)
}

// NotFound is also the correct response for "exists but you may not see it".
//
// Returning 403 there would confirm the resource exists, which under
// face-privacy leaks exactly what the feature protects: that a photo of someone
// exists in an album. Always 404 for a visibility miss.
func NotFound(detail string) *Problem {
	return New(http.StatusNotFound, TypeNotFound, detail)
}

func Forbidden(slug, detail string) *Problem {
	if slug == "" {
		slug = TypeForbidden
	}
	return New(http.StatusForbidden, slug, detail)
}

func Conflict(slug, detail string) *Problem {
	if slug == "" {
		slug = TypeConflict
	}
	return New(http.StatusConflict, slug, detail)
}

func PaymentRequired(slug, detail string) *Problem {
	if slug == "" {
		slug = TypePaymentRequired
	}
	return New(http.StatusPaymentRequired, slug, detail)
}

func Internal(err error) *Problem {
	return (&Problem{
		Type:   TypeInternal,
		Title:  http.StatusText(http.StatusInternalServerError),
		Status: http.StatusInternalServerError,
		Detail: "Something went wrong on our end.",
	}).WithCause(err)
}

// Write serialises err as a problem document. Anything that is not already a
// *Problem becomes a generic 500, so an unexpected error can never leak its
// message to a client.
//
// Returns the problem actually written so the caller can log it with its cause.
func Write(w http.ResponseWriter, err error) *Problem {
	var p *Problem
	if !errors.As(err, &p) {
		p = Internal(err)
	}

	w.Header().Set("Content-Type", ContentType)
	w.WriteHeader(p.Status)
	if encErr := json.NewEncoder(w).Encode(p); encErr != nil {
		// Headers are already sent, so there is nothing to do but report it
		// upward for logging.
		return p.WithCause(errors.Join(p.cause, encErr))
	}
	return p
}
