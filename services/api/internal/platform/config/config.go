// Package config loads all runtime configuration from the environment.
//
// One struct, parsed once at startup, passed explicitly. No package-level
// globals and no reading os.Getenv from inside business logic — that is how
// configuration becomes untestable and how a production default silently leaks
// into a test.
package config

import (
	"errors"
	"fmt"
	"time"

	"github.com/caarlos0/env/v11"
)

// Env identifies the deployment environment. Some behaviour is deliberately
// gated on Env == Local (the OTP peek endpoint, verbose errors), so this is
// security-relevant, not cosmetic.
type Env string

const (
	EnvLocal      Env = "local"
	EnvTest       Env = "test"
	EnvStaging    Env = "staging"
	EnvProduction Env = "production"
)

func (e Env) IsLocal() bool { return e == EnvLocal || e == EnvTest }

type Config struct {
	Env      Env    `env:"APP_ENV" envDefault:"local"`
	LogLevel string `env:"LOG_LEVEL" envDefault:"info"`
	Port     int    `env:"API_PORT" envDefault:"8080"`

	// PublicBaseURL is the address clients reach this API on. On a developer
	// machine it must be the LAN address, not localhost, because a physical
	// device cannot resolve localhost and invite links embed this.
	PublicBaseURL string `env:"PUBLIC_BASE_URL" envDefault:"http://localhost:8080"`

	DatabaseURL     string        `env:"DATABASE_URL,required"`
	DBMaxConns      int32         `env:"DB_MAX_CONNS" envDefault:"10"`
	DBMaxConnLife   time.Duration `env:"DB_MAX_CONN_LIFETIME" envDefault:"30m"`
	ShutdownTimeout time.Duration `env:"SHUTDOWN_TIMEOUT" envDefault:"15s"`

	S3    S3
	Auth  Auth
	Faces Faces
	Limit Limits

	SMSProvider     string `env:"SMS_PROVIDER" envDefault:"fake"`
	PushProvider    string `env:"PUSH_PROVIDER" envDefault:"fake"`
	ReceiptVerifier string `env:"RECEIPT_VERIFIER" envDefault:"fake"`
}

type S3 struct {
	Region         string `env:"AWS_REGION" envDefault:"us-east-1"`
	MediaBucket    string `env:"MEDIA_BUCKET,required"`
	FaceDataBucket string `env:"FACEDATA_BUCKET,required"`
	UsePathStyle   bool   `env:"S3_USE_PATH_STYLE" envDefault:"false"`

	// Two endpoints, and the distinction is load-bearing rather than tidiness.
	//
	// SigV4 signs the Host header, so a presigned URL's host CANNOT be rewritten
	// after signing. The API therefore builds two clients: EndpointInternal for
	// its own server-side calls (HeadObject, CompleteMultipartUpload, Delete),
	// and EndpointPublic used ONLY by the presigner, pointed at an address the
	// client device can actually reach.
	//
	// Both empty means real AWS, which resolves endpoints itself.
	// See docs/adr/0003-upload-protocol.md.
	EndpointInternal string `env:"S3_ENDPOINT_INTERNAL"`
	EndpointPublic   string `env:"S3_ENDPOINT_PUBLIC"`

	// Presign lifetimes. Part URLs are deliberately long: a 400MB video on hotel
	// wifi outlives a 15-minute presign, and the failure surfaces as a 403 on
	// part 37, which reads like a bug in our code.
	PutTTL time.Duration `env:"S3_PUT_TTL" envDefault:"1h"`
	GetTTL time.Duration `env:"S3_GET_TTL" envDefault:"15m"`
}

type Auth struct {
	// PEM-encoded Ed25519 private key for access tokens. Generate a dev key with
	// `task keys:dev`.
	JWTPrivateKeyPEM string        `env:"JWT_PRIVATE_KEY_PEM"`
	JWTKeyID         string        `env:"JWT_KEY_ID" envDefault:"dev-1"`
	AccessTokenTTL   time.Duration `env:"ACCESS_TOKEN_TTL" envDefault:"15m"`
	RefreshTokenTTL  time.Duration `env:"REFRESH_TOKEN_TTL" envDefault:"2160h"` // 90d

	AppleBundleID   string   `env:"APPLE_BUNDLE_ID" envDefault:"app.photu.mobile"`
	AppleServiceID  string   `env:"APPLE_SERVICE_ID" envDefault:"app.photu.web"`
	GoogleClientIDs []string `env:"GOOGLE_CLIENT_IDS" envSeparator:","`
}

type Faces struct {
	ModelID string `env:"FACE_MODEL_ID" envDefault:"insightface:buffalo_l:1"`
	// Thresholds are configuration, never constants: published ArcFace numbers do
	// not transfer across checkpoints, image quality, or demographics, and error
	// rates are known to be uneven across skin tone, age and gender.
	MatchThreshold float64 `env:"FACE_MATCH_THRESHOLD" envDefault:"0.62"`
	WeakThreshold  float64 `env:"FACE_WEAK_THRESHOLD" envDefault:"0.45"`
}

type Limits struct {
	FreeAlbumSlots     int   `env:"FREE_ALBUM_SLOTS" envDefault:"3"`
	MaxAlbumMembers    int   `env:"MAX_ALBUM_MEMBERS" envDefault:"30"`
	MaxVideoDurationMS int64 `env:"MAX_VIDEO_DURATION_MS" envDefault:"60000"`

	// Above this size an upload uses multipart. The M1 skeleton ships single-PUT
	// only and configures this above the test assets; multipart lands in M2
	// without changing the request envelope.
	MultipartThreshold int64 `env:"MULTIPART_THRESHOLD_BYTES" envDefault:"16777216"` // 16 MiB
	MultipartPartSize  int64 `env:"MULTIPART_PART_SIZE_BYTES" envDefault:"8388608"`  // 8 MiB

	MaxImageBytes int64 `env:"MAX_IMAGE_BYTES" envDefault:"104857600"`  // 100 MiB
	MaxVideoBytes int64 `env:"MAX_VIDEO_BYTES" envDefault:"1073741824"` // 1 GiB
}

// Load parses and validates configuration from the process environment.
func Load() (Config, error) {
	var c Config
	if err := env.Parse(&c); err != nil {
		return Config{}, fmt.Errorf("parse env: %w", err)
	}
	if err := c.validate(); err != nil {
		return Config{}, err
	}
	return c, nil
}

func (c Config) validate() error {
	var errs []error

	switch c.Env {
	case EnvLocal, EnvTest, EnvStaging, EnvProduction:
	default:
		errs = append(errs, fmt.Errorf("APP_ENV %q is not one of local|test|staging|production", c.Env))
	}

	// A custom S3 endpoint requires path-style addressing: virtual-host style
	// would resolve bucket.localstack:4566, which neither container DNS nor iOS
	// will answer. Catch it here rather than as a DNS error at first upload.
	if c.S3.EndpointInternal != "" && !c.S3.UsePathStyle {
		errs = append(errs, errors.New(
			"S3_USE_PATH_STYLE must be true when S3_ENDPOINT_INTERNAL is set: "+
				"virtual-host addressing cannot resolve against a custom endpoint"))
	}

	// Presigning against the internal endpoint produces URLs signed for a host
	// only reachable from inside the docker network, so every client upload 403s
	// or fails DNS. Defaulting silently is worse than refusing to start.
	if c.S3.EndpointInternal != "" && c.S3.EndpointPublic == "" {
		errs = append(errs, errors.New(
			"S3_ENDPOINT_PUBLIC is required when S3_ENDPOINT_INTERNAL is set: "+
				"presigned URLs must be signed for an address the client can reach"))
	}

	if !c.Env.IsLocal() {
		if c.Auth.JWTPrivateKeyPEM == "" {
			errs = append(errs, errors.New("JWT_PRIVATE_KEY_PEM is required outside local"))
		}
		if len(c.Auth.GoogleClientIDs) == 0 {
			errs = append(errs, errors.New("GOOGLE_CLIENT_IDS is required outside local"))
		}
	}

	if c.Limit.MultipartPartSize < 5*1024*1024 {
		// S3 rejects non-final parts below 5 MiB.
		errs = append(errs, errors.New("MULTIPART_PART_SIZE_BYTES must be at least 5 MiB"))
	}

	return errors.Join(errs...)
}
