// screens-misc.jsx — join via link, allowlist, notifications, paywall-success,
// settings, window-extend, member-empty, web-upload (responsive page), brand explorations.

const { Avatar, AvatarStack, PhotoTile, Button, Chip, SectionLabel, Icon } = window.UI;
const { Frame, IconButton, FormField, ProgressDots, PhotuMark, TabBar, Row } = window;

// ──────────────────────────────────────────────────────────────────
// JOIN VIA LINK — teaser before sign in
// ──────────────────────────────────────────────────────────────────
function ScreenJoin({ theme, on = {} }) {
  return (
    <Frame theme={theme}>
      <div style={{ position: 'relative', height: 360, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, background: photoBackground(PHOTO_SET[0]) }} />
        <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, transparent 40%, ${theme.bg} 100%)` }} />
        <div style={{ position: 'absolute', top: 56, left: 16, right: 16, display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={on.close} style={{ width: 38, height: 38, borderRadius: 38, background: 'rgba(0,0,0,0.45)', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(12px)', cursor: on.close ? 'pointer' : undefined }}>
            <Icon name="x" size={16} color="#fff"/>
          </button>
        </div>
        <div style={{ position: 'absolute', bottom: 24, left: 24, right: 24, color: theme.ink }}>
          <Chip theme={theme} tone="ink" style={{ background: theme.ink, color: theme.bg }}>You've been invited</Chip>
          <h1 style={{ fontFamily: theme.serif, fontSize: 34, fontWeight: 500, margin: '12px 0 6px', letterSpacing: -0.4 }}>Lisbon, March</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <AvatarStack ids={['maya','sam','priya','leo']} theme={theme} size={22} />
            <div style={{ fontSize: 13, color: theme.inkSoft }}>Maya invited you · 4 members</div>
          </div>
        </div>
      </div>
      <div style={{ flex: 1, padding: '4px 24px 24px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 14, background: theme.surface, border: `1px solid ${theme.line}`, borderRadius: theme.radius, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 36, background: theme.accentSoft, color: theme.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="clock" size={18}/>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Uploads close April 2</div>
            <div style={{ fontSize: 12.5, color: theme.inkMuted }}>Add your photos before then</div>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Button theme={theme} kind="primary" size="lg" full onClick={on.join}>Sign in to join</Button>
          <Button theme={theme} kind="ghost" size="md" full onClick={on.browse}>Browse first (read only)</Button>
        </div>
        <div style={{ marginTop: 10, textAlign: 'center', fontSize: 11.5, color: theme.inkMuted, lineHeight: 1.5 }}>
          You'll be asked for a face reference photo so the album can find you. Skip-able.
        </div>
      </div>
    </Frame>
  );
}

// ──────────────────────────────────────────────────────────────────
// ALLOWLIST — share photos of me with one member
// ──────────────────────────────────────────────────────────────────
function ScreenAllowlist({ theme, on = {}, granted = ['sam'] }) {
  const items = ['sam','maya','priya','leo'].map(id => ({ id, granted: granted.includes(id) }));
  return (
    <Frame theme={theme}>
      <div style={{ padding: '6px 16px 14px', display: 'flex', alignItems: 'center', gap: 4 }}>
        <IconButton theme={theme} icon="chevron-left" onClick={on.back}/>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 15, fontWeight: 600 }}>Photos of me</div>
        <div style={{ width: 38 }} />
      </div>
      <div style={{ padding: '0 24px', flex: 1, overflow: 'auto' }}>
        <h2 style={{ margin: '4px 0 8px', fontFamily: theme.serif, fontSize: 24, fontWeight: 500, letterSpacing: -0.3 }}>Show photos of me to…</h2>
        <p style={{ marginTop: 0, color: theme.inkSoft, fontSize: 14, lineHeight: 1.5 }}>
          By default, members only see photos they're in. Pick people who should also see photos of you (your partner, your sister).
        </p>
        <div style={{ height: 16 }} />
        <div style={{ background: theme.surface, borderRadius: theme.radius, border: `1px solid ${theme.line}`, overflow: 'hidden' }}>
          {items.map((it, i) => {
            const p = PEOPLE.find(x => x.id === it.id);
            return (
              <div key={it.id} style={{
                padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12,
                borderBottom: i < items.length - 1 ? `1px solid ${theme.line}` : 'none',
              }}>
                <Avatar id={it.id} size={36} theme={theme}/>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: theme.inkMuted }}>
                    {it.granted ? 'Sees all photos of you' : 'Only photos they\'re also in'}
                  </div>
                </div>
                <Toggle theme={theme} on={it.granted} onClick={on.toggle ? () => on.toggle(it.id) : undefined}/>
              </div>
            );
          })}
        </div>
        <div style={{ height: 18 }} />
        <div style={{
          padding: 14, borderRadius: theme.radius, background: theme.surfaceAlt,
          display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          <Icon name="lock" size={16} color={theme.inkSoft}/>
          <div style={{ flex: 1, fontSize: 12.5, color: theme.inkSoft, lineHeight: 1.5 }}>
            Allowlists override face-privacy for the people you choose, only for photos you're in. They can't re-share.
          </div>
        </div>
      </div>
    </Frame>
  );
}

function Toggle({ theme, on, onClick }) {
  return (
    <div onClick={onClick} style={{
      width: 44, height: 26, borderRadius: 26,
      background: on ? theme.accent : theme.lineStrong,
      position: 'relative', transition: 'background 0.2s',
      cursor: onClick ? 'pointer' : undefined,
    }}>
      <div style={{
        position: 'absolute', top: 2, left: on ? 20 : 2,
        width: 22, height: 22, borderRadius: 22,
        background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        transition: 'left 0.2s',
      }} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ──────────────────────────────────────────────────────────────────
function ScreenActivity({ theme, on = {} }) {
  const items = [
    { type: 'tag',     who: 'maya',  text: 'tagged you in 8 photos', when: '2m', unread: true },
    { type: 'upload',  who: 'sam',   text: 'added 12 photos to Lisbon, March', when: '14m', unread: true },
    { type: 'closing', who: null,    text: 'Lisbon, March locks in 36 hours', when: '2h' },
    { type: 'hide',    who: 'leo',   text: 'hid a photo of themselves', when: '5h' },
    { type: 'invite',  who: 'priya', text: 'joined Anu + Jay Wedding', when: '1d' },
    { type: 'lock',    who: null,    text: 'Family Reunion 2025 is now locked', when: '3d' },
  ];
  return (
    <Frame theme={theme}>
      <div style={{ padding: '8px 24px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <PhotuMark theme={theme} size={28}/>
        <div style={{ display: 'flex', gap: 6 }}>
          <IconButton theme={theme} icon="settings" onClick={on.settings}/>
        </div>
      </div>
      <div style={{ padding: '8px 24px 14px' }}>
        <h1 style={{ margin: 0, fontFamily: theme.serif, fontSize: 34, fontWeight: 500, letterSpacing: -0.5 }}>Activity</h1>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '0 16px 100px' }}>
        {items.map((it, i) => (
          <div key={i} style={{ padding: '14px 8px', display: 'flex', gap: 12, alignItems: 'center', borderBottom: `1px solid ${theme.line}` }}>
            {it.who ? <Avatar id={it.who} size={36} theme={theme}/> : (
              <div style={{ width: 36, height: 36, borderRadius: 36, background: theme.surfaceAlt, color: theme.inkSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={it.type === 'closing' ? 'clock' : it.type === 'lock' ? 'lock' : 'bell'} size={16}/>
              </div>
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, color: theme.ink, lineHeight: 1.4 }}>
                {it.who && <span style={{ fontWeight: 600 }}>{PEOPLE.find(p => p.id === it.who)?.name} </span>}
                <span style={{ color: theme.inkSoft }}>{it.text}</span>
              </div>
              <div style={{ fontSize: 11.5, color: theme.inkMuted, marginTop: 2, fontFamily: theme.mono }}>{it.when}</div>
            </div>
            {it.unread && <div style={{ width: 8, height: 8, borderRadius: 8, background: theme.accent }}/>}
          </div>
        ))}
      </div>
      <TabBar theme={theme} active="notif" onTab={on.tab}/>
    </Frame>
  );
}

// ──────────────────────────────────────────────────────────────────
// PAYWALL SUCCESS / SPLIT RECEIPT
// ──────────────────────────────────────────────────────────────────
function ScreenSplitReceipt({ theme, on = {} }) {
  return (
    <Frame theme={theme}>
      <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 4 }}>
        <IconButton theme={theme} icon="x" onClick={on.close}/>
        <div style={{ flex: 1 }} />
        <IconButton theme={theme} icon="share"/>
      </div>
      <div style={{ padding: '4px 24px 24px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ width: 56, height: 56, borderRadius: 56, background: theme.success, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
          <Icon name="check" size={28} stroke={2.5} color="#fff"/>
        </div>
        <h1 style={{ margin: 0, fontFamily: theme.serif, fontSize: 30, fontWeight: 500, letterSpacing: -0.4 }}>Album 4 unlocked.</h1>
        <p style={{ marginTop: 8, color: theme.inkSoft, fontSize: 14.5, lineHeight: 1.5 }}>
          Here's a tidy receipt to drop into Splitwise. Per-person split is calculated for the 5 group members.
        </p>
        <div style={{ height: 18 }} />
        <div style={{
          padding: '20px 22px', borderRadius: theme.radius,
          background: theme.surface, border: `1.5px dashed ${theme.lineStrong}`,
          fontFamily: theme.mono,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: theme.inkMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>
            <span>Receipt · photu</span>
            <span>May 3 2026</span>
          </div>
          <Row theme={theme} label="Album" value="Lisbon, March"/>
          <div style={{ height: 8 }} />
          <Row theme={theme} label="One-time"  value="£1.49"/>
          <Row theme={theme} label="VAT (incl)" value="—"/>
          <div style={{ borderTop: `1px dashed ${theme.lineStrong}`, margin: '12px 0' }} />
          <Row theme={theme} label="Split"     value="5 ways"/>
          <Row theme={theme} label="Per person" value="£0.30" bold/>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Button theme={theme} kind="primary" size="lg" full onClick={on.done} leading={<Icon name="share" size={18} color={theme.bg}/>}>Send to Splitwise</Button>
          <Button theme={theme} kind="outline" size="lg" full>Copy as text</Button>
        </div>
      </div>
    </Frame>
  );
}

// ──────────────────────────────────────────────────────────────────
// SETTINGS — face data management (privacy explainer)
// ──────────────────────────────────────────────────────────────────
function ScreenPrivacyExplainer({ theme, on = {} }) {
  return (
    <Frame theme={theme}>
      <div style={{ padding: '6px 16px 14px', display: 'flex', alignItems: 'center', gap: 4 }}>
        <IconButton theme={theme} icon="chevron-left" onClick={on.back}/>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 15, fontWeight: 600 }}>How face-privacy works</div>
        <div style={{ width: 38 }} />
      </div>
      <div style={{ padding: '0 24px 24px', flex: 1, overflow: 'auto' }}>
        <div style={{
          height: 120, borderRadius: theme.radius, marginBottom: 18,
          background: `linear-gradient(140deg, ${theme.accentSoft}, ${theme.surface})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative', overflow: 'hidden',
        }}>
          {[...Array(7)].map((_, i) => (
            <div key={i} style={{
              width: 38, height: 38, borderRadius: 38, margin: '0 -4px',
              background: `oklch(0.78 0.10 ${i * 50})`,
              border: `2px solid ${theme.bg}`,
              boxShadow: i === 3 ? `0 0 0 3px ${theme.accent}` : 'none',
              zIndex: 7 - i,
            }} />
          ))}
        </div>
        {[
          { n: '1', t: 'You provide one reference photo', d: 'It\'s encrypted and stored in your account, not the album.' },
          { n: '2', t: 'When someone uploads, we run face detection', d: 'Each face is matched against members\' references. Strangers stay as "unknown."' },
          { n: '3', t: 'You only see photos you\'re in', d: 'Plus photos with no people detected, plus photos members explicitly share with you.' },
          { n: '4', t: 'Subject veto is absolute', d: 'If a photo of you is hidden, it\'s hidden for everyone. The photographer keeps a private copy.' },
        ].map(s => (
          <div key={s.n} style={{ display: 'flex', gap: 14, padding: '14px 0', borderBottom: `1px solid ${theme.line}` }}>
            <div style={{
              width: 28, height: 28, borderRadius: 28,
              background: theme.ink, color: theme.bg,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: theme.serif, fontSize: 14, fontWeight: 500, flexShrink: 0,
            }}>{s.n}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14.5 }}>{s.t}</div>
              <div style={{ fontSize: 13, color: theme.inkSoft, lineHeight: 1.5, marginTop: 4 }}>{s.d}</div>
            </div>
          </div>
        ))}
        <div style={{ height: 18 }} />
        <Button theme={theme} kind="outline" size="md" full>Delete my face data</Button>
      </div>
    </Frame>
  );
}

// ──────────────────────────────────────────────────────────────────
// EXTEND WINDOW (owner-only)
// ──────────────────────────────────────────────────────────────────
function ScreenExtendWindow({ theme, on = {} }) {
  return (
    <Frame theme={theme}>
      <div style={{ padding: '6px 16px 14px', display: 'flex', alignItems: 'center', gap: 4 }}>
        <IconButton theme={theme} icon="x" onClick={on.close}/>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 15, fontWeight: 600 }}>Extend window</div>
        <div style={{ width: 38 }} />
      </div>
      <div style={{ padding: '0 24px', flex: 1, overflow: 'auto' }}>
        <div style={{ padding: '8px 0' }}>
          <div style={{ fontFamily: theme.mono, fontSize: 11, letterSpacing: 1.4, color: theme.inkMuted, textTransform: 'uppercase' }}>Closes in</div>
          <div style={{ fontFamily: theme.serif, fontSize: 64, fontWeight: 500, letterSpacing: -1, lineHeight: 1, color: theme.danger, marginTop: 6 }}>36<span style={{ fontSize: 22, color: theme.inkSoft, marginLeft: 8, fontFamily: theme.sans }}>hours</span></div>
        </div>
        <p style={{ color: theme.inkSoft, fontSize: 14.5, lineHeight: 1.55, marginTop: 14 }}>
          You can extend this album once. After that, it locks for everyone and becomes a keepsake.
        </p>
        <div style={{ height: 16 }} />
        <SectionLabel theme={theme}>Add</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 10 }}>
          {[
            { l: '+ 7 days',  active: false },
            { l: '+ 14 days', active: true },
            { l: '+ 30 days', active: false },
          ].map(o => (
            <div key={o.l} style={{
              padding: 16, borderRadius: theme.radius,
              background: o.active ? theme.ink : theme.surface,
              color: o.active ? theme.bg : theme.ink,
              border: `1px solid ${o.active ? theme.ink : theme.line}`,
              fontFamily: theme.serif, fontSize: 18, fontWeight: 500, textAlign: 'center',
            }}>{o.l}</div>
          ))}
        </div>
        <div style={{ marginTop: 18, padding: 14, borderRadius: theme.radius, background: theme.surfaceAlt, fontSize: 12.5, color: theme.inkSoft, lineHeight: 1.5, display: 'flex', gap: 10 }}>
          <Icon name="clock" size={16}/>
          <div>New close date: <strong style={{ color: theme.ink }}>April 16</strong>. Members will be notified.</div>
        </div>
      </div>
      <div style={{ padding: '12px 24px 28px', borderTop: `1px solid ${theme.line}` }}>
        <Button theme={theme} kind="primary" size="lg" full onClick={on.extend}>Extend by 14 days</Button>
      </div>
    </Frame>
  );
}

// ──────────────────────────────────────────────────────────────────
// WEB UPLOAD page (responsive, in browser frame)
// ──────────────────────────────────────────────────────────────────
function WebUploadPage({ theme, w = 900 }) {
  return (
    <div style={{ width: w, background: theme.bg, color: theme.ink, fontFamily: theme.sans, padding: '32px 56px 56px', minHeight: 600, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <PhotuMark theme={theme} size={28}/>
        <div style={{ fontSize: 12, color: theme.inkMuted, fontFamily: theme.mono }}>photu.app/a/lisbon-93jx</div>
      </div>
      <div style={{ height: 36 }} />
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 56, alignItems: 'center', flex: 1 }}>
        <div>
          <Chip theme={theme} tone="accent">Maya invited you</Chip>
          <h1 style={{ fontFamily: theme.serif, fontSize: 56, fontWeight: 500, letterSpacing: -1, lineHeight: 1.02, margin: '18px 0 12px' }}>
            Drop your<br/>Lisbon photos<br/><em style={{ fontStyle: 'italic', color: theme.accent }}>at full quality.</em>
          </h1>
          <p style={{ color: theme.inkSoft, fontSize: 16, lineHeight: 1.55, maxWidth: 420 }}>
            No app, no account — just drag your photos here. They'll upload at original resolution and join the album for everyone.
          </p>
          <div style={{ marginTop: 22, display: 'flex', gap: 12, alignItems: 'center' }}>
            <AvatarStack ids={['maya','sam','priya','leo']} theme={theme} size={24}/>
            <div style={{ fontSize: 13, color: theme.inkMuted }}>5 members · 184 photos so far</div>
          </div>
        </div>
        <div style={{
          height: 360, borderRadius: theme.radiusLg,
          background: theme.surface, border: `2px dashed ${theme.lineStrong}`,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14,
          textAlign: 'center', padding: 32, position: 'relative',
        }}>
          <div style={{ width: 72, height: 72, borderRadius: 72, background: theme.accentSoft, color: theme.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="upload" size={32}/>
          </div>
          <div style={{ fontFamily: theme.serif, fontSize: 24, fontWeight: 500 }}>Drop photos & videos</div>
          <div style={{ fontSize: 13, color: theme.inkMuted, fontFamily: theme.mono, letterSpacing: 0.5 }}>or</div>
          <Button theme={theme} kind="primary" size="lg">Browse from your computer</Button>
          <div style={{ marginTop: 4, fontSize: 11.5, color: theme.inkMuted, fontFamily: theme.mono }}>JPG · HEIC · PNG · MP4 · MOV — original quality preserved</div>
        </div>
      </div>
      <div style={{ marginTop: 32, paddingTop: 18, borderTop: `1px solid ${theme.line}`, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: theme.inkMuted }}>
        <span>This album uses <strong style={{ color: theme.ink }}>face-privacy</strong>. Members only see photos they're in.</span>
        <span>Want the app? <span style={{ color: theme.accent }}>Get photu →</span></span>
      </div>
    </div>
  );
}

Object.assign(window, {
  ScreenJoin, ScreenAllowlist, Toggle, ScreenActivity,
  ScreenSplitReceipt, ScreenPrivacyExplainer, ScreenExtendWindow,
  WebUploadPage,
});
