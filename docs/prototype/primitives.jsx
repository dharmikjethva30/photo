// primitives.jsx — shared UI atoms used across all screens.
// All components take a `theme` prop (one of THEMES.keepsake / THEMES.quiet).

const { THEMES, PHONE, PEOPLE, PHOTO_SET, personColor, photoBackground } = window;

// Avatar ─────────────────────────────────────────────────────────────────────
function Avatar({ id, size = 28, ring = false, theme }) {
  const p = PEOPLE.find(x => x.id === id) || { initials: '?', hue: 0 };
  return (
    <div style={{
      width: size, height: size, borderRadius: size,
      background: `oklch(0.82 0.08 ${p.hue})`,
      color: `oklch(0.30 0.10 ${p.hue})`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: theme.sans, fontWeight: 600,
      fontSize: size * 0.38, letterSpacing: 0.2,
      boxShadow: ring ? `0 0 0 2px ${theme.bg}, 0 0 0 ${2 + 1.5}px ${theme.accent}` : 'none',
      flexShrink: 0,
    }}>{p.initials}</div>
  );
}

// AvatarStack ────────────────────────────────────────────────────────────────
function AvatarStack({ ids, size = 22, theme, max = 4, more }) {
  const shown = ids.slice(0, max);
  const extra = (more ?? ids.length) - shown.length;
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {shown.map((id, i) => (
        <div key={id} style={{ marginLeft: i ? -size * 0.32 : 0,
          boxShadow: `0 0 0 1.5px ${theme.bg}`, borderRadius: size }}>
          <Avatar id={id} size={size} theme={theme} />
        </div>
      ))}
      {extra > 0 && (
        <div style={{
          marginLeft: -size * 0.32,
          width: size, height: size, borderRadius: size,
          background: theme.surfaceAlt, color: theme.inkSoft,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: theme.sans, fontWeight: 600, fontSize: size * 0.36,
          boxShadow: `0 0 0 1.5px ${theme.bg}`,
        }}>+{extra}</div>
      )}
    </div>
  );
}

// PhotoTile — visual stand-in for a photo. Optionally show face markers.
function PhotoTile({ photo, theme, w = 120, showFaces = false, dimmed = false,
  rounded = theme.radiusSm, label, badge, onClick }) {
  const h = w / photo.ar;
  return (
    <div onClick={onClick} style={{
      width: w, height: h, borderRadius: rounded, position: 'relative',
      overflow: 'hidden', background: photoBackground(photo, theme),
      boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.1)',
      filter: dimmed ? 'grayscale(0.6) opacity(0.45)' : undefined,
      cursor: onClick ? 'pointer' : undefined,
      flexShrink: 0,
    }}>
      {/* film-style scene grain */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at 30% 20%, rgba(255,255,255,0.18), transparent 50%), radial-gradient(ellipse at 80% 90%, rgba(0,0,0,0.25), transparent 60%)',
        mixBlendMode: 'overlay',
      }} />
      {showFaces && photo.faces.length > 0 && (
        <div style={{ position: 'absolute', inset: 0 }}>
          {photo.faces.slice(0, 3).map((id, i) => {
            const xs = [0.32, 0.58, 0.46];
            const ys = [0.42, 0.38, 0.55];
            return (
              <div key={id} style={{
                position: 'absolute',
                left: `${xs[i] * 100}%`, top: `${ys[i] * 100}%`,
                width: w * 0.14, height: w * 0.14,
                borderRadius: 4,
                border: `1.5px solid ${id === 'me' ? theme.accent : 'rgba(255,255,255,0.85)'}`,
                boxShadow: '0 0 0 1px rgba(0,0,0,0.25)',
                transform: 'translate(-50%, -50%)',
              }} />
            );
          })}
        </div>
      )}
      {badge && (
        <div style={{
          position: 'absolute', top: 6, left: 6,
          padding: '2px 6px', borderRadius: 4,
          background: 'rgba(0,0,0,0.55)', color: '#fff',
          fontFamily: theme.mono, fontSize: 9, letterSpacing: 0.4,
          textTransform: 'uppercase',
        }}>{badge}</div>
      )}
      {label && (
        <div style={{
          position: 'absolute', bottom: 6, left: 8,
          fontFamily: theme.mono, fontSize: 9, color: 'rgba(255,255,255,0.85)',
          letterSpacing: 0.4,
        }}>{label}</div>
      )}
    </div>
  );
}

// Button ─────────────────────────────────────────────────────────────────────
function Button({ children, kind = 'primary', size = 'md', full, theme,
  leading, trailing, onClick, style }) {
  const heights = { sm: 32, md: 44, lg: 52 };
  const fonts = { sm: 13, md: 15, lg: 16 };
  const pads = { sm: 12, md: 18, lg: 22 };
  const styles = {
    primary: { background: theme.ink, color: theme.bg, border: 'none' },
    accent:  { background: theme.accent, color: theme.accentInk, border: 'none' },
    secondary: { background: theme.surfaceAlt, color: theme.ink, border: 'none' },
    outline: { background: 'transparent', color: theme.ink, border: `1px solid ${theme.lineStrong}` },
    ghost:   { background: 'transparent', color: theme.ink, border: 'none' },
    danger:  { background: 'transparent', color: theme.danger, border: `1px solid ${theme.danger}` },
  };
  return (
    <button onClick={onClick} style={{
      height: heights[size], padding: `0 ${pads[size]}px`,
      borderRadius: heights[size] / 2,
      fontFamily: theme.sans, fontSize: fonts[size], fontWeight: 600,
      letterSpacing: -0.1, cursor: onClick ? 'pointer' : 'default',
      display: 'inline-flex', alignItems: 'center', gap: 8,
      width: full ? '100%' : undefined, justifyContent: 'center',
      ...styles[kind], ...style,
    }}>
      {leading}{children}{trailing}
    </button>
  );
}

// Pill / Chip
function Chip({ children, tone = 'neutral', theme, leading, style }) {
  const tones = {
    neutral: { bg: theme.surfaceAlt, fg: theme.inkSoft },
    accent:  { bg: theme.accentSoft, fg: theme.accent },
    danger:  { bg: 'oklch(0.94 0.04 25)', fg: theme.danger },
    ink:     { bg: theme.ink, fg: theme.bg },
    glass:   { bg: 'rgba(0,0,0,0.55)', fg: '#fff' },
  };
  const t = tones[tone];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '4px 10px', borderRadius: 999,
      background: t.bg, color: t.fg,
      fontFamily: theme.sans, fontSize: 12, fontWeight: 600, letterSpacing: -0.1,
      ...style,
    }}>{leading}{children}</span>
  );
}

// Section header (small uppercase)
function SectionLabel({ children, theme, style }) {
  return <div style={{
    fontFamily: theme.mono, fontSize: 10.5, letterSpacing: 1.4,
    textTransform: 'uppercase', color: theme.inkMuted, ...style,
  }}>{children}</div>;
}

// Phone status bar (light variant for use over photos handled inline)
function StatusBar({ theme, dark = false, time = '9:41' }) {
  const c = dark ? '#fff' : theme.ink;
  return (
    <div style={{
      height: 44, padding: '0 24px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      fontFamily: theme.sans,
    }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: c }}>{time}</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <svg width="17" height="11" viewBox="0 0 17 11"><rect x="0" y="7" width="3" height="4" rx="0.6" fill={c}/><rect x="4" y="5" width="3" height="6" rx="0.6" fill={c}/><rect x="8" y="3" width="3" height="8" rx="0.6" fill={c}/><rect x="12" y="0" width="3" height="11" rx="0.6" fill={c}/></svg>
        <svg width="24" height="12" viewBox="0 0 24 12"><rect x="0.5" y="0.5" width="20" height="11" rx="3" stroke={c} strokeOpacity="0.4" fill="none"/><rect x="2" y="2" width="14" height="8" rx="1.5" fill={c}/></svg>
      </div>
    </div>
  );
}

// Icon set — minimal stroked
function Icon({ name, size = 20, color = 'currentColor', stroke = 1.6 }) {
  const props = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const I = (children) => <svg {...props}>{children}</svg>;
  switch (name) {
    case 'plus': return I(<><path d="M12 5v14M5 12h14"/></>);
    case 'play': return I(<path d="M7 5l12 7-12 7V5z" fill={color}/>);
    case 'pause': return I(<><path d="M8 5v14M16 5v14"/></>);
    case 'check': return I(<path d="M5 12.5l4.5 4.5L19 7.5"/>);
    case 'x': return I(<><path d="M6 6l12 12M18 6L6 18"/></>);
    case 'chevron-right': return I(<path d="M9 6l6 6-6 6"/>);
    case 'chevron-left': return I(<path d="M15 6l-6 6 6 6"/>);
    case 'chevron-down': return I(<path d="M6 9l6 6 6-6"/>);
    case 'arrow-right': return I(<><path d="M5 12h14M13 6l6 6-6 6"/></>);
    case 'arrow-up': return I(<><path d="M12 19V5M6 11l6-6 6 6"/></>);
    case 'camera': return I(<><rect x="3" y="6" width="18" height="14" rx="3"/><circle cx="12" cy="13" r="4"/><path d="M9 6l1.5-2h3L15 6"/></>);
    case 'image': return I(<><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 16l-5-5-9 9"/></>);
    case 'images': return I(<><rect x="6" y="6" width="15" height="15" rx="3"/><path d="M3 16V5a2 2 0 012-2h11"/></>);
    case 'upload': return I(<><path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 18v2a2 2 0 002 2h12a2 2 0 002-2v-2"/></>);
    case 'download': return I(<><path d="M12 4v12M6 10l6 6 6-6"/><path d="M4 20h16"/></>);
    case 'share': return I(<><path d="M12 4v12M7 8l5-5 5 5"/><path d="M5 14v5a2 2 0 002 2h10a2 2 0 002-2v-5"/></>);
    case 'link': return I(<><path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1"/><path d="M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1"/></>);
    case 'qr': return I(<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h2v2M14 18v3M18 14h3M21 18v3M16 21h-2"/></>);
    case 'lock': return I(<><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></>);
    case 'eye': return I(<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>);
    case 'eye-off': return I(<><path d="M3 3l18 18"/><path d="M10.6 10.6A2 2 0 0014 13.4M9.5 5.2A11 11 0 0112 5c6 0 10 7 10 7a18 18 0 01-3.8 4.6M6.7 6.7A18 18 0 002 12s4 7 10 7a11 11 0 005.3-1.3"/></>);
    case 'face': return I(<><circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="0.5"/><circle cx="15" cy="10" r="0.5"/><path d="M9 15c1 1 2 1.5 3 1.5s2-.5 3-1.5"/></>);
    case 'user': return I(<><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></>);
    case 'users': return I(<><circle cx="9" cy="9" r="3.5"/><path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6"/><circle cx="17" cy="7" r="2.5"/><path d="M16 13c3 0 6 2 6 5"/></>);
    case 'bell': return I(<><path d="M6 17V11a6 6 0 1112 0v6l1.5 2h-15L6 17z"/><path d="M10 21a2 2 0 004 0"/></>);
    case 'settings': return I(<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1A1.7 1.7 0 004.6 9a1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></>);
    case 'more': return I(<><circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/></>);
    case 'heart': return I(<path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.7 1-1a5.5 5.5 0 000-7.7z"/>);
    case 'sparkle': return I(<><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17l.7 1.8L21.5 19l-1.8.7L19 22l-.7-2.3L16.5 19l1.8-.7z"/></>);
    case 'clock': return I(<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>);
    case 'pin': return I(<><path d="M12 22s7-7 7-12a7 7 0 10-14 0c0 5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></>);
    case 'home': return I(<><path d="M3 11l9-7 9 7v9a2 2 0 01-2 2h-4v-7h-6v7H5a2 2 0 01-2-2z"/></>);
    case 'menu': return I(<><path d="M4 6h16M4 12h16M4 18h16"/></>);
    case 'apple': return I(<path d="M12.5 6.5c.5-1 1.5-2 2.5-2.5-.2 1.2-.8 2-1.5 2.5-.5.4-1.2.5-1 0zM18 16.5c-.5 1.2-.8 1.7-1.5 2.5-1 1-1.7 1-2.5 1s-1-.5-2-.5-1.5.5-2.5.5-1.5 0-2.5-1c-2-2-3-5-3-7 0-3 2-4.5 4-4.5 1 0 2 .5 2.5.5s1.5-.7 3-.7c1 0 2.5.5 3.5 1.7-3 1.5-2.5 5.5.5 6.5z" fill={color} stroke="none"/>);
    case 'google': return I(<path d="M21.5 12.2c0-.6 0-1.2-.2-1.7H12v3.4h5.4c-.2 1.2-.9 2.3-2 3v2.4h3.2c1.9-1.7 2.9-4.3 2.9-7.1zM12 22c2.7 0 5-1 6.6-2.6l-3.2-2.4c-.9.6-2 1-3.4 1-2.6 0-4.8-1.7-5.6-4.1H3.1v2.5C4.7 19.6 8.1 22 12 22zM6.4 13.9c-.2-.6-.3-1.3-.3-1.9s.1-1.3.3-1.9V7.6H3.1A10 10 0 002 12c0 1.6.4 3.1 1.1 4.4l3.3-2.5zM12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8C17 3.1 14.7 2 12 2 8.1 2 4.7 4.4 3.1 7.6l3.3 2.5C7.2 7.7 9.4 6 12 6z" fill={color} stroke="none"/>);
    case 'phone': return I(<path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3 19.5 19.5 0 01-6-6 19.8 19.8 0 01-3-8.6A2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8 9.8a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.5c.9.3 1.8.5 2.7.7a2 2 0 011.7 2.1z"/>);
    case 'sliders': return I(<><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h14M18 18h2"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="16" cy="18" r="2"/></>);
    default: return null;
  }
}

// Chrome context — 'ios' (default) or 'android'. Frame picks the right status bar,
// so the same screens render on both platforms (React Native parity).
window.ChromeCtx = window.ChromeCtx || React.createContext('ios');

// Android status bar (time left, punch-hole, icons right) — brand-toned, not Material.
function AndroidStatus({ theme, dark = false, time = '9:30' }) {
  const c = dark ? '#fff' : theme.ink;
  return (
    <div style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', position: 'relative', fontFamily: theme.sans }}>
      <span style={{ fontSize: 14, fontWeight: 500, color: c }}>{time}</span>
      <div style={{ position: 'absolute', left: '50%', top: 9, transform: 'translateX(-50%)', width: 22, height: 22, borderRadius: 22, background: '#1a1a1a' }}/>
      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        <svg width="14" height="14" viewBox="0 0 16 16"><path d="M8 13.3L.67 5.97a10.37 10.37 0 0114.66 0L8 13.3z" fill={c}/></svg>
        <svg width="14" height="14" viewBox="0 0 16 16"><path d="M14.67 14.67V1.33L1.33 14.67h13.34z" fill={c}/></svg>
        <svg width="14" height="14" viewBox="0 0 16 16"><rect x="3.75" y="2" width="8.5" height="13" rx="1.5" fill={c}/></svg>
      </div>
    </div>
  );
}
window.AndroidStatus = AndroidStatus;

window.UI = { Avatar, AvatarStack, PhotoTile, Button, Chip, SectionLabel, StatusBar, Icon };
