/**
 * The theme layer: React Native's view of `@photu/tokens`.
 *
 * `@photu/tokens` is deliberately platform-free (apps/web imports it too), so
 * everything that needs `Platform` or `StyleSheet` is resolved HERE:
 *   - `letterSpacingAndroid` overrides, expressed as data in the tokens
 *   - elevation, from structured data to iOS shadow props vs Android elevation
 *   - style memoisation per palette
 */
import {
  componentRadii,
  DEFAULT_PALETTE,
  type Elevation,
  elevation as elevationTokens,
  getPalette,
  PALETTES,
  type Palette,
  type PaletteKey,
  radii,
  type SemanticColors,
  screenSpace,
  semanticColors,
  space,
  type TextStyle as TokenTextStyle,
  textStyles as tokenTextStyles,
} from '@photu/tokens'
import { createContext, type ReactNode, useContext, useMemo, useRef, useState } from 'react'
import { Platform, StyleSheet, type TextStyle, type ViewStyle } from 'react-native'

/** A text style with the platform variance already resolved. */
export type ResolvedTextStyle = Omit<TokenTextStyle, 'letterSpacingAndroid'>

export type ResolvedTextStyles = Record<keyof typeof tokenTextStyles, ResolvedTextStyle>

/**
 * Resolve the Android letter-spacing overrides once per process.
 *
 * Android applies tracking after scaling, so the tight negative tracking this
 * design uses at display sizes reads visibly tighter than on iOS. The tokens
 * package cannot call Platform.select (apps/web imports it), so it ships the
 * override as data and the choice is made here.
 */
const resolveTextStyles = (): ResolvedTextStyles => {
  const out = {} as Record<string, ResolvedTextStyle>
  for (const [name, style] of Object.entries(tokenTextStyles)) {
    const { letterSpacingAndroid, ...rest } = style as TokenTextStyle
    out[name] =
      Platform.OS === 'android' && letterSpacingAndroid !== undefined
        ? { ...rest, letterSpacing: letterSpacingAndroid }
        : rest
  }
  return out as ResolvedTextStyles
}

const RESOLVED_TEXT_STYLES = resolveTextStyles()

/**
 * Convert one elevation token to real style props.
 *
 * Android cannot express a multi-layer shadow at all — it has a single
 * `elevation` value — so the token carries a pre-chosen approximation rather
 * than pretending the platforms are equivalent.
 */
export const shadow = (name: keyof typeof elevationTokens): ViewStyle => {
  const e: Elevation = elevationTokens[name]
  if (Platform.OS === 'android') {
    return { elevation: e.elevation }
  }
  return {
    shadowColor: e.shadowColor,
    shadowOffset: e.shadowOffset,
    shadowOpacity: e.shadowOpacity,
    shadowRadius: e.shadowRadius,
  }
}

export interface Theme extends Palette {
  semantic: SemanticColors
  text: ResolvedTextStyles
  radii: typeof radii
  componentRadii: typeof componentRadii
  space: typeof space
  screenSpace: typeof screenSpace
  shadow: typeof shadow
}

const buildTheme = (key: PaletteKey): Theme => {
  const palette = getPalette(key)
  return {
    ...palette,
    semantic: semanticColors(palette.isDark),
    text: RESOLVED_TEXT_STYLES,
    radii,
    componentRadii,
    space,
    screenSpace,
    shadow,
  }
}

// Built eagerly for the shipping palette; others are built on demand.
const themeCache = new Map<PaletteKey, Theme>([[DEFAULT_PALETTE, buildTheme(DEFAULT_PALETTE)]])

const themeFor = (key: PaletteKey): Theme => {
  let t = themeCache.get(key)
  if (!t) {
    t = buildTheme(key)
    themeCache.set(key, t)
  }
  return t
}

interface ThemeContextValue {
  theme: Theme
  paletteKey: PaletteKey
  /** Dev-only in the shipped app; the picker is gated behind __DEV__. */
  setPalette: (key: PaletteKey) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({
  children,
  initialPalette = DEFAULT_PALETTE,
}: {
  children: ReactNode
  initialPalette?: PaletteKey
}) {
  const [paletteKey, setPaletteKey] = useState<PaletteKey>(initialPalette)

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: themeFor(paletteKey),
      paletteKey,
      setPalette: setPaletteKey,
    }),
    [paletteKey],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme must be used inside <ThemeProvider>')
  }
  return ctx.theme
}

export function usePalette(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('usePalette must be used inside <ThemeProvider>')
  }
  return ctx
}

/** All palettes, for the dev picker and the palette-matrix screen. */
export { PALETTES, type PaletteKey }

type NamedStyles = Record<string, ViewStyle | TextStyle>

/**
 * Build a StyleSheet from the theme, memoised per palette.
 *
 * This is the point of using context rather than the prototype's prop drilling:
 * inline style objects are rebuilt on every render, and the album grid — hundreds
 * of cells, recycled while scrolling — is where that actually costs frames.
 *
 * Usage:
 *   const useStyles = createStyles(t => ({ row: { backgroundColor: t.surface } }))
 *   ...
 *   const s = useStyles()
 */
export function createStyles<T extends NamedStyles>(build: (theme: Theme) => T) {
  // One cache per createStyles call site, keyed by palette. A module-level cache
  // shared across call sites would collide on palette key.
  const cache = new Map<PaletteKey, T>()

  return function useStyles(): T {
    const { theme, paletteKey } = usePalette()
    // useRef rather than useMemo: the cache is the memo, and this avoids
    // rebuilding when an unrelated re-render occurs.
    const ref = useRef<{ key: PaletteKey; styles: T } | null>(null)

    if (ref.current?.key !== paletteKey) {
      let styles = cache.get(paletteKey)
      if (!styles) {
        styles = StyleSheet.create(build(theme)) as T
        cache.set(paletteKey, styles)
      }
      ref.current = { key: paletteKey, styles }
    }

    return ref.current.styles
  }
}
