// screens-web.jsx — the web surface for non-users (magic link) and browsers.
// Join teaser → browse gallery → lightbox → upload (upload lives in screens-misc).
const { Avatar, AvatarStack, PhotoTile, Button, Chip, SectionLabel, Icon } = window.UI;
const { PhotuMark } = window;

// Shared top nav for all web pages
function WebNav({ theme, albumTitle, cta = 'Sign in', onCta }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '18px 40px', borderBottom: `1px solid ${theme.line}`, background: theme.bg }}>
      <PhotuMark theme={theme} size={28}/>
      {albumTitle && (
        <>
          <div style={{ width: 1, height: 20, background: theme.lineStrong }}/>
          <div style={{ fontFamily: theme.serif, fontSize: 17, fontWeight: 500, color: theme.ink }}>{albumTitle}</div>
        </>
      )}
      <div style={{ flex: 1 }}/>
      <div style={{ fontSize: 12.5, color: theme.inkMuted, fontFamily: theme.mono }}>photu.app/a/lisbon-93jx</div>
      <Button theme={theme} kind="primary" size="sm" onClick={onCta}>{cta}</Button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// WEB JOIN — invite landing, browse-first
// ──────────────────────────────────────────────────────────────────
function WebJoinPage({ theme, w = 1200 }) {
  return (
    <div style={{ width: w, minHeight: 720, background: theme.bg, color: theme.ink, fontFamily: theme.sans, display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
      <WebNav theme={theme} cta="Sign in"/>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1.1fr', gap: 64, alignItems: 'center', padding: '40px 72px 64px' }}>
        <div>
          <Chip theme={theme} tone="accent" leading={<Avatar id="maya" size={18} theme={theme}/>}>Maya invited you</Chip>
          <h1 style={{ fontFamily: theme.serif, fontSize: 54, fontWeight: 500, letterSpacing: -1.2, lineHeight: 1.04, margin: '20px 0 14px' }}>
            Lisbon, March
          </h1>
          <p style={{ color: theme.inkSoft, fontSize: 16.5, lineHeight: 1.55, maxWidth: 400, margin: 0 }}>
            A shared album for the trip. Browse right now — no account needed. Sign in when you want to add your own photos.
          </p>
          <div style={{ margin: '20px 0 28px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <AvatarStack ids={['maya','sam','priya','leo']} theme={theme} size={26}/>
            <div style={{ fontSize: 13.5, color: theme.inkMuted }}>5 members · 184 photos · closes April 2</div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button theme={theme} kind="primary" size="lg">Browse the album</Button>
            <Button theme={theme} kind="outline" size="lg" leading={<Icon name="upload" size={16}/>}>Add photos</Button>
          </div>
          <div style={{ marginTop: 18, fontSize: 12.5, color: theme.inkMuted, lineHeight: 1.5, maxWidth: 380 }}>
            This album uses <strong style={{ color: theme.ink }}>face-privacy</strong> — members only see photos they appear in. Signing in lets the album find yours.
          </div>
        </div>
        {/* photo cluster teaser */}
        <div style={{ position: 'relative', height: 480 }}>
          {[
            { p: PHOTO_SET[8], w: 300, x: 40, y: 0, r: -4 },
            { p: PHOTO_SET[1], w: 220, x: 320, y: 60, r: 3 },
            { p: PHOTO_SET[4], w: 200, x: 90, y: 250, r: 2 },
            { p: PHOTO_SET[0], w: 260, x: 280, y: 300, r: -2 },
          ].map((c, i) => (
            <div key={i} style={{
              position: 'absolute', left: c.x, top: c.y, transform: `rotate(${c.r}deg)`,
              padding: 10, paddingBottom: 30, background: '#fff', borderRadius: 4,
              boxShadow: '0 18px 44px rgba(0,0,0,0.16)',
            }}>
              <PhotoTile photo={c.p} theme={theme} w={c.w} rounded={2}/>
            </div>
          ))}
          <div style={{ position: 'absolute', right: 20, top: 10, padding: '8px 14px', borderRadius: 999, background: theme.ink, color: theme.bg, fontSize: 12.5, fontWeight: 600, transform: 'rotate(2deg)' }}>+180 more</div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// WEB ALBUM — gallery with sidebar (browse-only shows sign-in nudge)
// ──────────────────────────────────────────────────────────────────
function WebAlbumPage({ theme, w = 1200, readOnly = true }) {
  const days = [
    { label: 'Today', photos: PHOTO_SET.slice(0, 4) },
    { label: 'Yesterday', photos: PHOTO_SET.slice(4, 8) },
    { label: 'Mar 28', photos: PHOTO_SET.slice(8, 12) },
  ];
  return (
    <div style={{ width: w, minHeight: 720, background: theme.bg, color: theme.ink, fontFamily: theme.sans, display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
      <WebNav theme={theme} albumTitle="Lisbon, March" cta={readOnly ? 'Sign in to add photos' : 'Add photos'}/>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 280px', gap: 40, padding: '28px 40px 48px', alignItems: 'start' }}>
        {/* gallery */}
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            {['All', 'Just me', 'By person', 'By scene'].map((f, i) => (
              <span key={f} style={{
                padding: '7px 14px', borderRadius: 999, fontSize: 13, fontWeight: 500,
                background: i === 0 ? theme.ink : theme.surface,
                color: i === 0 ? theme.bg : i === 1 ? theme.inkMuted : theme.ink,
                border: i === 0 ? 'none' : `1px solid ${theme.line}`,
              }}>{f}{i === 1 && readOnly ? ' · sign in' : ''}</span>
            ))}
          </div>
          {days.map(d => (
            <div key={d.label} style={{ marginBottom: 26 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontFamily: theme.serif, fontSize: 19, fontWeight: 500 }}>{d.label}</div>
                <div style={{ fontFamily: theme.mono, fontSize: 11, color: theme.inkMuted, letterSpacing: 0.5 }}>{d.photos.length} photos</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                {d.photos.map(p => (
                  <div key={p.id} style={{ aspectRatio: '1' }}>
                    <PhotoTile photo={{...p, ar: 1}} theme={theme} w={190} rounded={8}/>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {/* sidebar */}
        <div style={{ position: 'sticky', top: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ padding: 18, borderRadius: theme.radius, background: theme.surface, border: `1px solid ${theme.line}` }}>
            <SectionLabel theme={theme}>Window</SectionLabel>
            <div style={{ fontFamily: theme.serif, fontSize: 26, fontWeight: 500, margin: '10px 0 2px' }}>4 days left</div>
            <div style={{ fontSize: 12.5, color: theme.inkSoft, lineHeight: 1.5 }}>Uploads close April 2, then the album locks as a keepsake.</div>
          </div>
          <div style={{ padding: 18, borderRadius: theme.radius, background: theme.surface, border: `1px solid ${theme.line}` }}>
            <SectionLabel theme={theme}>Members · 5</SectionLabel>
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {['maya','me','sam','priya','leo'].map(id => (
                <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Avatar id={id} size={28} theme={theme}/>
                  <div style={{ fontSize: 13.5, fontWeight: 500 }}>{PEOPLE.find(p => p.id === id)?.name}</div>
                  {id === 'maya' && <Chip theme={theme} tone="neutral" style={{ marginLeft: 'auto', fontSize: 10.5, padding: '2px 8px' }}>Owner</Chip>}
                </div>
              ))}
            </div>
          </div>
          {readOnly && (
            <div style={{ padding: 18, borderRadius: theme.radius, background: theme.accentSoft }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: theme.ink }}>Browsing as a guest</div>
              <div style={{ fontSize: 12.5, color: theme.inkSoft, lineHeight: 1.5, margin: '6px 0 12px' }}>You're seeing photos with no people and public shots. Sign in so the album can find you.</div>
              <Button theme={theme} kind="primary" size="sm" full>Sign in</Button>
            </div>
          )}
          <div style={{ fontSize: 12, color: theme.inkMuted, lineHeight: 1.5, padding: '0 4px' }}>
            Prefer the app? <span style={{ color: theme.accent, fontWeight: 600 }}>Get photu for iOS & Android →</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// WEB LIGHTBOX — full-screen viewer overlay
// ──────────────────────────────────────────────────────────────────
function WebLightbox({ theme, w = 1200, photo = PHOTO_SET[3] }) {
  return (
    <div style={{ width: w, height: 720, background: '#111', color: '#fff', fontFamily: theme.sans, position: 'relative', overflow: 'hidden', boxSizing: 'border-box' }}>
      {/* photo */}
      <div style={{ position: 'absolute', inset: '0 72px 76px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: '78%', height: '86%', borderRadius: 6, background: photoBackground(photo), position: 'relative', overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,0.5)' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 30% 20%, rgba(255,255,255,0.18), transparent 50%), radial-gradient(ellipse at 80% 90%, rgba(0,0,0,0.35), transparent 60%)', mixBlendMode: 'overlay' }}/>
        </div>
      </div>
      {/* top bar */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button style={{ width: 38, height: 38, borderRadius: 38, background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <Icon name="x" size={17} color="#fff"/>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'rgba(255,255,255,0.75)' }}>
          <Avatar id="maya" size={22} theme={theme}/>Maya · Today 14:22
        </div>
        <div style={{ flex: 1 }}/>
        <div style={{ fontFamily: theme.mono, fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>4 / 184</div>
      </div>
      {/* prev / next */}
      {['chevron-left','chevron-right'].map((ic, i) => (
        <button key={ic} style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', [i ? 'right' : 'left']: 18, width: 44, height: 44, borderRadius: 44, background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <Icon name={ic} size={19} color="#fff"/>
        </button>
      ))}
      {/* bottom bar */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {photo.faces.slice(0, 4).map(id => (
            <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px 4px 4px', borderRadius: 999, background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 12, fontWeight: 500 }}>
              <Avatar id={id} size={20} theme={theme}/>{PEOPLE.find(p => p.id === id)?.name}
            </span>
          ))}
        </div>
        <div style={{ flex: 1 }}/>
        <Button theme={theme} kind="outline" size="sm" style={{ borderColor: 'rgba(255,255,255,0.3)', color: '#fff' }} leading={<Icon name="download" size={15}/>}>Save original</Button>
        <Button theme={theme} kind="outline" size="sm" style={{ borderColor: 'rgba(255,255,255,0.3)', color: '#fff' }} leading={<Icon name="share" size={15}/>}>Share</Button>
      </div>
    </div>
  );
}

Object.assign(window, { WebNav, WebJoinPage, WebAlbumPage, WebLightbox });
