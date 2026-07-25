import { describe, expect, it } from 'vitest'
import { avatarColor, avatarRamp, initials, occasionColor } from './avatar'
import { DEFAULT_PALETTE, getPalette, PALETTE_ORDER, PALETTES } from './palettes'
import { semanticColors } from './semantic'
import { textStyles } from './textStyles'

/**
 * The colour-bearing keys of a Palette. Listed explicitly rather than taking
 * every string field, because `key`, `name` and `hint` are prose.
 */
const COLOR_KEYS = [
  'bg',
  'surface',
  'surfaceAlt',
  'ink',
  'inkSoft',
  'inkMuted',
  'line',
  'lineStrong',
  'accent',
  'accentInk',
  'accentSoft',
  'danger',
  'success',
] as const

/** Every colour-bearing string this package can hand to React Native. */
const allColorValues = (): string[] => [
  ...Object.values(PALETTES).flatMap(p => COLOR_KEYS.map(k => p[k])),
  ...Object.values(semanticColors(false)),
  ...Object.values(semanticColors(true)),
  ...avatarRamp.flatMap(a => [a.bg, a.fg, a.marker]),
  ...Object.values(occasionColor),
]

/** Guards the list above against a token being added to Palette and missed here. */
const NON_COLOR_KEYS = ['key', 'name', 'hint', 'isDark']

describe('no CSS colour functions reach React Native', () => {
  // This is the regression guard for the whole oklch conversion. React Native
  // silently renders an unparseable colour as transparent or black depending on
  // platform, so a reintroduced oklch() is a visual bug with no error message.
  it.each(['oklch(', 'lab(', 'lch(', 'color-mix(', 'hsl(', 'var(--'])(
    'no value contains %s',
    token => {
      const offenders = allColorValues().filter(v => v.includes(token))
      expect(offenders, `found ${token} in: ${offenders.join(', ')}`).toEqual([])
    },
  )

  it('every colour is hex or rgba', () => {
    const valid = /^(#[0-9A-Fa-f]{6}|rgba?\((\s*[\d.]+\s*,){2,3}\s*[\d.]+\s*\))$/
    const offenders = allColorValues().filter(v => !valid.test(v))
    expect(offenders).toEqual([])
  })

  it('COLOR_KEYS covers every colour field on Palette', () => {
    // Without this, adding a token to Palette and forgetting to list it above
    // would exempt it from the oklch and format checks — the exact way an
    // unparseable colour could slip back in unnoticed.
    const actual = Object.keys(PALETTES.quiet)
      .filter(k => !NON_COLOR_KEYS.includes(k))
      .sort()
    expect(actual).toEqual([...COLOR_KEYS].sort())
  })
})

describe('palettes', () => {
  it('PALETTE_ORDER covers every palette exactly once', () => {
    expect([...PALETTE_ORDER].sort()).toEqual(Object.keys(PALETTES).sort())
    expect(new Set(PALETTE_ORDER).size).toBe(PALETTE_ORDER.length)
  })

  it('each palette key matches its record key', () => {
    for (const [key, palette] of Object.entries(PALETTES)) {
      expect(palette.key).toBe(key)
    }
  })

  it('only ink and walnut are dark', () => {
    // isDark is precomputed rather than derived at runtime; if someone adds a
    // palette and forgets the flag, blur tint and status-bar style go wrong in a
    // way that is easy to miss on a light-palette dev build.
    const dark = Object.values(PALETTES)
      .filter(p => p.isDark)
      .map(p => p.key)
      .sort()
    expect(dark).toEqual(['ink', 'walnut'])
  })

  it('precomputed isDark agrees with the prototype luma formula', () => {
    // Guards against a hand-edited flag drifting from the actual background.
    const luma = (hex: string) => {
      const r = Number.parseInt(hex.slice(1, 3), 16)
      const g = Number.parseInt(hex.slice(3, 5), 16)
      const b = Number.parseInt(hex.slice(5, 7), 16)
      return r * 0.299 + g * 0.587 + b * 0.114
    }
    for (const p of Object.values(PALETTES)) {
      expect(p.isDark, `${p.key} isDark`).toBe(luma(p.bg) < 130)
    }
  })

  it('getPalette falls back to the shipping palette, not keepsake', () => {
    // The prototype defaulted to `quiet` but fell back to `keepsake`. We resolved
    // that deliberately; this pins the resolution.
    expect(getPalette(undefined).key).toBe(DEFAULT_PALETTE)
    expect(getPalette('nonsense').key).toBe(DEFAULT_PALETTE)
    expect(getPalette('walnut').key).toBe('walnut')
  })

  it('documents the palettes where accent equals ink', () => {
    // Not a bug — a design property of ash and porcelain. Components must never
    // assume accent contrasts with ink. If this list grows, that assumption gets
    // more dangerous, so the test names the exact set.
    const collapsed = Object.values(PALETTES)
      .filter(p => p.accent.toUpperCase() === p.ink.toUpperCase())
      .map(p => p.key)
      .sort()
    expect(collapsed).toEqual(['ash', 'porcelain'])
  })
})

describe('textStyles', () => {
  it('every style has an absolute lineHeight', () => {
    // React Native requires absolute lineHeight; a multiplier silently collapses
    // to the font size.
    for (const [name, style] of Object.entries(textStyles)) {
      expect(style.lineHeight, `${name}.lineHeight`).toBeGreaterThan(style.fontSize)
    }
  })

  it('android letterSpacing overrides are looser than iOS, never tighter', () => {
    // Android applies tracking after scaling, so display type reads tighter. The
    // override exists to loosen it; a tighter value means someone inverted it.
    for (const [name, style] of Object.entries(textStyles)) {
      const s = style as { letterSpacing?: number; letterSpacingAndroid?: number }
      if (s.letterSpacingAndroid !== undefined) {
        expect(s.letterSpacing, `${name} needs a base letterSpacing`).toBeDefined()
        expect(s.letterSpacingAndroid, `${name}.letterSpacingAndroid`).toBeGreaterThan(
          s.letterSpacing as number,
        )
      }
    }
  })
})

describe('avatar colours', () => {
  it('is stable for the same id', () => {
    expect(avatarColor('user_01H8XYZ')).toEqual(avatarColor('user_01H8XYZ'))
  })

  it('distributes across the ramp', () => {
    // A hash that collapses to one bucket would make every member the same
    // colour, which looks like a bug in the avatar component rather than the hash.
    const seen = new Set(Array.from({ length: 200 }, (_, i) => avatarColor(`user_${i}`).bg))
    expect(seen.size).toBeGreaterThan(avatarRamp.length / 2)
  })

  it('derives initials', () => {
    expect(initials('Dev')).toBe('D')
    expect(initials('Maya Patel')).toBe('MP')
    expect(initials('  Anu   Kumar Jay ')).toBe('AJ')
    expect(initials('')).toBe('?')
  })
})
