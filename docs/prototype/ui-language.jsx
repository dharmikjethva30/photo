// ui-language.jsx — three UI language variants for the same album feed.
// Shows different metaphors: Grid (default), Strip (chronological scroll), and Mosaic (editorial).

const { Avatar, AvatarStack, PhotoTile, Icon } = window.UI;
const { PHOTO_SET, PEOPLE, photoBackground } = window;

// 1. STRIP — vertical timeline-on-the-left, photos scroll past it.
function UILangStrip({ theme, w = 390, h = 700 }) {
  const days = [
    { d: 'Mar 30', label: 'Today',   photos: PHOTO_SET.slice(0, 4) },
    { d: 'Mar 29', label: 'Yest',    photos: PHOTO_SET.slice(4, 8) },
    { d: 'Mar 28', label: '',        photos: PHOTO_SET.slice(8, 12) },
  ];
  return (
    <div style={{ width: w, height: h, background: theme.bg, color: theme.ink, fontFamily: theme.sans, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 20px 14px', borderBottom: `1px solid ${theme.line}` }}>
        <div style={{ fontFamily: theme.mono, fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase', color: theme.inkMuted }}>UI · Strip</div>
        <div style={{ fontFamily: theme.serif, fontSize: 24, fontWeight: 500, marginTop: 4, letterSpacing: -0.3 }}>Lisbon, March</div>
      </div>
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* timeline rail */}
        <div style={{ width: 64, padding: '14px 0', borderRight: `1px solid ${theme.line}`, fontFamily: theme.mono, position: 'relative' }}>
          {days.map((d, i) => (
            <div key={i} style={{ padding: '14px 8px', textAlign: 'center', position: 'relative' }}>
              <div style={{ fontSize: 9, color: theme.inkMuted, letterSpacing: 0.5 }}>{d.d}</div>
              <div style={{ fontSize: 12, color: theme.ink, fontWeight: 600, marginTop: 2 }}>{d.label || '·'}</div>
              <div style={{ position: 'absolute', right: -1, top: 18, width: 8, height: 8, borderRadius: 8, background: i === 0 ? theme.accent : theme.lineStrong, transform: 'translateX(50%)' }}/>
            </div>
          ))}
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
          {days.map((d, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              {d.photos.map((p, j) => (
                <div key={j} style={{ marginBottom: 4, borderRadius: theme.radiusSm, overflow: 'hidden' }}>
                  <PhotoTile photo={{...p, ar: 1.4}} theme={theme} w={(w - 64 - 16)} rounded={theme.radiusSm}/>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// 2. MOSAIC — editorial heterogeneous grid, like a magazine spread.
function UILangMosaic({ theme, w = 390, h = 700 }) {
  return (
    <div style={{ width: w, height: h, background: theme.bg, color: theme.ink, fontFamily: theme.sans, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 20px 14px' }}>
        <div style={{ fontFamily: theme.mono, fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase', color: theme.inkMuted }}>UI · Mosaic</div>
        <div style={{ fontFamily: theme.serif, fontSize: 30, fontWeight: 500, marginTop: 4, letterSpacing: -0.4, lineHeight: 1.05 }}>Lisbon,<br/><em style={{ fontStyle: 'italic', color: theme.accent }}>in March.</em></div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '0 16px 16px' }}>
        {/* hero photo */}
        <div style={{ aspectRatio: '4/3', borderRadius: theme.radius, overflow: 'hidden', marginBottom: 4, background: photoBackground(PHOTO_SET[0]) }}>
          <div style={{ height: '100%', display: 'flex', alignItems: 'flex-end', padding: 14, background: 'linear-gradient(180deg, transparent 50%, rgba(0,0,0,0.5) 100%)', color: '#fff' }}>
            <div style={{ fontFamily: theme.serif, fontSize: 14, fontWeight: 500, fontStyle: 'italic' }}>Day 1 · the beach.</div>
          </div>
        </div>
        {/* asymmetric grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 4 }}>
          <div style={{ aspectRatio: '1.4', background: photoBackground(PHOTO_SET[1]), borderRadius: theme.radiusSm }}/>
          <div style={{ display: 'grid', gridTemplateRows: '1fr 1fr', gap: 4 }}>
            <div style={{ background: photoBackground(PHOTO_SET[2]), borderRadius: theme.radiusSm }}/>
            <div style={{ background: photoBackground(PHOTO_SET[5]), borderRadius: theme.radiusSm }}/>
          </div>
        </div>
        <div style={{ padding: '16px 4px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ fontFamily: theme.serif, fontSize: 18, fontWeight: 500, fontStyle: 'italic' }}>Yesterday — the dinner.</div>
          <div style={{ fontFamily: theme.mono, fontSize: 10, color: theme.inkMuted, letterSpacing: 1 }}>04 PHOTOS</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
          {PHOTO_SET.slice(6, 9).map(p => (
            <div key={p.id} style={{ aspectRatio: 1, background: photoBackground(p), borderRadius: theme.radiusSm }}/>
          ))}
        </div>
      </div>
    </div>
  );
}

// 3. STREAM — single-column tall photos with byline, like a real-time feed of a trip.
function UILangStream({ theme, w = 390, h = 700 }) {
  const items = [
    { p: PHOTO_SET[0], who: 'maya', when: '2m', cap: 'sunset run' },
    { p: PHOTO_SET[3], who: 'sam',  when: '14m', cap: '' },
    { p: PHOTO_SET[5], who: 'priya', when: '1h', cap: 'first natas of the trip' },
  ];
  return (
    <div style={{ width: w, height: h, background: theme.bg, color: theme.ink, fontFamily: theme.sans, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 20px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontFamily: theme.mono, fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase', color: theme.inkMuted }}>UI · Stream</div>
          <div style={{ fontFamily: theme.serif, fontSize: 22, fontWeight: 500, marginTop: 4, letterSpacing: -0.3 }}>Lisbon, March</div>
        </div>
        <AvatarStack ids={['me','maya','sam','priya','leo']} theme={theme} size={22}/>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '0 16px 16px' }}>
        {items.map((it, i) => (
          <div key={i} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Avatar id={it.who} size={22} theme={theme}/>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{PEOPLE.find(x => x.id === it.who).name}</div>
              <div style={{ flex: 1 }}/>
              <div style={{ fontFamily: theme.mono, fontSize: 11, color: theme.inkMuted }}>{it.when}</div>
            </div>
            <div style={{ aspectRatio: '4/5', borderRadius: theme.radius, background: photoBackground(it.p), overflow: 'hidden', position: 'relative' }}>
              <div style={{ position: 'absolute', top: 10, right: 10, padding: '3px 8px', borderRadius: 999, background: 'rgba(0,0,0,0.4)', color: '#fff', fontFamily: theme.mono, fontSize: 9, letterSpacing: 0.5, backdropFilter: 'blur(8px)' }}>ORIG · 4032×3024</div>
            </div>
            {it.cap && <div style={{ marginTop: 8, fontSize: 14, color: theme.inkSoft, fontFamily: theme.serif, fontStyle: 'italic' }}>"{it.cap}"</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// 4. CONTACT SHEET — pro photographer view, dense, mono labels per frame.
function UILangContact({ theme, w = 390, h = 700 }) {
  const photos = PHOTO_SET.slice(0, 12);
  return (
    <div style={{ width: w, height: h, background: theme.bg, color: theme.ink, fontFamily: theme.sans, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 20px 14px' }}>
        <div style={{ fontFamily: theme.mono, fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase', color: theme.inkMuted }}>UI · Contact Sheet</div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 4 }}>
          <div style={{ fontFamily: theme.serif, fontSize: 22, fontWeight: 500, letterSpacing: -0.3 }}>Lisbon, March</div>
          <div style={{ fontFamily: theme.mono, fontSize: 10, color: theme.inkMuted, letterSpacing: 1 }}>184 / 184</div>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '0 12px 12px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
          {photos.map((p, i) => (
            <div key={p.id}>
              <div style={{ aspectRatio: 1, background: photoBackground(p), borderRadius: 2, position: 'relative' }}>
                {[i, i, i].includes(0) || true ? null : null}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontFamily: theme.mono, fontSize: 8.5, color: theme.inkMuted, letterSpacing: 0.4 }}>
                <span>{String(i + 1).padStart(3, '0')}</span>
                <span>{p.tag.toUpperCase()}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ padding: '10px 20px 16px', borderTop: `1px solid ${theme.line}`, display: 'flex', gap: 8, fontFamily: theme.mono, fontSize: 10, color: theme.inkMuted }}>
        <span>F·22</span><span>1/250</span><span>ISO·400</span><div style={{ flex: 1 }}/>
        <span>184 FRAMES</span>
      </div>
    </div>
  );
}

window.UILangStrip = UILangStrip;
window.UILangMosaic = UILangMosaic;
window.UILangStream = UILangStream;
window.UILangContact = UILangContact;
