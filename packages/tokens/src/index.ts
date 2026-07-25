/**
 * @photu/tokens — the single source of truth for design values.
 *
 * Consumed two ways from this one source (docs/adr/0002):
 *   - `@photu/ui-native` imports these objects directly. No transform.
 *   - `apps/web` imports the generated `dist/tokens.css` custom properties and
 *     switches palette with one `data-palette` attribute on <html>.
 *
 * CONSTRAINTS on this package:
 *   - No `react-native` import, ever. apps/web consumes it. Enforced by biome.
 *   - No CSS colour functions (`oklch`, `lab`, `lch`, `color-mix`). RN cannot
 *     parse them. Enforced by palettes.test.ts.
 */

export {
  type AvatarColor,
  avatarColor,
  avatarRamp,
  initials,
  type OccasionKey,
  occasionColor,
} from './avatar'
export { type Elevation, type ElevationName, elevation } from './elevation'

export { fontAssets, fontFamilies, webFontStacks } from './fonts'
export {
  avatarSizes,
  type ButtonSize,
  blur,
  buttonSizes,
  controls,
  fab,
  glassFallback,
  glassMaterial,
  grid,
  SCROLL_BOTTOM_PADDING,
  TAB_BAR_TOTAL_HEIGHT,
  tabBar,
} from './layout'
export { duration, easing, timing } from './motion'
export {
  DEFAULT_PALETTE,
  getPalette,
  PALETTE_ORDER,
  PALETTES,
  type Palette,
  type PaletteColors,
  type PaletteKey,
} from './palettes'
export { componentRadii, radii } from './radii'
export {
  overlay,
  type SemanticColors,
  semanticColors,
  toast,
  viewer,
} from './semantic'
export { screenSpace, space } from './space'
export { type TextStyle, type TextStyleName, textStyles } from './textStyles'
