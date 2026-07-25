// palettes.jsx — ten minimal palettes for Photu.
// Philosophy: low-key, paper-and-ink. One restrained accent. No fluorescents,
// no gradients, no glass. Built on near-neutrals with a tiny chroma shift so
// each one feels like a different room with the same light.

const PALETTES = {
  // ── existing two, kept as anchors ────────────────────────────────
  keepsake: {
    name: 'Keepsake', hint: 'Warm cream paper, terracotta accent. The original.',
    bg: '#F4EEE3', surface: '#FBF7EE', surfaceAlt: '#EDE5D5',
    ink: '#1B1814', inkSoft: '#5A5249', inkMuted: '#8E867A',
    line: 'rgba(27,24,20,0.10)', lineStrong: 'rgba(27,24,20,0.18)',
    accent: 'oklch(0.62 0.14 50)', accentInk: '#FFFFFF',
    accentSoft: 'oklch(0.92 0.04 60)',
    danger: 'oklch(0.55 0.18 25)', success: 'oklch(0.55 0.10 145)',
  },
  quiet: {
    name: 'Quiet', hint: 'Cool white paper, ink black, deep cobalt accent.',
    bg: '#F7F6F3', surface: '#FFFFFF', surfaceAlt: '#EFEDE8',
    ink: '#15171A', inkSoft: '#454A52', inkMuted: '#8A8F97',
    line: 'rgba(21,23,26,0.08)', lineStrong: 'rgba(21,23,26,0.16)',
    accent: 'oklch(0.50 0.10 245)', accentInk: '#FFFFFF',
    accentSoft: 'oklch(0.94 0.03 245)',
    danger: 'oklch(0.55 0.16 25)', success: 'oklch(0.55 0.10 145)',
  },

  // ── new minimal directions ──────────────────────────────────────

  // Bone: warm-grey paper, ink, soft amber. The most neutral of the warm set.
  bone: {
    name: 'Bone', hint: 'Bone-white paper. Honey accent. Like an old sketchbook.',
    bg: '#EFEAE0', surface: '#F7F3EA', surfaceAlt: '#E0DAD0',
    ink: '#181613', inkSoft: '#4A4540', inkMuted: '#8E887F',
    line: 'rgba(24,22,19,0.10)', lineStrong: 'rgba(24,22,19,0.18)',
    accent: 'oklch(0.58 0.10 75)', accentInk: '#F7F3EA',
    accentSoft: 'oklch(0.93 0.03 75)',
    danger: 'oklch(0.50 0.15 25)', success: 'oklch(0.50 0.10 145)',
  },

  // Linen: pale natural-fibre off-white, with a desaturated blush as accent.
  linen: {
    name: 'Linen', hint: 'Pale natural fibre. Old-rose accent. Soft, not sweet.',
    bg: '#F1ECE5', surface: '#FAF6EE', surfaceAlt: '#E2DCD2',
    ink: '#1A1714', inkSoft: '#4F4944', inkMuted: '#8C857C',
    line: 'rgba(26,23,20,0.09)', lineStrong: 'rgba(26,23,20,0.16)',
    accent: 'oklch(0.55 0.08 15)', accentInk: '#FAF6EE',
    accentSoft: 'oklch(0.93 0.025 15)',
    danger: 'oklch(0.50 0.15 25)', success: 'oklch(0.50 0.10 145)',
  },

  // Slate: cool grey paper, charcoal ink, deep teal accent. Very calm.
  slate: {
    name: 'Slate', hint: 'Cool grey paper, charcoal, deep teal. Calm and editorial.',
    bg: '#EEEEEC', surface: '#F6F6F4', surfaceAlt: '#DEDDD9',
    ink: '#15191B', inkSoft: '#3F4448', inkMuted: '#888B8E',
    line: 'rgba(21,25,27,0.08)', lineStrong: 'rgba(21,25,27,0.16)',
    accent: 'oklch(0.45 0.08 200)', accentInk: '#F6F6F4',
    accentSoft: 'oklch(0.93 0.025 200)',
    danger: 'oklch(0.50 0.15 25)', success: 'oklch(0.50 0.10 165)',
  },

  // Mist: bluish white, slate ink, washed periwinkle accent.
  mist: {
    name: 'Mist', hint: 'Bluish white. Washed periwinkle accent. Like a foggy morning.',
    bg: '#EEF0F2', surface: '#F8FAFB', surfaceAlt: '#DEE1E5',
    ink: '#161A20', inkSoft: '#42474F', inkMuted: '#878D96',
    line: 'rgba(22,26,32,0.07)', lineStrong: 'rgba(22,26,32,0.15)',
    accent: 'oklch(0.50 0.08 260)', accentInk: '#F8FAFB',
    accentSoft: 'oklch(0.93 0.025 260)',
    danger: 'oklch(0.50 0.15 25)', success: 'oklch(0.50 0.10 165)',
  },

  // Sage: pale green-tinted off-white, deep moss accent. Calm, garden-y.
  sage: {
    name: 'Sage', hint: 'Pale green-tinted paper. Deep moss accent. A garden, not a brand.',
    bg: '#EDEEE6', surface: '#F5F6EE', surfaceAlt: '#DEE0D4',
    ink: '#161814', inkSoft: '#42473F', inkMuted: '#888C82',
    line: 'rgba(22,24,20,0.09)', lineStrong: 'rgba(22,24,20,0.16)',
    accent: 'oklch(0.45 0.08 145)', accentInk: '#F5F6EE',
    accentSoft: 'oklch(0.93 0.03 145)',
    danger: 'oklch(0.50 0.15 25)', success: 'oklch(0.45 0.08 145)',
  },

  // Ash: monochrome grey paper, true black, no chroma. Restrained, bauhaus-ish.
  ash: {
    name: 'Ash', hint: 'Monochrome grey. True black accent. Pure restraint.',
    bg: '#ECECEA', surface: '#F4F4F2', surfaceAlt: '#DCDCDA',
    ink: '#0E0E0E', inkSoft: '#3A3A3A', inkMuted: '#888888',
    line: 'rgba(14,14,14,0.08)', lineStrong: 'rgba(14,14,14,0.18)',
    accent: '#0E0E0E', accentInk: '#F4F4F2',
    accentSoft: 'rgba(14,14,14,0.06)',
    danger: 'oklch(0.45 0.15 25)', success: 'oklch(0.45 0.06 145)',
  },

  // Ink: dark mode done quietly. Near-black surfaces, bone text, soft amber.
  ink: {
    name: 'Ink', hint: 'Quiet dark mode. Soft amber accent. Photos hold the light.',
    bg: '#16161A', surface: '#1E1E22', surfaceAlt: '#2A2A2F',
    ink: '#EEEAE0', inkSoft: '#B5B0A6', inkMuted: '#7A7670',
    line: 'rgba(238,234,224,0.07)', lineStrong: 'rgba(238,234,224,0.14)',
    accent: 'oklch(0.78 0.10 75)', accentInk: '#16161A',
    accentSoft: 'rgba(238,234,224,0.06)',
    danger: 'oklch(0.65 0.18 25)', success: 'oklch(0.70 0.12 145)',
  },

  // Walnut: deep warm-brown dark mode. Intimate, like a wood-panelled study.
  walnut: {
    name: 'Walnut', hint: 'Wood-panelled study. Deep warm brown, parchment text.',
    bg: '#1A140E', surface: '#241C14', surfaceAlt: '#322619',
    ink: '#F2E7D5', inkSoft: '#BDAE94', inkMuted: '#7E715E',
    line: 'rgba(242,231,213,0.07)', lineStrong: 'rgba(242,231,213,0.14)',
    accent: 'oklch(0.72 0.10 60)', accentInk: '#1A140E',
    accentSoft: 'rgba(242,231,213,0.06)',
    danger: 'oklch(0.65 0.18 25)', success: 'oklch(0.65 0.12 145)',
  },

  // Porcelain: nearly-white off-white, true black ink, no accent — pure type.
  porcelain: {
    name: 'Porcelain', hint: 'Nearly-white. True black. The accent is the photograph.',
    bg: '#F5F4F0', surface: '#FFFFFF', surfaceAlt: '#EAE9E4',
    ink: '#0C0C0C', inkSoft: '#3A3A38', inkMuted: '#878680',
    line: 'rgba(12,12,12,0.07)', lineStrong: 'rgba(12,12,12,0.16)',
    accent: '#0C0C0C', accentInk: '#FFFFFF',
    accentSoft: 'rgba(12,12,12,0.05)',
    danger: 'oklch(0.50 0.15 25)', success: 'oklch(0.45 0.08 145)',
  },
};

// Shared structural tokens — every palette uses the same type + radii so we
// can swap freely without screens jumping around.
const SHARED = {
  serif: '"EB Garamond", "Iowan Old Style", Georgia, serif',
  sans: '"Inter Tight", "Inter", -apple-system, system-ui, sans-serif',
  mono: '"JetBrains Mono", "SF Mono", ui-monospace, monospace',
  radius: 14, radiusSm: 8, radiusLg: 20,
};

// Compose: every palette gets shared tokens merged in.
const FULL_PALETTES = Object.fromEntries(
  Object.entries(PALETTES).map(([k, p]) => [k, { ...SHARED, ...p }])
);

// Helper: given a palette key, return the theme. Fall back to keepsake.
function getTheme(key) {
  return FULL_PALETTES[key] || FULL_PALETTES.keepsake;
}

// Determine if a palette is dark (used by the floating tab island, etc.)
function isDarkPalette(p) {
  const c = (p.bg || '').toLowerCase();
  if (c.startsWith('#') && c.length >= 4) {
    const r = parseInt(c.length === 4 ? c[1]+c[1] : c.slice(1,3), 16);
    const g = parseInt(c.length === 4 ? c[2]+c[2] : c.slice(3,5), 16);
    const b = parseInt(c.length === 4 ? c[3]+c[3] : c.slice(5,7), 16);
    return (r*0.299 + g*0.587 + b*0.114) < 130;
  }
  return false;
}

// Ordered list for UI pickers.
const PALETTE_ORDER = ['keepsake','bone','linen','porcelain','quiet','slate','mist','sage','ash','ink','walnut'];

// Override window.THEMES so all existing screens pick up the expanded set.
window.THEMES = { ...window.THEMES, ...FULL_PALETTES };
window.PALETTES = FULL_PALETTES;
window.PALETTE_ORDER = PALETTE_ORDER;
window.getTheme = getTheme;
window.isDarkPalette = isDarkPalette;

// ──────────────────────────────────────────────────────────────────
// PaletteCard — a quiet swatch card. Wordmark + 5-stop palette + sample chip.
// Designed to read as a calm reference, not a hero.
// ──────────────────────────────────────────────────────────────────
function PaletteCard({ t }) {
  const stops = [t.bg, t.surface, t.surfaceAlt, t.ink, t.accent];
  return (
    <div style={{
      width: '100%', height: '100%', boxSizing: 'border-box', background: t.bg, color: t.ink,
      fontFamily: t.sans, padding: 22,
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      borderRadius: 0,
    }}>
      {/* top: meta + wordmark */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ fontFamily: t.mono, fontSize: 9.5, letterSpacing: 1.4, textTransform: 'uppercase', color: t.inkMuted }}>{t.name}</div>
          <div style={{ fontFamily: t.mono, fontSize: 9.5, color: t.inkMuted, letterSpacing: 0.6 }}>palette</div>
        </div>
        <div style={{ fontFamily: t.serif, fontSize: 44, fontWeight: 500, letterSpacing: -1.2, lineHeight: 1, marginTop: 10, color: t.ink }}>
          photu<span style={{ color: t.accent }}>.</span>
        </div>
        <div style={{ fontFamily: t.serif, fontSize: 13, color: t.inkSoft, fontStyle: 'italic', lineHeight: 1.4, marginTop: 8, maxWidth: 280 }}>
          {t.hint}
        </div>
      </div>

      {/* sample album chip */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: 10, borderRadius: t.radius,
        background: t.surface, border: `1px solid ${t.line}`,
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: t.radiusSm,
          background: 'linear-gradient(180deg,#f4b878,#d87a5a 40%,#5e3050 80%,#1c1830)',
          flexShrink: 0,
        }}/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: t.serif, fontSize: 14, fontWeight: 500, letterSpacing: -0.1, color: t.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Lisbon, March</div>
          <div style={{ fontFamily: t.mono, fontSize: 9.5, color: t.inkMuted, marginTop: 2, letterSpacing: 0.4 }}>5 · 184 PHOTOS</div>
        </div>
        <div style={{ height: 26, padding: '0 10px', borderRadius: 26, background: t.accent, color: t.accentInk, fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center' }}>Add</div>
      </div>

      {/* swatch row */}
      <div style={{ display: 'flex', gap: 1, height: 28, borderRadius: 4, overflow: 'hidden' }}>
        {stops.map((c, i) => (
          <div key={i} style={{ flex: 1, background: c, border: i === 0 ? `1px solid ${t.line}` : 'none', boxSizing: 'border-box' }}/>
        ))}
      </div>
    </div>
  );
}

window.PaletteCard = PaletteCard;
