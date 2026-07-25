# Running photu locally

Every command below has been run on this machine. If one fails, `task doctor`
first — it reports what's missing.

## First time

```bash
task doctor          # what's missing
task android:setup   # JDK 17 + Android SDK + the AVD (slow, ~5GB, idempotent)
pnpm install
```

## Every session

Three long-running processes, so three terminals. Or `task dev` to bring up the
first two and be told what's left.

```bash
# Terminal 1 — Postgres + LocalStack, then migrations
task up:infra
task migrate

# Terminal 2 — the Go API on :8080
task api

# Terminal 3 — Metro, then build/install onto the emulator
task emulator          # boots the AVD (~35s); skips if already up
task mobile:android    # Gradle build + install + launch
```

`task mobile:android` starts Metro itself. Once the app is installed, a JS change
hot-reloads — you do **not** need to rebuild. Rebuild only when you change native
config (`app.config.ts`), add a native dependency, or change an icon/font.

```bash
task mobile            # just Metro, if the app is already installed
task mobile:launch     # relaunch the installed app
```

## Looking at it

```bash
task shot -- home           # screenshot to tmp/shots/home.png
task logcat                 # the app's logs, filtered to its pid
task mobile:menu            # React Native dev menu (reload, inspector, perf)
```

Right now the app opens on a **design-system verification screen** with two dev
routes: a component gallery and a palette matrix. There is no library or album
screen yet, deliberately — see "What you can and cannot test" below.

The palette matrix is worth a look: tap any palette chip to switch the whole app,
and note that `ash` and `porcelain` are flagged `accent = ink`, where the "Add"
pill and the active-tab pill become indistinguishable. That is a real design
constraint, not a rendering bug.

## Checking the backend without the app

The one command that matters:

```bash
task smoke
```

It drives the real API against real Postgres and real S3 — sign in, rotate a
refresh token, create an album, declare an upload, PUT bytes to S3, complete,
read the feed, follow the image redirect, download the original — and asserts the
downloaded original is **byte-for-byte identical** to what went up. That is the
regression test for "original quality, no compression, ever".

It also proves the things easiest to break later: declare is idempotent, a reused
refresh token is rejected, an unprocessed photo does not appear in the feed, an
unauthenticated image request is 401, and a non-member gets **404 rather than 403**
(a 403 would confirm the photo exists).

```bash
curl -s localhost:8080/healthz | jq        # liveness
curl -s localhost:8080/readyz  | jq        # real Postgres + S3 probes
curl -s localhost:8080/.well-known/jwks.json | jq   # access-token verification key
```

Signing in by hand — `APP_ENV=local` accepts any token as a stable fake identity,
so no Apple or Google credentials are needed:

```bash
TOKEN=$(curl -s -X POST localhost:8080/v1/auth/apple \
  -H 'Content-Type: application/json' -d '{"idToken":"me"}' | jq -r .accessToken)

curl -s -H "Authorization: Bearer $TOKEN" localhost:8080/v1/me | jq
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Lisbon, March","template":"trip"}' localhost:8080/v1/albums | jq
```

To prove readiness is genuine rather than hardcoded:

```bash
docker compose stop localstack
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/readyz   # 503
docker compose start localstack
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/readyz   # 200
```

Other useful checks:

```bash
task verify:infra     # pgvector, both buckets, CORS, lifecycle rules
task db:invariants    # 23 assertions that the SCHEMA enforces the business rules
task psql             # a shell on the dev database
task test             # Go + Python + JS
```

## The networking bit that matters

The emulator is a separate machine. `localhost` there means the emulator itself,
not your Mac.

| From | Reaches your Mac as |
|---|---|
| Android emulator | `10.0.2.2` |
| iOS simulator | `localhost` (shares the host network) |
| A physical device | your LAN IP — `task lan-ip` |

The app defaults to `http://10.0.2.2:8080`, so the emulator talks to the API with
no configuration. For a physical device:

```bash
task lan-ip                                             # e.g. 192.168.1.4
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.4:8080 task mobile
```

This is also why the API signs presigned S3 URLs for a *different* host than it
uses itself: SigV4 covers the `Host` header, so a URL signed for `localstack:4566`
cannot be re-pointed at the LAN address afterwards. See
[`adr/0003`](adr/0003-upload-protocol.md).

## What you can and cannot test yet

**Can, via the API (`task smoke`, or curl):**
- Sign in, refresh and rotate tokens, read and edit the profile
- Create an album (consuming a free slot, capped at three by the database)
- Upload a photo at original quality and get it back byte-for-byte
- Read an album feed, with the face-privacy predicate applied
- Authorized image URLs, including the 404-not-403 behaviour for non-members

**Can, on the emulator:**
- The design system — type scale, all three fonts, 37 icons, blur, every palette

**Cannot yet:**
- Any of the above **from the app**. The mobile API client and the real
  library/feed/viewer screens are the next step (M1.10).
- Thumbnails. The Python media worker (M1.7) generates them; until then a photo
  reaches `uploaded` and its jobs are queued, but nothing flips it to `ready`.
  The smoke script fakes that one step and says so inline.
- Anything face-related. Detection and matching land in M4.

There is deliberately **no** library or album screen showing sample albums. A
screen full of invented data looks like progress while proving nothing, and the
whole point of the walking skeleton is that the first product screen is wired to a
real API. `scripts/no-mocks.sh` fails CI if prototype fixture data appears in app
code.

## When something is wrong

| Symptom | Cause |
|---|---|
| Metro can't resolve `@photu/tokens` | `node-linker=hoisted` missing from `.npmrc`, or `metro.config.js` lost its `watchFolders` |
| `Cannot find module './rolldown-binding...'` | Node below 22.12. `.npmrc` pins 22.23.1 via `use-node-version` |
| Gradle version-assertion failure | A dependency drifted from the SDK's expected version. Run `pnpm exec expo install --check` — its answer beats npm's "latest" |
| Blur renders flat on Android | The surface has no `blurTarget`. Android can only blur a `<BlurTargetView>` — see `packages/ui-native/src/useGlass.tsx` |
| App looks inverted in a screenshot | You captured it before the JS bundle loaded. Wait ~10s after launch |
| Presigned upload 403s from a device | The API signed for the wrong host. Check `S3_ENDPOINT_PUBLIC` and `task lan-ip` |
| AVD creation says "system image paths are: null" | `cmd`-line tools resolve the SDK from their own location. `task android:setup` copies them into `$ANDROID_HOME` to fix it |
