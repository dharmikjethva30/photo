package s3store

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// Multipart upload, for anything above the single-PUT threshold.
//
// Why resumability is the point rather than a nicety: a 60-second 4K clip is
// 200-400 MB, and the product promise is the untouched original. On a phone network
// a single stream of that size will be interrupted. With 8 MiB parts, an
// interruption costs ONE part, not the file.
//
// See docs/adr/0003-upload-protocol.md.

// PresignedPart is one part's upload URL.
type PresignedPart struct {
	PartNumber int32  `json:"partNumber"`
	URL        string `json:"url"`
	// The checksum this URL was signed for. The client MUST send it as
	// x-amz-checksum-sha256; the URL is unusable without it.
	SHA256B64 string    `json:"sha256"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// CompletedPart is a part S3 has stored, as reported by ListParts.
//
// The checksum is part of it because CompleteMultipartUpload requires the per-part
// checksum for an upload created with a checksum algorithm — "The complete request
// must include the checksum for each part."
type CompletedPart struct {
	PartNumber int32  `json:"partNumber"`
	ETag       string `json:"etag"`
	SHA256B64  string `json:"sha256,omitempty"`
}

// PartToSign is a part the client wants a URL for, with the SHA-256 of that part's
// bytes, base64-encoded.
//
// The checksum is required, and the reason is a real S3 constraint rather than
// strictness for its own sake. See PresignParts.
type PartToSign struct {
	PartNumber int32  `json:"partNumber"`
	SHA256B64  string `json:"sha256"`
}

// CreateMultipart starts an S3 multipart upload and returns its id.
func (s *Store) CreateMultipart(ctx context.Context, key, contentType string) (string, error) {
	out, err := s.internal.CreateMultipartUpload(ctx, &s3.CreateMultipartUploadInput{
		Bucket:      aws.String(s.mediaBucket),
		Key:         aws.String(key),
		ContentType: aws.String(contentType),
		// SHA256 checksums per part, so S3 rejects a corrupted part on arrival
		// rather than us finding out when the worker fails to decode it.
		ChecksumAlgorithm: types.ChecksumAlgorithmSha256,
	})
	if err != nil {
		return "", fmt.Errorf("create multipart upload for %s: %w", key, err)
	}
	return aws.ToString(out.UploadId), nil
}

// PresignParts signs a BATCH of part URLs.
//
// Batched rather than all-at-once on purpose: a 400 MB file at 8 MiB parts is 50
// parts, and signing all of them means a large response plus 50 simultaneously-live
// credentials. The client asks for the next batch as it goes.
//
// EACH PART'S SHA-256 MUST BE KNOWN HERE, and that is not a preference — it is what
// makes the URLs usable at all. The multipart upload declares SHA256 checksums, so S3
// requires an x-amz-checksum-sha256 header on every UploadPart. SigV4 rejects any
// x-amz-* header that was not covered by the signature ("There were headers present in
// the request which were not signed"), so the value has to be baked in at signing
// time; it cannot be added by the client afterwards. LocalStack is lenient about this
// and accepts the unsigned header, which is exactly the kind of works-locally,
// fails-in-production divergence docs/adr/0003 exists to avoid.
//
// The alternative — S3's FULL_OBJECT checksum type, where the whole-object hash is
// supplied once at completion — is not available: FULL_OBJECT only works with the
// composable CRC algorithms, and SHA-256 cannot be composed from part hashes.
//
// This is why the client hashes each part as it slices it, rather than hashing the
// whole file up front: an 8 MiB hash is instant, and hashing 400 MB before the first
// byte moves would stall the upload.
func (s *Store) PresignParts(
	ctx context.Context, key, uploadID string, want []PartToSign,
) ([]PresignedPart, error) {
	parts := make([]PresignedPart, 0, len(want))
	expires := time.Now().Add(s.putTTL)

	for _, p := range want {
		if p.SHA256B64 == "" {
			return nil, fmt.Errorf("part %d: %w", p.PartNumber, ErrChecksumRequired)
		}
		req, err := s.presign.PresignUploadPart(ctx, &s3.UploadPartInput{
			Bucket:     aws.String(s.mediaBucket),
			Key:        aws.String(key),
			UploadId:   aws.String(uploadID),
			PartNumber: aws.Int32(p.PartNumber),
			// Signed, therefore mandatory in the request and unforgeable.
			ChecksumSHA256: aws.String(p.SHA256B64),
		}, s3.WithPresignExpires(s.putTTL))
		if err != nil {
			return nil, fmt.Errorf("presign part %d of %s: %w", p.PartNumber, key, err)
		}
		parts = append(parts, PresignedPart{
			PartNumber: p.PartNumber,
			URL:        req.URL,
			// Echoed back so the client sends the header it committed to. Without it
			// the client has to remember which hash went with which URL, and getting
			// that wrong fails at S3 with an opaque signature error.
			SHA256B64: p.SHA256B64,
			ExpiresAt: expires,
		})
	}
	return parts, nil
}

// ListParts reports which parts S3 has actually received.
//
// This is the server side of resume: the client asks what landed and re-uploads only
// the gaps. Asking S3 rather than trusting client-side bookkeeping means a client
// that was killed mid-part gets the truth.
func (s *Store) ListParts(ctx context.Context, key, uploadID string) ([]CompletedPart, error) {
	var out []CompletedPart
	// The SDK's marker is an opaque *string, not a part number — pass it through
	// rather than reconstructing it.
	var marker *string

	for {
		page, err := s.internal.ListParts(ctx, &s3.ListPartsInput{
			Bucket:           aws.String(s.mediaBucket),
			Key:              aws.String(key),
			UploadId:         aws.String(uploadID),
			PartNumberMarker: marker,
		})
		if err != nil {
			var noUpload *types.NoSuchUpload
			if errors.As(err, &noUpload) {
				// Aborted, expired, or already completed. Not an error: the caller
				// treats "no parts" as "start from the beginning".
				return nil, ErrNotFound
			}
			return nil, fmt.Errorf("list parts of %s: %w", key, err)
		}

		for _, p := range page.Parts {
			if p.PartNumber == nil {
				continue
			}
			out = append(out, CompletedPart{
				PartNumber: *p.PartNumber,
				ETag:       aws.ToString(p.ETag),
				SHA256B64:  aws.ToString(p.ChecksumSHA256),
			})
		}

		if page.IsTruncated == nil || !*page.IsTruncated {
			break
		}
		marker = page.NextPartNumberMarker
	}

	sort.Slice(out, func(i, j int) bool { return out[i].PartNumber < out[j].PartNumber })
	return out, nil
}

// CompleteMultipart asks S3 to assemble the parts into one object.
func (s *Store) CompleteMultipart(
	ctx context.Context, key, uploadID string, parts []CompletedPart,
) error {
	if len(parts) == 0 {
		return errors.New("cannot complete a multipart upload with no parts")
	}

	// S3 requires parts in ascending order and rejects the request otherwise, so
	// sort here rather than trusting the client to have done it.
	sorted := make([]CompletedPart, len(parts))
	copy(sorted, parts)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].PartNumber < sorted[j].PartNumber })

	completed := make([]types.CompletedPart, 0, len(sorted))
	for _, p := range sorted {
		part := types.CompletedPart{
			PartNumber: aws.Int32(p.PartNumber),
			ETag:       aws.String(p.ETag),
		}
		if p.SHA256B64 != "" {
			// Required, not optional, for an upload created with a checksum
			// algorithm: S3 rejects the whole completion if any part omits it.
			part.ChecksumSHA256 = aws.String(p.SHA256B64)
		}
		completed = append(completed, part)
	}

	_, err := s.internal.CompleteMultipartUpload(ctx, &s3.CompleteMultipartUploadInput{
		Bucket:          aws.String(s.mediaBucket),
		Key:             aws.String(key),
		UploadId:        aws.String(uploadID),
		MultipartUpload: &types.CompletedMultipartUpload{Parts: completed},
	})
	if err != nil {
		return fmt.Errorf("complete multipart upload for %s: %w", key, err)
	}
	return nil
}

// AbortMultipart discards the parts.
//
// Worth calling explicitly even though a lifecycle rule aborts incomplete uploads
// after 7 days: until then S3 bills for the parts, and the protocol is deliberately
// resumable, so abandoned uploads are normal rather than exceptional.
func (s *Store) AbortMultipart(ctx context.Context, key, uploadID string) error {
	_, err := s.internal.AbortMultipartUpload(ctx, &s3.AbortMultipartUploadInput{
		Bucket:   aws.String(s.mediaBucket),
		Key:      aws.String(key),
		UploadId: aws.String(uploadID),
	})
	if err != nil {
		var noUpload *types.NoSuchUpload
		if errors.As(err, &noUpload) {
			return nil // already gone; abort is idempotent
		}
		return fmt.Errorf("abort multipart upload for %s: %w", key, err)
	}
	return nil
}

// MaxParts is S3's hard limit on parts per multipart upload.
//
// At the configured 8 MiB part size this caps a single object at ~80 GB, far above
// any photo or 60-second clip. The clamp exists so a nonsense declared size cannot
// overflow the part count into a negative number.
const MaxParts int32 = 10000

// PartCount is how many parts a file of this size needs.
func PartCount(byteSize, partSize int64) int32 {
	if partSize <= 0 || byteSize <= 0 {
		return 0
	}
	n := byteSize / partSize
	if byteSize%partSize != 0 {
		n++
	}
	if n > int64(MaxParts) {
		return MaxParts
	}
	// Bounded to [1, MaxParts] by the check immediately above, so the conversion
	// cannot overflow. gosec cannot follow the bound.
	return int32(n) // #nosec G115
}
