package mediasvc

import (
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"testing"

	"github.com/dharmikjethva30/photo/services/api/internal/adapter/s3store"
)

func TestValidSHA256B64(t *testing.T) {
	sum := sha256.Sum256([]byte("some part bytes"))
	good := base64.StdEncoding.EncodeToString(sum[:])

	cases := []struct {
		name string
		in   string
		want bool
	}{
		{"a real base64 sha256", good, true},
		{"empty", "", false},
		{"not base64", "!!!!not base64!!!!", false},
		// The most likely client mistake: sending hex, which decodes as base64 in
		// some cases but is the wrong length. Worth catching here, because the
		// alternative is an opaque SigV4 error on part 1.
		{"hex instead of base64", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", false},
		{"base64 of the wrong length", base64.StdEncoding.EncodeToString([]byte("too short")), false},
		{"url-safe base64", strings.NewReplacer("+", "-", "/", "_").Replace(good), false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := validSHA256B64(c.in); got != c.want {
				t.Fatalf("validSHA256B64(%q) = %v, want %v", c.in, got, c.want)
			}
		})
	}
}

func TestAgreesWithS3(t *testing.T) {
	stored := []s3store.CompletedPart{
		{PartNumber: 1, ETag: `"aaa111"`},
		{PartNumber: 2, ETag: `"BBB222"`},
		{PartNumber: 3, ETag: `"ccc333"`},
	}

	cases := []struct {
		name    string
		claimed []s3store.CompletedPart
		wantErr string
	}{
		{
			name:    "identical",
			claimed: stored,
		},
		{
			// S3 returns ETags quoted; clients forward them variously quoted,
			// unquoted or lowercased. Rejecting any of those would block a
			// perfectly good upload, so all must be accepted.
			name: "unquoted and differently cased",
			claimed: []s3store.CompletedPart{
				{PartNumber: 1, ETag: "AAA111"},
				{PartNumber: 2, ETag: "bbb222"},
			},
		},
		{
			// The expected case now that the client no longer tracks ETags.
			name: "no etags at all",
			claimed: []s3store.CompletedPart{
				{PartNumber: 1}, {PartNumber: 2}, {PartNumber: 3},
			},
		},
		{
			name:    "claims a part S3 does not have",
			claimed: []s3store.CompletedPart{{PartNumber: 9, ETag: `"zzz"`}},
			wantErr: "S3 does not have it",
		},
		{
			name:    "claims a different etag for a part S3 has",
			claimed: []s3store.CompletedPart{{PartNumber: 1, ETag: `"different"`}},
			wantErr: "does not match",
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := agreesWithS3(c.claimed, stored)
			switch {
			case c.wantErr == "" && err != nil:
				t.Fatalf("unexpected error: %v", err)
			case c.wantErr != "" && err == nil:
				t.Fatalf("expected an error containing %q, got nil", c.wantErr)
			case c.wantErr != "" && !strings.Contains(err.Error(), c.wantErr):
				t.Fatalf("error %q does not contain %q", err, c.wantErr)
			}
		})
	}
}
