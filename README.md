# photu

Time-bounded group photo albums. A trip, a wedding, a Sunday roast: everyone
uploads at **original quality**, the album has a **30-day window** and then
becomes a read-only keepsake, and **face privacy** means you only see the photos
you actually appear in.

Monorepo: React Native (iOS + Android) · Go API · Postgres + pgvector · S3
(LocalStack locally) · Next.js web surface · Python face/media worker.

---

## Quick start

```bash
task doctor        # what's missing on this machine
task up:infra      # Postgres + pgvector, LocalStack S3, verified
pnpm install
pnpm turbo run test build
```

`task` with no arguments lists everything.

**Node must be ≥ 22.12.** `.npmrc` pins 22.23.1 via `use-node-version`, so pnpm
uses the right one regardless of what your shell has activated. This is not
cosmetic — see the comment in `.npmrc`.

## Layout

```
apps/mobile        Expo (bare/prebuild) — expo-router, 18 routes
apps/web           Next.js — invite landing, browse-only gallery, lightbox, magic-link uploader
packages/tokens    design tokens: 11 palettes, type scale, radii, motion  ← source of truth
packages/ui-spec   types-only prop contracts shared by native and web
packages/ui-native React Native primitives + ThemeProvider
packages/ui-web    DOM primitives off the same tokens
packages/core      framework-free logic (window countdown, date grouping, album status)
packages/api-contract  openapi.yaml + generated TS client
services/api       Go: chi + pgx/sqlc, own go.mod
services/mediaworker   Python: thumbnails + InsightFace embeddings, uv-managed
infra/             Postgres and LocalStack init hooks
docs/adr/          the five decisions everything else hangs off
docs/prototype/    the design handoff bundle — reference only, never imported
```

## Read these before writing code

| If you're touching… | Read |
|---|---|
| anything | [`docs/adr/`](docs/adr/) — five short ADRs |
| UI | [`docs/design-system.md`](docs/design-system.md) — including three corrections to what the prototype appears to say |
| uploads | [`docs/adr/0003-upload-protocol.md`](docs/adr/0003-upload-protocol.md) |
| album reads, faces, or anything privacy-adjacent | [`docs/adr/0005-face-privacy-enforced-in-sql.md`](docs/adr/0005-face-privacy-enforced-in-sql.md) |
| product scope | `docs/prototype/uploads/spec.txt` |

## Three things that will bite you

**Presigned URLs cannot be re-hosted.** SigV4 signs the `Host` header, and a
phone cannot resolve `localhost` or the compose service name `localstack`. The
API therefore builds two S3 clients — one for its own calls, one used *only* by
the presigner and pointed at the LAN address. `task lan-ip` shows what that is.

**Face-privacy is enforced in SQL, in exactly one place.** Every read path — the
feed, the single-item endpoint, and the image redirect handler — shares one
predicate. Writing a "simpler" check on a new endpoint is how a photo becomes
fetchable-by-id while invisible in the feed.

**Only human-confirmed face tags grant visibility.** Automatic matching produces
*suggestions*, never confirmations, so a matching error can never leak a photo.
Do not "fix" the cold-start emptiness of a face-privacy album by lowering the
match threshold.

## Verification

```bash
task verify:infra   # Postgres extensions, buckets, CORS, lifecycle rules
task test           # Go + Python + JS
task lint
task smoke          # end-to-end: sign in → create album → upload → read back
```

`task smoke` asserts the round-tripped original's sha256 matches the input
byte-for-byte. That is the regression gate for "no compression, ever".

## Status

M0 (foundation) is complete: monorepo tooling, verified local infrastructure,
design tokens for all 11 palettes, shared prop contracts, and the bundled font
pipeline. M1 is the walking skeleton — sign in → create album → upload originals
to S3 → feed → viewer, with nothing mocked.
