// Package s3store wraps S3 for originals, renditions and face data.
//
// THE CENTRAL DESIGN POINT: this package holds TWO S3 clients.
//
// SigV4 signs the Host header, so the host of a presigned URL cannot be
// rewritten after signing. Meanwhile the API talks to LocalStack over the docker
// network (`localstack:4566`) while a phone must use the machine's LAN address —
// and a phone cannot resolve either `localstack` or `localhost`.
//
// Therefore:
//   - `internal` performs server-side operations (HeadObject, CompleteMultipart,
//     Delete). It uses the endpoint reachable from this process.
//   - `presign` exists ONLY to sign URLs. It uses the endpoint reachable from the
//     CLIENT, so the signature covers the host the client will actually request.
//
// Getting this wrong produces a 403 SignatureDoesNotMatch, or a DNS failure, on
// the first upload from a real device — long after everything worked in tests.
// See docs/adr/0003-upload-protocol.md.
package s3store

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awscfg "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"

	"github.com/dharmikjethva30/photo/services/api/internal/platform/config"
)

type Store struct {
	internal *s3.Client
	presign  *s3.PresignClient

	mediaBucket    string
	faceDataBucket string
	putTTL         time.Duration
	getTTL         time.Duration
}

func New(ctx context.Context, cfg config.S3) (*Store, error) {
	base, err := awscfg.LoadDefaultConfig(ctx, awscfg.WithRegion(cfg.Region))
	if err != nil {
		return nil, fmt.Errorf("load aws config: %w", err)
	}

	client := func(endpoint string) *s3.Client {
		return s3.NewFromConfig(base, func(o *s3.Options) {
			if endpoint != "" {
				o.BaseEndpoint = aws.String(endpoint)
				// Mandatory against a custom endpoint: virtual-host style would
				// resolve bucket.localstack:4566. Coupled to the override rather
				// than hardcoded, because real AWS wants virtual-host style.
				o.UsePathStyle = cfg.UsePathStyle
			}
		})
	}

	internal := client(cfg.EndpointInternal)

	// Fall back to the internal endpoint only when no public one is configured,
	// which is the real-AWS case (both empty). config.validate() rejects the
	// dangerous combination of internal set and public empty.
	presignEndpoint := cfg.EndpointPublic
	if presignEndpoint == "" {
		presignEndpoint = cfg.EndpointInternal
	}

	return &Store{
		internal:       internal,
		presign:        s3.NewPresignClient(client(presignEndpoint)),
		mediaBucket:    cfg.MediaBucket,
		faceDataBucket: cfg.FaceDataBucket,
		putTTL:         cfg.PutTTL,
		getTTL:         cfg.GetTTL,
	}, nil
}

func (s *Store) MediaBucket() string    { return s.mediaBucket }
func (s *Store) FaceDataBucket() string { return s.faceDataBucket }

// Ping verifies both buckets are reachable. Used by /readyz.
func (s *Store) Ping(ctx context.Context) error {
	for _, b := range []string{s.mediaBucket, s.faceDataBucket} {
		if _, err := s.internal.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(b)}); err != nil {
			return fmt.Errorf("head bucket %s: %w", b, err)
		}
	}
	return nil
}

// PresignedPut is an upload instruction for the client.
type PresignedPut struct {
	URL       string            `json:"url"`
	Headers   map[string]string `json:"headers"`
	ExpiresAt time.Time         `json:"expiresAt"`
}

// PresignPut signs a single-object upload.
//
// The checksum is included in the signature, so S3 rejects corrupted bytes
// server-side rather than letting us discover it at decode time in the worker.
func (s *Store) PresignPut(
	ctx context.Context, key, contentType string, sizeBytes int64, sha256B64 string,
) (PresignedPut, error) {
	in := &s3.PutObjectInput{
		Bucket:        aws.String(s.mediaBucket),
		Key:           aws.String(key),
		ContentType:   aws.String(contentType),
		ContentLength: aws.Int64(sizeBytes),
	}
	if sha256B64 != "" {
		in.ChecksumSHA256 = aws.String(sha256B64)
	}

	req, err := s.presign.PresignPutObject(ctx, in, s3.WithPresignExpires(s.putTTL))
	if err != nil {
		return PresignedPut{}, fmt.Errorf("presign put %s: %w", key, err)
	}

	// Only forward headers the client MUST send for the signature to validate.
	// Sending back everything invites clients to set headers that break it.
	headers := map[string]string{"Content-Type": contentType}
	if sha256B64 != "" {
		headers["x-amz-checksum-sha256"] = sha256B64
	}

	return PresignedPut{
		URL:       req.URL,
		Headers:   headers,
		ExpiresAt: time.Now().Add(s.putTTL),
	}, nil
}

// PresignGet signs a download. Short-lived: a presigned GET is a bearer token
// that bypasses authorization entirely once issued, so it must never be logged
// in full, emailed, or embedded in a push payload.
func (s *Store) PresignGet(ctx context.Context, bucket, key string) (string, error) {
	req, err := s.presign.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	}, s3.WithPresignExpires(s.getTTL))
	if err != nil {
		return "", fmt.Errorf("presign get %s: %w", key, err)
	}
	return req.URL, nil
}

// ObjectInfo is what S3 reports about a stored object.
type ObjectInfo struct {
	SizeBytes    int64
	ContentType  string
	ChecksumB64  string
	LastModified time.Time
}

// ErrNotFound reports a missing object, so callers can distinguish "not uploaded
// yet" from a real S3 failure.
var ErrNotFound = errors.New("object not found")

// ErrChecksumRequired reports a part-URL request with no SHA-256. Signing without it
// would produce a URL that S3 rejects, so this fails loudly at the caller instead.
var ErrChecksumRequired = errors.New("a base64 sha256 is required for each part")

// Head reads object metadata. This is the trust boundary of the upload protocol:
// the client DECLARED a size and checksum up front, and this is where we verify
// what actually landed. Without it, byte_size is a client-controlled number
// feeding quota accounting and storage cost.
func (s *Store) Head(ctx context.Context, bucket, key string) (ObjectInfo, error) {
	out, err := s.internal.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		var nf *types.NotFound
		if errors.As(err, &nf) {
			return ObjectInfo{}, ErrNotFound
		}
		// LocalStack and some S3-compatible stores return a bare 404 rather than
		// a typed NotFound, so fall back to the status code.
		var respErr interface{ HTTPStatusCode() int }
		if errors.As(err, &respErr) && respErr.HTTPStatusCode() == http.StatusNotFound {
			return ObjectInfo{}, ErrNotFound
		}
		return ObjectInfo{}, fmt.Errorf("head object %s: %w", key, err)
	}

	info := ObjectInfo{}
	if out.ContentLength != nil {
		info.SizeBytes = *out.ContentLength
	}
	info.ContentType = aws.ToString(out.ContentType)
	info.ChecksumB64 = aws.ToString(out.ChecksumSHA256)
	if out.LastModified != nil {
		info.LastModified = *out.LastModified
	}
	return info, nil
}

func (s *Store) Delete(ctx context.Context, bucket, key string) error {
	_, err := s.internal.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return fmt.Errorf("delete object %s: %w", key, err)
	}
	return nil
}

// --- key layout ------------------------------------------------------------
//
// Album-first prefixes make "delete album" a single-prefix delete and let
// lifecycle transitions after lock be album-scoped.
//
// The original filename NEVER appears in a key: user-controlled bytes in object
// keys is a slow-motion encoding bug.

func OriginalKey(albumID, mediaID, ext string) string {
	return fmt.Sprintf("albums/%s/orig/%s%s", albumID, mediaID, normaliseExt(ext))
}

func RenditionKey(albumID, mediaID, name string) string {
	return fmt.Sprintf("albums/%s/rend/%s/%s.jpg", albumID, mediaID, name)
}

func AvatarKey(userID, rand string) string {
	return fmt.Sprintf("users/%s/avatar/%s.jpg", userID, rand)
}

// FaceReferenceKey lives in the face-data bucket, which has its own KMS key and
// retention rule so "delete my face data" is a provable prefix delete.
func FaceReferenceKey(userID, referenceID string) string {
	return fmt.Sprintf("users/%s/refs/%s.jpg", userID, referenceID)
}

func FaceCropKey(albumID, faceID string) string {
	return fmt.Sprintf("albums/%s/crops/%s.jpg", albumID, faceID)
}

func normaliseExt(ext string) string {
	if ext == "" {
		return ""
	}
	ext = strings.ToLower(ext)
	if !strings.HasPrefix(ext, ".") {
		ext = "." + ext
	}
	return ext
}
