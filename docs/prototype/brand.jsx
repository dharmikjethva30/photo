// brand.jsx — brand exploration: 3 names × 2 aesthetics, plus visual DNA cards.

const { Avatar, AvatarStack, PhotoTile, Button, Chip, SectionLabel, Icon } = window.UI;

// Brand cards: each is a self-contained square showing a wordmark + tagline.
function BrandCard({ name, tagline, theme, variant = 'A', w = 360, h = 280 }) {
  return (
    <div style={{
      width: w, height: h, background: theme.bg, color: theme.ink, boxSizing: 'border-box',
      fontFamily: theme.sans, padding: 28, display: 'flex', flexDirection: 'column',
      borderRadius: theme.radius, position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontFamily: theme.mono, fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase', color: theme.inkMuted }}>{theme.name} · {variant}</div>
        <div style={{ width: 8, height: 8, borderRadius: 8, background: theme.accent }}/>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {variant === 'A' && (
          <div style={{ fontFamily: theme.serif, fontSize: 84, fontWeight: 500, letterSpacing: -2.5, color: theme.ink, lineHeight: 0.95 }}>
            {name}<span style={{ color: theme.accent, fontSize: 64 }}>.</span>
          </div>
        )}
        {variant === 'B' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 72, height: 72, borderRadius: 18, background: theme.ink, color: theme.bg,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: theme.serif, fontWeight: 500, fontSize: 42, letterSpacing: -1,
              position: 'relative', overflow: 'hidden',
            }}>
              <div style={{ position: 'absolute', inset: 6, borderRadius: '50%', border: `2px solid ${theme.bg}`, opacity: 0.4 }}/>
              <span style={{ position: 'relative' }}>{name[0]}</span>
            </div>
            <div style={{ fontFamily: theme.serif, fontSize: 56, fontWeight: 500, letterSpacing: -1.5, color: theme.ink }}>{name}</div>
          </div>
        )}
        {variant === 'C' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: theme.mono, fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', color: theme.inkMuted, marginBottom: 8 }}>—  album  —</div>
            <div style={{ fontFamily: theme.serif, fontSize: 72, fontWeight: 400, letterSpacing: -1.5, fontStyle: 'italic' }}>{name}</div>
          </div>
        )}
      </div>
      <div style={{ fontSize: 13, color: theme.inkSoft, lineHeight: 1.4, fontStyle: 'italic', fontFamily: theme.serif }}>"{tagline}"</div>
    </div>
  );
}

// Color + type swatch card
function SystemCard({ theme, w = 360, h = 280 }) {
  return (
    <div style={{
      width: w, height: h, background: theme.bg, color: theme.ink, boxSizing: 'border-box',
      fontFamily: theme.sans, padding: 24, display: 'flex', flexDirection: 'column',
      borderRadius: theme.radius,
    }}>
      <div style={{ fontFamily: theme.mono, fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase', color: theme.inkMuted }}>System · {theme.name}</div>
      <div style={{ height: 14 }} />
      <div style={{ display: 'flex', gap: 6 }}>
        {[theme.bg, theme.surface, theme.surfaceAlt, theme.ink, theme.accent, theme.accentSoft].map((c, i) => (
          <div key={i} style={{ flex: 1, height: 44, background: c, borderRadius: 6, border: i === 0 ? `1px solid ${theme.line}` : 'none' }}/>
        ))}
      </div>
      <div style={{ height: 18 }} />
      <div style={{ fontFamily: theme.serif, fontSize: 38, fontWeight: 500, letterSpacing: -0.6, lineHeight: 1 }}>Aa Bb Cc</div>
      <div style={{ fontFamily: theme.serif, fontSize: 13, color: theme.inkMuted, marginTop: 4 }}>Display · {theme.serif.split(',')[0].replace(/"/g, '')}</div>
      <div style={{ height: 14 }} />
      <div style={{ fontSize: 16, fontWeight: 500 }}>The quick brown fox jumps over the lazy dog.</div>
      <div style={{ fontFamily: theme.mono, fontSize: 11, color: theme.inkMuted, marginTop: 4 }}>Body · Inter Tight</div>
    </div>
  );
}

// Tone-of-voice card
function ToneCard({ theme, w = 360, h = 280 }) {
  return (
    <div style={{ width: w, height: h, background: theme.surface, padding: 24, boxSizing: 'border-box', fontFamily: theme.sans, borderRadius: theme.radius, border: `1px solid ${theme.line}`, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontFamily: theme.mono, fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase', color: theme.inkMuted }}>Voice samples</div>
      <div>
        <div style={{ fontSize: 11, color: theme.inkMuted, fontFamily: theme.mono, marginBottom: 4 }}>EMPTY STATE</div>
        <div style={{ fontFamily: theme.serif, fontSize: 18, fontWeight: 500, lineHeight: 1.3, color: theme.ink }}>"No photos of you yet — they'll appear here as the group uploads."</div>
      </div>
      <div>
        <div style={{ fontSize: 11, color: theme.inkMuted, fontFamily: theme.mono, marginBottom: 4 }}>HIDE-ME NOTIFY</div>
        <div style={{ fontFamily: theme.serif, fontSize: 16, fontWeight: 500, lineHeight: 1.3, color: theme.ink, fontStyle: 'italic' }}>"Dev hid a photo. No reason needed, just a heads up."</div>
      </div>
      <div>
        <div style={{ fontSize: 11, color: theme.inkMuted, fontFamily: theme.mono, marginBottom: 4 }}>WINDOW CLOSING</div>
        <div style={{ fontFamily: theme.serif, fontSize: 16, fontWeight: 500, lineHeight: 1.3, color: theme.ink }}>"36 hours to add the rest. Then this becomes a keepsake."</div>
      </div>
    </div>
  );
}

window.BrandCard = BrandCard;
window.SystemCard = SystemCard;
window.ToneCard = ToneCard;
