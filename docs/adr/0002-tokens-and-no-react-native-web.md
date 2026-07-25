# ADR 0002 — Shared tokens, two component implementations, no react-native-web

**Status:** accepted · **Date:** 2026-07-25

## Context

The design system must serve a React Native app and a Next.js web app. The
obvious move is `react-native-web` plus one component library. The alternative is
shared *tokens* with separate component implementations.

## Decision

**Share tokens. Do not share components. Do not use react-native-web.**

- `packages/tokens` — plain TypeScript objects. Builds two outputs from one
  source: `dist/index.js` (imported directly by RN, no transform) and
  `dist/tokens.css` (generated `:root[data-palette="…"]` custom properties for
  all 11 palettes, so web switches palette with one attribute on `<html>`).
- `packages/ui-native` — RN primitives + `ThemeProvider`. Reads `theme.bg`.
- `packages/ui-web` — DOM primitives. Reads `var(--bg)`.
- `packages/ui-spec` — **types only, zero runtime.** Both implementations type
  themselves against the same prop interfaces, so adding a prop on one side is a
  compile error on the other.

## Why not react-native-web

1. **Zero screen overlap.** The web surface is four pages: invite landing,
   browse-only gallery, lightbox, magic-link uploader. The app is 18 routes, and
   none of them are those. We would be adopting a framework to share nothing.
2. **Web needs DOM semantics RN cannot express.** `<input type="file">` and real
   drag-and-drop with `DataTransfer`; `<a href>` for crawlable, unfurlable invite
   links; CSS Grid with media queries for the responsive rebuild (the prototype
   is hardcoded to 1200px with *no* mobile layout — that is the single biggest
   web task, and it is a CSS Grid task); `position: sticky` sidebars.
   react-native-web's answer to each of these is a workaround.
3. **The visual primitives genuinely differ in implementation.**
   `backdrop-filter: blur(28px)` is one CSS line on web and a native `BlurView`
   with an Android-specific method flag in RN. Gradients are `linear-gradient()`
   vs. a `<LinearGradient>` component. A "shared" component here is a platform
   switch with two bodies — which is two components plus indirection.
4. **Release coupling.** Web ships continuously; mobile ships through App Review.
   A shared component library means a web hotfix cannot land without a mobile
   regression review.

## Why plain objects rather than a styling framework

Rejected **NativeWind**: it would require re-expressing 11 JS palettes as a
Tailwind theme plus a Babel/Metro transform, arriving at less type safety than
the plain objects we already have. Rejected **Unistyles** for the same reason.
The tokens are already TypeScript; a CSS-class abstraction over them is pure loss.

## Consequences

- Eight primitives are implemented twice. That is the accepted cost, and
  `ui-spec` keeps the two honest.
- `packages/tokens` and `packages/core` must stay platform-free — `apps/web`
  imports them. Enforced by a Biome rule banning `react-native` imports from
  those two packages.
- Workspace packages are consumed as **source** (`main` → `src/index.ts`) by the
  RN app so Metro transpiles them, while `apps/web` consumes built `dist`.
  Mismatching these produces "Unexpected token" errors that look like Babel bugs
  and are not.
- `oklch` is converted to hex once at authoring time rather than at build time,
  so neither consumer carries a colour-conversion dependency. See
  `docs/design-system.md`.
