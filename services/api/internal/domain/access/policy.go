// Package access is the pure-Go mirror of the SQL visibility predicate.
//
// It exists for two reasons:
//
//  1. The rule can be unit-tested exhaustively without a database, and reads as
//     prose so a reviewer can check it against the product spec.
//  2. It is pinned to the SQL by a conformance test. Two implementations that are
//     never compared are worse than one; the test is what makes this useful rather
//     than a second thing to keep in sync by hand.
//
// This package must not import net/http, pgx, or the AWS SDK — enforced by the
// depguard rule in .golangci.yml.
package access

// PrivacyMode mirrors the album_privacy_mode enum.
type PrivacyMode string

const (
	// ModeOpen — all members see everything. Face detection still runs, to power
	// the personal "Just me" filter.
	ModeOpen PrivacyMode = "open"
	// ModeFace — each viewer sees only photos they appear in, photos with no people
	// detected, and photos a subject explicitly shared with them.
	ModeFace PrivacyMode = "face"
	// ModePrivate — the creator approves each photo before the group sees it.
	ModePrivate PrivacyMode = "private"
)

// ProcessingState mirrors the processing_state enum.
type ProcessingState string

const (
	ProcQueued  ProcessingState = "queued"
	ProcRunning ProcessingState = "running"
	ProcDone    ProcessingState = "done"
	ProcFailed  ProcessingState = "failed"
)

// MediaState mirrors the media_state enum.
type MediaState string

const (
	StatePending  MediaState = "pending"
	StateUploaded MediaState = "uploaded"
	StateReady    MediaState = "ready"
	StateFailed   MediaState = "failed"
)

// ApprovalState mirrors the media_approval_state enum.
type ApprovalState string

const (
	ApprovalNotRequired ApprovalState = "not_required"
	ApprovalPending     ApprovalState = "pending"
	ApprovalApproved    ApprovalState = "approved"
	ApprovalRejected    ApprovalState = "rejected"
)

// Viewer is who is asking.
type Viewer struct {
	UserID string
	// IsOwner is the album owner, who sees the creator-review queue.
	IsOwner bool
	// IsMember gates everything. A non-member sees nothing, whatever else holds.
	IsMember bool
}

// Album is the album-level context.
type Album struct {
	ID          string
	PrivacyMode PrivacyMode
	OwnerUserID string
}

// Media is one candidate item.
type Media struct {
	ID             string
	UploaderUserID string
	State          MediaState
	ApprovalState  ApprovalState

	// Hidden is any ACTIVE subject veto. Deliberately a bool, not a list: the veto
	// is an EXISTS, not a tally, so one subject hiding a photo removes it for
	// everyone.
	Hidden bool

	// DetectedFaceCount is only meaningful together with FaceProcState. Zero on an
	// unprocessed item as well as on a genuinely people-free one.
	DetectedFaceCount int
	FaceProcState     ProcessingState

	// Subjects are the users with a CONFIRMED face tag. Suggested tags never
	// appear here — that asymmetry is what stops a matching error leaking a photo.
	Subjects []string
}

// Grant is one allowlist entry.
type Grant struct {
	GrantorUserID string
	GranteeUserID string
	AlbumID       string
	// MediaID is set for a single-photo grant, empty for a bulk grant.
	MediaID string
	Revoked bool
}

// CanView decides whether `viewer` may see `media`.
//
// The branch order matches visibilityPredicate in
// internal/adapter/postgres/visibility.go, so the two can be read side by side.
func CanView(viewer Viewer, album Album, media Media, grants []Grant) bool {
	// Membership is a precondition, not part of the face rule.
	if !viewer.IsMember {
		return false
	}

	// Nothing that is not fully processed is visible in the VIEW path — not even to
	// its own uploader.
	//
	// The conformance test caught the two implementations disagreeing here (the Go
	// mirror let the uploader see their own not-ready item), and this is the
	// resolution: a not-ready item has no renditions, so there is literally nothing
	// to render, and on Android the HEIC original would not decode anyway. A viewer
	// tracks their own in-flight uploads through the upload endpoints and local
	// queue state, which is where progress belongs.
	//
	// Keeping the rule "ready or invisible, no exceptions" also removes a branch
	// where the face count is not yet meaningful, which is the leak this whole
	// predicate exists to prevent.
	if media.State != StateReady {
		return false
	}

	// Subject veto: absolute, and it outranks even the uploader in the shared album.
	// (The uploader keeps a private copy, surfaced through a different endpoint.)
	if media.Hidden {
		return false
	}

	// Creator review.
	if media.ApprovalState == ApprovalPending &&
		!viewer.IsOwner &&
		media.UploaderUserID != viewer.UserID {
		return false
	}
	if media.ApprovalState == ApprovalRejected {
		return media.UploaderUserID == viewer.UserID
	}

	// open and private do not filter by face.
	if album.PrivacyMode != ModeFace {
		return true
	}

	// You always see what you uploaded.
	if media.UploaderUserID == viewer.UserID {
		return true
	}

	// Photos with no people. Requires processing to have COMPLETED — an item that
	// is queued, running, or failed also reports zero faces, and treating that as
	// "no people detected" would leak it. Fail closed.
	if media.DetectedFaceCount == 0 && media.FaceProcState == ProcDone {
		return true
	}

	// Photos you appear in.
	for _, s := range media.Subjects {
		if s == viewer.UserID {
			return true
		}
	}

	for _, g := range grants {
		if g.Revoked || g.GranteeUserID != viewer.UserID || g.AlbumID != album.ID {
			continue
		}
		// A subject shared this specific photo.
		if g.MediaID == media.ID {
			return true
		}
		// A subject granted every photo they appear in — including future ones.
		if g.MediaID == "" {
			for _, s := range media.Subjects {
				if s == g.GrantorUserID {
					return true
				}
			}
		}
	}

	return false
}

// AppearsIn reports whether the viewer has a confirmed tag, which drives both the
// "Just me" filter and the face marker on a grid tile.
func AppearsIn(viewer Viewer, media Media) bool {
	for _, s := range media.Subjects {
		if s == viewer.UserID {
			return true
		}
	}
	return false
}
