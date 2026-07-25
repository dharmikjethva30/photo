# ADR 0001 — Monorepo tooling

**Status:** accepted · **Date:** 2026-07-25

## Context

One repository must hold a React Native app (Expo bare), a Next.js web app,
shared TypeScript packages, a Go API service, and a Python face/media worker.
Three languages, four runtimes, two package managers' worth of dependency graphs.

## Decision

### JS: pnpm workspaces + Turborepo

pnpm was already installed; Turborepo is a thin task graph with caching and
nothing else. Workspace members are `apps/*` and `packages/*` only.

**`services/*` is deliberately excluded from the workspace.** `services/api` is a
Go module and `services/mediaworker` is a uv-managed Python package. Neither has
a `package.json`, and including them would make Go and Python development depend
on a Node install.

Rejected: **Nx** (plugin-heavy, with generators you end up fighting in a bare
Expo project), **Bun** (not installed, and bare RN on Bun is still rough),
**Yarn 4** (fine, but no reason to add a second package manager).

### `node-linker=hoisted` is mandatory

`.npmrc` sets `node-linker=hoisted`, and it must be set **before the first
`pnpm install`**.

pnpm's default symlinked store is the single largest source of failure in an
Expo bare monorepo, in three independent places: Metro's resolver walks real
paths, Gradle autolinking resolves module paths from `settings.gradle`, and
CocoaPods resolves relative `Podfile` paths. `hoisted` produces an npm-flat
`node_modules` while keeping pnpm's lockfile and install speed. `task doctor`
asserts this setting, because discovering it after the first native build is
expensive and the error messages point nowhere near the cause.

### Go: one module at `services/api/go.mod`

Module path `github.com/dharmikjethva30/photo/services/api`. **Not** a root
`go.mod`: a root module makes `go build ./...` and gopls walk `apps/`,
`node_modules/`, and the Python worker. No `go.work` until a second Go module
exists, which will not happen in Phase 1. All code lives under `internal/`,
which additionally gives compiler-enforced encapsulation for free.

### Python: `services/mediaworker`, managed by uv

`pyproject.toml` + `uv.lock`, and the same `uv` in the Dockerfile. Not
`requirements.txt`: the worker has a genuinely painful dependency graph
(onnxruntime + numpy + opencv + pillow-heif ABI pins) and uv's resolver plus a
real lockfile is the difference between reproducible and not.

### Task runner: go-task, with Turborepo nested inside it

`Taskfile.yml` owns anything crossing a language or container boundary; Turborepo
owns the JS task graph and is invoked *by* Task.

Rejected: **Makefile** (tab sensitivity, poor argument passing, no built-in
sources/deps caching), **root npm scripts** (would make Go and Python development
require Node, which is backwards).

## Consequences

- A contributor touching only the Go API needs Go, Docker and go-task. No Node.
- Two generated-code contracts, both drift-checked in CI: `openapi.yaml` →
  Go + TS, and `db/migrations` → sqlc. See ADR 0005 for why the Python worker
  does not participate in the HTTP contract.
- `task doctor` becomes load-bearing rather than decorative, since "what do I
  need installed" now has a language-dependent answer.
- The `hoisted` setting must survive. If someone removes it, native builds break
  in ways that look like Metro or Gradle bugs.
