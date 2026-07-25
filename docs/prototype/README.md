# Design prototype — reference only, do not import

This directory is the Claude Design handoff bundle for **photu**, checked in
verbatim so the implementation has a stable reference to compare against.

**Provenance:** `Photo app prototype development-handoff.zip`, exported from
claude.ai/design. Originally nested at
`photo-app-prototype-development/project/uploads/Photu (1)/`; flattened here for
usability. `HANDOFF-README.md` is the bundle's own README.

## Rules

- **Nothing here is imported, bundled, or executed by the product.** These are
  HTML/CSS/JS prototypes, not production code. Lint and typecheck exclude this
  directory.
- **Do not copy the fixture data.** `PHOTO_SET`, `PEOPLE`, `photoBackground()`,
  `personColor()` and the hardcoded "184 photos" are design placeholders. CI
  fails the build if they appear under `apps/` or `packages/` — see
  `scripts/no-mocks.sh`.
- **Match the visual output, not the internal structure.** The prototype uses
  prop drilling, inline styles, and a fake photo layer; the real app uses a
  theme context, `StyleSheet`, and actual pixels.

## What's authoritative for what

| Question | Read |
|---|---|
| Product scope, privacy modes, 12 flows, edge cases | `uploads/spec.txt` (identical to the `.docx`; `pasted-*.txt` is the same doc with tables stripped) |
| The 11 palettes and the shared type/radii tokens | `palettes.jsx` — **not** `theme.jsx`, which it overrides |
| Button/Chip/Icon/Avatar/PhotoTile specs | `primitives.jsx` |
| Navigation graph, the two stack-surgery behaviours, toast copy and timing | `app.jsx` |
| Screen layouts and copy | `screens-core.jsx`, `screens-album.jsx`, `screens-misc.jsx`, `screens-new.jsx` |
| The floating tab bar | `screens-core.jsx` (`TabBar`) |
| Web surfaces | `screens-web.jsx`, plus `WebUploadPage` in `screens-misc.jsx` |
| Alternate feed metaphors (grid is the chosen default) | `ui-language.jsx` |

## Files that are NOT product specification

- `design-canvas.jsx`, `tweaks-panel.jsx` — prototype tooling: a pan/zoom review
  canvas and a live token tweaker. Do not port.
- `ios-frame.jsx` — dead code. Not loaded by `index.html` and referenced by no
  other file. A generic iOS UI-kit reference whose patterns (large title, glass
  pill nav, grouped inset list) are used by **no** product screen.
- `android-frame.jsx` — loaded but unused; the artboards use `AndroidPhone` from
  `screens-new.jsx` instead. A Material-3 reference kit.
- `ScreenAndroidLibrary` / `ScreenAndroidShareSheet` in `screens-new.jsx` — a
  deliberately **rejected** Material direction (square FAB, full-width labelled
  nav bar). `index.html` renders the shared iOS screens on Android instead.
- `brand.jsx`, `FinalistCard` — naming/brand exploration. The name is settled:
  **photu**.

## Corrections

Three claims the prototype appears to make are wrong or stale. See
[`../design-system.md`](../design-system.md) before writing any UI.
