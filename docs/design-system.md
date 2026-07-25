# photu design system

The prototype in [`prototype/`](prototype/) is the visual reference.
`packages/tokens` is the source of truth for values. This document records what
changed in the port and why — read it before writing UI.

## Brand

**photu** (lowercase in the wordmark). Bundle id `app.photu.mobile`, domain
`photu.app`. Tagline: *"One album. Everyone's photos. Original quality."*

`PhotuMark` is a rounded-square monogram (`borderRadius = size * 0.28`, `ink`
background, `bg` glyph `p`, plus an inset circle outline at `inset: 4`,
`borderRadius: 50%`, `1.5px solid bg`, `opacity 0.5`) optionally followed by the
serif wordmark at `size * 0.55`. Used at `size={56}` on sign-in and `size={30}`
in the library header.

## Shipping palette

**`quiet`** — cool white paper, near-black ink, deep cobalt accent. This is the
prototype's `TWEAK_DEFAULTS.aesthetic`.

All 11 palettes ship in `packages/tokens` because they cost nothing, but the
picker is gated behind `__DEV__` plus a server flag. `apps/mobile/app/(dev)/palette-matrix.tsx`
renders the feed and viewer across all 11 in one scroll — that is the contrast
regression harness.

> Note the prototype is internally inconsistent here: `TWEAK_DEFAULTS` selects
> `quiet` but `getTheme()` falls back to `keepsake`. We resolve this deliberately:
> `quiet` is both the default *and* the fallback.

---

## Three corrections

These are the mistakes most likely to cost a day each.

### 1. `radial-gradient` and `mixBlendMode` do not need porting

React Native supports neither, which looks like a serious problem. It isn't.
They appear in exactly four places, and **all four are the prototype's fake
photo layer**:

| File | What it is |
|---|---|
| `primitives.jsx:65-66` | `PhotoTile`'s simulated film grain / sheen |
| `screens-album.jsx:162-163` | the same sheen in the full-screen viewer |
| `screens-web.jsx:160` | the same sheen on the web lightbox |
| `screens-core.jsx:104` | the face-reference camera placeholder |

In the real app those surfaces contain actual pixels or a live camera preview.
**Do not build an RN radial-gradient shim.** The gradients that do survive are
all linear scrims over photos (viewer chrome, album header overlay, tile label
fades) → `expo-linear-gradient`.

If a vignette is ever genuinely wanted later: `react-native-svg`'s
`<RadialGradient>`, or a stretched PNG.

### 2. Radii are global, not per-palette

`index.html` loads `theme.jsx` then `palettes.jsx`, and `palettes.jsx` does
`window.THEMES = { ...window.THEMES, ...FULL_PALETTES }`. So **`palettes.jsx`
wins**, and its `SHARED` block sets `radius: 14, radiusSm: 8, radiusLg: 20` for
every palette. The `18 / 10 / 24` values visible in `theme.jsx`'s `keepsake` are
dead code.

Same for typography: `serif`/`sans`/`mono` live in `SHARED` and are identical
across all 11 palettes. `theme.jsx` lists Fraunces as `quiet`'s serif; that is
also overridden. **Only colour varies per palette** — a deliberate design
decision so palettes can be swapped without screens reflowing.

### 3. `ash` and `porcelain` set `accent === ink`

In those two palettes the accent colour is the ink colour (`#0E0E0E` and
`#0C0C0C`). Any component that assumes accent is *visually distinguishable* from
ink collapses: the active tab pill (`ink` background) becomes identical to a
primary button, and the accent dot in the wordmark disappears.

This is a **component API constraint**, not a palette bug. Never encode
"accent contrasts with ink". Related: `accentSoft` is a real tinted colour in the
warm palettes but `rgba(ink, 0.05–0.06)` in the dark and monochrome ones, so any
component using `accentSoft` as a background with text on it needs a paired
foreground token rather than assuming `ink` reads on it.

---

## Deliberate changes from the prototype

### Colour: `oklch` is converted at authoring time, not runtime

React Native cannot parse `oklch()`. Roughly 40 token values use it. These were
converted **once, offline**, with `culori`'s `clampChroma` + `formatHex`, eyeballed,
and committed as hex. `clampChroma` matters: several values (the `keepsake`
terracotta `oklch(0.62 0.14 50)`, the `ink` amber `oklch(0.78 0.10 75)`) sit at or
outside the sRGB gamut boundary, where naive `formatHex` clips per channel and
shifts hue.

A unit test fails if any CSS colour function (`oklch(`, `lab(`, `lch(`,
`color-mix(`) reappears in the tokens package. `rgba()` strings are kept as-is —
RN parses those.

Build-time conversion was rejected: it would add a codegen dependency to every
consumer, forever, for ~40 values that will never change again.

### Typography: named text styles, not raw font families

The prototype's `serif: '"EB Garamond", "Iowan Old Style", Georgia, serif'` is a
CSS font *stack*. RN has neither font stacks nor font synthesis, and
**`fontWeight: 500` on a custom family silently renders the wrong face on
Android**. So:

- `fonts.ts` exports per-weight named families matching the loaded file names
  (`EBGaramond-Regular`, `EBGaramond-Medium`, `EBGaramond-Italic`, …).
- `textStyles.ts` exports named styles — `display`, `title`, `titleSm`, `body`,
  `bodyStrong`, `caption`, `label`, `meta` — each carrying
  `{ fontFamily, fontSize, lineHeight, letterSpacing }`.

**Screens must not read raw families or hardcode sizes.** The prototype hardcodes
size + weight + letterSpacing at every call site (`fontSize: 54, letterSpacing: -1.2`);
porting that literally yields ~200 magic numbers and no way to fix Android
letter-spacing globally. Android applies tracking after scaling, so display-size
`letterSpacing` differs visibly — those two or three values sit behind
`Platform.select` **inside `textStyles.ts`**, keeping the divergence contained to
the tokens package.

Fonts are loaded via the **`expo-font` config plugin at build time**, not
`useFonts` at runtime: every title in this design is serif, so a runtime font
gate means a visible flash or a blocked splash on every cold start.

### `isDark` is precomputed

The prototype computes darkness at runtime by parsing `theme.bg` hex and
comparing luma against 130 — and `TabBar` inlines a second copy of that function.
Each palette now carries an explicit `isDark: boolean`, computed once with the
same formula at authoring time. Under it, only `ink` (`#16161A`) and `walnut`
(`#1A140E`) are dark. Blur tint, status-bar style and glass fallbacks key off it.

### Theme distribution: context, not prop drilling

Every prototype component takes a `theme` prop. In RN that means every component
rebuilds inline style objects on every render, and the album grid is where that
shows. Instead: a `ThemeProvider` in `packages/ui-native`, `useTheme()` returning
the flat palette (so component bodies still read `theme.bg`, `theme.radius`), and
`createStyles(fn)` memoizing `StyleSheet.create(fn(theme))` per palette key.

### Device chrome is dropped

`StatusBar`, `AndroidStatus` and `ChromeCtx` exist only to draw a fake status bar
inside a fake phone frame. Real apps get the real one. The prototype's `Frame`
becomes a `Screen` component: safe-area insets, background colour, and the scroll
padding that clears the floating tab bar.

---

## Component inventory

`packages/ui-spec` holds **types only** for the 8 primitives shared between RN
and web, so a prop added on one side is a compile error on the other:

`Button`, `Chip`, `Avatar`, `AvatarStack`, `PhotoTile`, `SectionLabel`, `Icon`,
`FormField`.

`packages/ui-native` additionally owns the mobile-only chrome: `Screen`,
`IconButton`, `FAB`, `FloatingTabBar`, `Toast`, `Sheet`, `ProgressDots`,
`Toggle`, `AlbumRow`, `AlbumHeader`, `FilterChip`, `ClosingBanner`, `ActionCard`.

Notes on specific components:

- **`Button`** — heights `sm:32 / md:44 / lg:52`, `borderRadius = height / 2`
  (fully pill), font `13 / 15 / 16`, horizontal padding `12 / 18 / 22`, weight
  600, `letterSpacing -0.1`, `gap 8`. Kinds: `primary` (ink on bg), `accent`,
  `secondary` (surfaceAlt), `outline` (1px lineStrong), `ghost`, `danger`.
  **Add an explicit `ink` kind** — screens pass `kind="ink"` (undefined in the
  prototype's map) and patch around it with an inline style.
- **`Icon`** — **36** named icons (not 39), 24×24 viewBox, `fill: none`,
  round caps/joins, default stroke 1.6. The tab bar uses 2.2 active / 1.8
  inactive. `play`, `apple`, `google` are filled rather than stroked.
- **`FloatingTabBar`** — an island, not a bar: `position: absolute`,
  `borderRadius: 999`, `backdropFilter: blur(28px) saturate(200%)`, and **only
  the active tab shows its label**. Tabs: `library`→Albums, `invites`→Invites,
  `notif`→Activity, `me`→Me. Three implementation notes:
  - `bottom` must be `insets.bottom > 0 ? insets.bottom + 6 : 18`. The
    prototype's flat `18` was measured inside a fake device frame and collides
    with a real home indicator.
  - Blur needs a `borderRadius: 999, overflow: 'hidden'` **parent**;
    `borderRadius` on `BlurView` itself does not clip on Android.
  - Export `TAB_BAR_TOTAL_HEIGHT` from tokens and add it to every scroll
    container's `paddingBottom`. The island does not reserve layout, so
    forgetting this hides the last row of every list.
- **`PhotoTile`** — real `expo-image`, `recyclingKey`, `cachePolicy: 'memory-disk'`.
  Height derives from `w / aspectRatio`. Keep the `dimmed`
  (`grayscale(0.6) opacity(0.45)`) treatment for locked albums; drop the fake
  grain overlay.

### Glass goes through one hook

Every blurred surface (tab island, viewer chrome, toast, web sticky header) is
built with `useGlass()` from `packages/ui-native`. Android needs
`experimentalBlurMethod="dimezisBlurView"` for any real blur and it costs
measurable frames on scrolling surfaces, so the hook returns either a `BlurView`
or a flat `rgba(surface, 0.92)` view based on platform plus a runtime perf flag.
One place to change, rather than a hunt.

## Motion

The system is near-static, deliberately. The complete set of declared animation:

| Where | Value |
|---|---|
| Tab island item state | `180ms ease` |
| Toggle track colour | `200ms` |
| Toggle knob position | `200ms` |
| Text caret | `1s steps(2) infinite` — a hard on/off blink, **not** a fade |
| Toast auto-dismiss | `2400ms` |

No spring configs, no easing tokens beyond `ease`, no enter/exit transitions.
Anything beyond this list is a new design decision, not a port.

## Accessibility

The prototype has **zero** accessibility annotations. The spec requires full
VoiceOver/TalkBack labels on photo controls, sufficient contrast on viewer
overlays, and accessible captions. Every control added during the port needs an
`accessibilityLabel` and `accessibilityRole` at the time it is written — this is
not a milestone that can be bolted on at the end, and the palette matrix screen
is where overlay contrast gets checked.
