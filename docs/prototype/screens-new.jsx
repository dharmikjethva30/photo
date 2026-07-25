// screens-new.jsx — settings, notification designs, empty/error states, Android variants.
const { Avatar, AvatarStack, PhotoTile, Button, Chip, SectionLabel, StatusBar, Icon } = window.UI;
const { Frame, IconButton, FormField, PhotuMark, TabBar, Toggle, Row } = window;

// ──────────────────────────────────────────────────────────────────
// SETTINGS — profile, face data, notifications, albums meter, account
// ──────────────────────────────────────────────────────────────────
function ScreenSettings({ theme, on = {} }) {
  const SRow = ({ icon, label, value, danger, onClick, toggle }) => (
    <div onClick={onClick} style={{
      padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12,
      borderBottom: `1px solid ${theme.line}`, cursor: onClick ? 'pointer' : undefined,
    }}>
      <div style={{ width: 32, height: 32, borderRadius: 32, background: danger ? 'oklch(0.95 0.03 25)' : theme.surfaceAlt, color: danger ? theme.danger : theme.inkSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon name={icon} size={15}/>
      </div>
      <div style={{ flex: 1, fontSize: 14.5, fontWeight: 500, color: danger ? theme.danger : theme.ink }}>{label}</div>
      {value && <div style={{ fontSize: 13, color: theme.inkMuted }}>{value}</div>}
      {toggle !== undefined ? <Toggle theme={theme} on={toggle}/> : <Icon name="chevron-right" size={15} color={theme.inkMuted}/>}
    </div>
  );
  const Group = ({ label, children }) => (
    <div style={{ marginBottom: 22 }}>
      <SectionLabel theme={theme} style={{ padding: '0 4px 10px' }}>{label}</SectionLabel>
      <div style={{ background: theme.surface, borderRadius: theme.radius, border: `1px solid ${theme.line}`, overflow: 'hidden' }}>{children}</div>
    </div>
  );
  return (
    <Frame theme={theme}>
      <div style={{ padding: '6px 16px 8px', display: 'flex', alignItems: 'center', gap: 4 }}>
        <IconButton theme={theme} icon="chevron-left" onClick={on.back}/>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 15, fontWeight: 600 }}>Settings</div>
        <div style={{ width: 38 }} />
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 20px 40px' }}>
        {/* profile card */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 4px 22px' }}>
          <Avatar id="me" size={56} theme={theme}/>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: theme.serif, fontSize: 22, fontWeight: 500, letterSpacing: -0.2 }}>Dev</div>
            <div style={{ fontSize: 12.5, color: theme.inkMuted, marginTop: 2 }}>dev@example.com · joined May 2026</div>
          </div>
          <Button theme={theme} kind="outline" size="sm">Edit</Button>
        </div>
        {/* free albums meter */}
        <div style={{ padding: 16, borderRadius: theme.radius, background: theme.surface, border: `1px solid ${theme.line}`, marginBottom: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Free albums</div>
            <div style={{ fontFamily: theme.mono, fontSize: 12, color: theme.inkSoft }}>3 of 3 used</div>
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
            {[1,2,3].map(i => <div key={i} style={{ flex: 1, height: 6, borderRadius: 6, background: theme.accent }}/>)}
          </div>
          <div style={{ marginTop: 10, fontSize: 12.5, color: theme.inkSoft, lineHeight: 1.5 }}>Your next album is a one-time £1.49 — easy to split with the group.</div>
        </div>
        <Group label="Face & privacy">
          <SRow icon="face" label="Face reference photo" value="1 photo" onClick={on.faceRef}/>
          <SRow icon="heart" label="Who sees photos of me" value="Sam" onClick={on.allowlist}/>
          <SRow icon="lock" label="How face-privacy works" onClick={on.privacy}/>
          <SRow icon="x" label="Delete my face data" danger onClick={on.deleteFace}/>
        </Group>
        <Group label="Notifications">
          <SRow icon="bell" label="New photos" toggle={true}/>
          <SRow icon="face" label="You were tagged" toggle={true}/>
          <SRow icon="clock" label="Window closing reminders" toggle={true}/>
          <SRow icon="eye-off" label="Someone hid a photo of you" toggle={false}/>
        </Group>
        <Group label="Account">
          <SRow icon="download" label="Export all my photos" onClick={on.export}/>
          <SRow icon="users" label="Leave an album" onClick={on.leave}/>
          <SRow icon="x" label="Delete account" danger onClick={on.deleteAccount}/>
        </Group>
        <div style={{ textAlign: 'center', fontFamily: theme.mono, fontSize: 10.5, color: theme.inkMuted, letterSpacing: 1 }}>PHOTU 1.0 (104) · TERMS · PRIVACY</div>
      </div>
    </Frame>
  );
}

// ──────────────────────────────────────────────────────────────────
// LOCK-SCREEN PUSH NOTIFICATIONS — copy design for all 6 push types
// ──────────────────────────────────────────────────────────────────
function ScreenLockNotifs({ theme }) {
  const pushes = [
    { title: 'Maya tagged you', body: 'You appear in 8 new photos in Lisbon, March.', when: 'now' },
    { title: '12 new photos', body: 'Sam added photos to Lisbon, March — 3 have you in them.', when: '9:41' },
    { title: 'Closes in 48 hours', body: 'Last call for Lisbon, March. Add your photos before Friday.', when: '8:30' },
    { title: 'A photo was hidden', body: 'Leo hid a photo of themselves. No action needed.', when: 'Yesterday' },
    { title: 'You\u2019re invited', body: 'Priya added you to Anu + Jay Wedding · 6 members.', when: 'Yesterday' },
    { title: 'Album locked', body: 'Family Reunion 2025 is now a keepsake. Save your favourites.', when: 'Tuesday' },
  ];
  return (
    <div style={{
      width: '100%', height: '100%', fontFamily: theme.sans, position: 'relative', overflow: 'hidden',
      background: 'linear-gradient(180deg, #2a3548 0%, #4a5568 45%, #8a7a68 80%, #b89878 100%)',
    }}>
      <div style={{ textAlign: 'center', paddingTop: 70, color: '#fff' }}>
        <div style={{ fontSize: 16, fontWeight: 600, opacity: 0.9 }}>Tuesday, May 5</div>
        <div style={{ fontSize: 76, fontWeight: 600, letterSpacing: -2, lineHeight: 1, marginTop: 2 }}>9:41</div>
      </div>
      <div style={{ position: 'absolute', top: 210, left: 12, right: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {pushes.map((p, i) => (
          <div key={i} style={{
            padding: '12px 14px', borderRadius: 20,
            background: 'rgba(250,250,250,0.78)', backdropFilter: 'blur(30px)',
            display: 'flex', gap: 12, alignItems: 'flex-start',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          }}>
            <div style={{
              width: 38, height: 38, borderRadius: 9, background: '#1B1814', color: '#F4EEE3',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: theme.serif, fontSize: 20, flexShrink: 0, position: 'relative',
            }}>
              <div style={{ position: 'absolute', inset: 3.5, borderRadius: '50%', border: '1.2px solid #F4EEE3', opacity: 0.5 }}/>
              <span style={{ position: 'relative' }}>p</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{p.title}</div>
                <div style={{ fontSize: 11.5, color: 'rgba(0,0,0,0.45)', flexShrink: 0 }}>{p.when}</div>
              </div>
              <div style={{ fontSize: 13.5, color: 'rgba(0,0,0,0.72)', lineHeight: 1.35, marginTop: 1 }}>{p.body}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', width: 130, height: 5, borderRadius: 5, background: 'rgba(255,255,255,0.6)' }}/>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// EMPTY & ERROR STATES
// ──────────────────────────────────────────────────────────────────
function ScreenLibraryEmpty({ theme, on = {} }) {
  return (
    <Frame theme={theme}>
      <div style={{ padding: '8px 24px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <PhotuMark theme={theme} size={30}/>
        <IconButton theme={theme} icon="user"/>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 36px 80px', textAlign: 'center' }}>
        {/* stacked-polaroid placeholder */}
        <div style={{ position: 'relative', height: 190, marginBottom: 28 }}>
          {[{ r: -7, x: -54, p: PHOTO_SET[2] }, { r: 5, x: 44, p: PHOTO_SET[5] }, { r: -1, x: -5, p: PHOTO_SET[0] }].map((c, i) => (
            <div key={i} style={{
              position: 'absolute', left: '50%', top: i * 6,
              transform: `translateX(-50%) translateX(${c.x}px) rotate(${c.r}deg)`,
              width: 120, padding: '8px 8px 26px', background: '#fff',
              boxShadow: '0 10px 24px rgba(0,0,0,0.14)', borderRadius: 4,
            }}>
              <div style={{ aspectRatio: '1', background: photoBackground(c.p), borderRadius: 2 }}/>
            </div>
          ))}
        </div>
        <h2 style={{ margin: 0, fontFamily: theme.serif, fontSize: 27, fontWeight: 500, letterSpacing: -0.4, lineHeight: 1.15 }}>Your first three albums are on us.</h2>
        <p style={{ margin: '12px 0 0', fontSize: 14.5, color: theme.inkSoft, lineHeight: 1.5 }}>Create one for the next trip or dinner, or join a friend's with their link.</p>
        <div style={{ marginTop: 26, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Button theme={theme} kind="primary" size="lg" full onClick={on.create} leading={<Icon name="plus" size={18} color={theme.bg}/>}>Create an album</Button>
          <Button theme={theme} kind="ghost" size="md" full onClick={on.paste} leading={<Icon name="link" size={16}/>}>I have an invite link</Button>
        </div>
      </div>
      <TabBar theme={theme} active="library"/>
    </Frame>
  );
}

function ScreenUploadError({ theme, on = {} }) {
  return (
    <Frame theme={theme}>
      <div style={{ padding: '6px 16px 14px', display: 'flex', alignItems: 'center', gap: 4 }}>
        <IconButton theme={theme} icon="x" onClick={on.close}/>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 15, fontWeight: 600 }}>Uploading 12 photos</div>
        <div style={{ width: 38 }} />
      </div>
      <div style={{ padding: '0 24px', flex: 1, overflow: 'auto' }}>
        <div style={{ padding: 16, borderRadius: theme.radius, background: 'oklch(0.96 0.03 25)', border: `1px solid oklch(0.85 0.06 25)` }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ width: 28, height: 28, borderRadius: 28, background: theme.danger, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icon name="x" size={14} stroke={2.4}/>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14.5, color: theme.ink }}>Upload paused — connection lost</div>
              <div style={{ fontSize: 13, color: theme.inkSoft, lineHeight: 1.5, marginTop: 3 }}>8 of 12 made it. Nothing was compressed or lost — we'll pick up exactly where we stopped.</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <Button theme={theme} kind="primary" size="sm" onClick={on.retry}>Retry now</Button>
            <Button theme={theme} kind="ghost" size="sm" onClick={on.auto}>Retry on Wi-Fi</Button>
          </div>
        </div>
        <div style={{ height: 18 }} />
        <SectionLabel theme={theme}>In this batch</SectionLabel>
        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
          {PHOTO_SET.slice(0, 12).map((p, i) => (
            <div key={p.id} style={{ aspectRatio: '1', position: 'relative' }}>
              <PhotoTile photo={{...p, ar: 1}} theme={theme} w={80} rounded={6} dimmed={i > 7}/>
              <div style={{ position: 'absolute', top: 4, right: 4, width: 16, height: 16, borderRadius: 16, background: i <= 7 ? theme.success : theme.danger, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={i <= 7 ? 'check' : 'x'} size={9} stroke={3} color="#fff"/>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
}

// ──────────────────────────────────────────────────────────────────
// ANDROID VARIANTS — same brand, Material ergonomics
// ──────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────
// ANDROID — React Native parity. Same screens, Android chrome only
// (status bar + punch-hole + gesture pill). No Material nav/FAB.
// ──────────────────────────────────────────────────────────────────
function AndroidPhone({ theme, children }) {
  return (
    <window.ChromeCtx.Provider value="android">
      <div style={{ width: '100%', height: '100%', position: 'relative', background: theme.bg, overflow: 'hidden' }}>
        {children}
        <div style={{ position: 'absolute', bottom: 7, left: '50%', transform: 'translateX(-50%)', width: 100, height: 4, borderRadius: 4, background: theme.ink, opacity: 0.35, zIndex: 220 }}/>
      </div>
    </window.ChromeCtx.Provider>
  );
}

function AndroidChrome({ theme, children }) {
  return (
    <div style={{ width: '100%', height: '100%', background: theme.bg, color: theme.ink, fontFamily: theme.sans, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      {/* Android status bar */}
      <div style={{ height: 36, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px', position: 'relative' }}>
        <span style={{ fontSize: 13.5, fontWeight: 500 }}>9:30</span>
        <div style={{ position: 'absolute', left: '50%', top: 7, transform: 'translateX(-50%)', width: 20, height: 20, borderRadius: 20, background: '#222' }}/>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <svg width="13" height="13" viewBox="0 0 16 16"><path d="M8 13.3L.67 5.97a10.37 10.37 0 0114.66 0L8 13.3z" fill={theme.ink}/></svg>
          <svg width="13" height="13" viewBox="0 0 16 16"><rect x="3.75" y="2" width="8.5" height="13" rx="1.5" fill={theme.ink}/></svg>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>{children}</div>
      <div style={{ height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 100, height: 4, borderRadius: 4, background: theme.ink, opacity: 0.35 }}/>
      </div>
    </div>
  );
}

function ScreenAndroidLibrary({ theme }) {
  const albums = [
    { title: 'Lisbon, March', members: ['me','maya','sam','priya','leo'], photos: 184, status: 'active', daysLeft: 4, cover: PHOTO_SET[0] },
    { title: 'Anu + Jay Wedding', members: ['me','maya','ana','jun','leo','priya'], photos: 612, status: 'closing', daysLeft: 1, cover: PHOTO_SET[3] },
    { title: 'Sunday Roast', members: ['me','sam','priya'], photos: 23, status: 'active', daysLeft: 22, cover: PHOTO_SET[5] },
    { title: 'Family Reunion 2025', members: ['me','maya','sam','priya','leo','ana','jun'], photos: 421, status: 'locked', daysLeft: 0, cover: PHOTO_SET[8] },
  ];
  return (
    <AndroidChrome theme={theme}>
      <div style={{ padding: '10px 20px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <PhotuMark theme={theme} size={28}/>
        <div style={{ width: 36, height: 36, borderRadius: 36, background: theme.surfaceAlt, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Avatar id="me" size={28} theme={theme}/>
        </div>
      </div>
      {/* Material search-bar-esque header */}
      <div style={{ padding: '6px 20px 14px' }}>
        <h1 style={{ margin: 0, fontFamily: theme.serif, fontSize: 30, fontWeight: 500, letterSpacing: -0.4 }}>Your albums</h1>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '0 14px 110px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {albums.map(a => (
          <div key={a.title} style={{ display: 'flex', gap: 14, alignItems: 'center', padding: 12, borderRadius: 22, background: theme.surface, border: `1px solid ${theme.line}` }}>
            <PhotoTile photo={a.cover} theme={theme} w={72} rounded={16} dimmed={a.status === 'locked'}/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: theme.serif, fontSize: 18, fontWeight: 500 }}>{a.title}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <AvatarStack ids={a.members} theme={theme} size={16} max={4}/>
                <span style={{ fontSize: 12, color: theme.inkMuted }}>{a.photos} photos</span>
              </div>
              <div style={{ marginTop: 8 }}>
                <Chip theme={theme} tone={a.status === 'closing' ? 'danger' : 'neutral'}>
                  {a.status === 'locked' ? 'Locked · Keepsake' : a.status === 'closing' ? `Locks in ${a.daysLeft}d` : `${a.daysLeft} days left`}
                </Chip>
              </div>
            </div>
          </div>
        ))}
      </div>
      {/* Material extended FAB — square-ish */}
      <div style={{ position: 'absolute', bottom: 104, right: 18 }}>
        <div style={{ height: 56, padding: '0 20px', borderRadius: 16, background: theme.accent, color: theme.accentInk, display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600, fontSize: 15, boxShadow: '0 6px 16px rgba(0,0,0,0.2)' }}>
          <Icon name="plus" size={20} color={theme.accentInk}/>New album
        </div>
      </div>
      {/* Material nav bar — full-width, labeled */}
      <div style={{ position: 'absolute', bottom: 20, left: 0, right: 0, height: 72, background: theme.surface, borderTop: `1px solid ${theme.line}`, display: 'flex' }}>
        {[
          { icon: 'home', label: 'Albums', active: true },
          { icon: 'users', label: 'Invites' },
          { icon: 'bell', label: 'Activity' },
          { icon: 'user', label: 'You' },
        ].map(t => (
          <div key={t.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            <div style={{ width: 56, height: 30, borderRadius: 30, background: t.active ? theme.accentSoft : 'transparent', color: t.active ? theme.accent : theme.inkSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={t.icon} size={19} stroke={t.active ? 2.2 : 1.7}/>
            </div>
            <span style={{ fontSize: 11.5, fontWeight: t.active ? 700 : 500, color: t.active ? theme.ink : theme.inkSoft }}>{t.label}</span>
          </div>
        ))}
      </div>
    </AndroidChrome>
  );
}

function ScreenAndroidShareSheet({ theme }) {
  return (
    <AndroidChrome theme={theme}>
      <div style={{ position: 'absolute', inset: 0, background: photoBackground(PHOTO_SET[0]), opacity: 0.5 }}/>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }}/>
      {/* Material bottom sheet */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: theme.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: '10px 22px 30px' }}>
        <div style={{ width: 32, height: 4, borderRadius: 4, background: theme.lineStrong, margin: '4px auto 16px' }}/>
        <div style={{ fontFamily: theme.serif, fontSize: 21, fontWeight: 500, letterSpacing: -0.2 }}>Invite to Lisbon, March</div>
        <p style={{ margin: '6px 0 0', fontSize: 13.5, color: theme.inkSoft, lineHeight: 1.5 }}>Anyone with the link can browse and add photos — no install needed.</p>
        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12, padding: 13, borderRadius: 16, background: theme.surfaceAlt }}>
          <Icon name="link" size={18} color={theme.ink}/>
          <div style={{ flex: 1, fontFamily: theme.mono, fontSize: 12.5, color: theme.inkSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>photu.app/a/lisbon-93jx</div>
          <div style={{ height: 34, padding: '0 14px', borderRadius: 34, background: theme.ink, color: theme.bg, fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center' }}>Copy</div>
        </div>
        <div style={{ display: 'flex', gap: 18, marginTop: 18, paddingBottom: 4 }}>
          {[
            { label: 'WhatsApp', hue: 145 },
            { label: 'Messages', hue: 250 },
            { label: 'QR code', hue: 75 },
            { label: 'Contacts', hue: 340 },
            { label: 'More', hue: 0, grey: true },
          ].map(a => (
            <div key={a.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, width: 56 }}>
              <div style={{ width: 50, height: 50, borderRadius: 50, background: a.grey ? theme.surfaceAlt : `oklch(0.85 0.06 ${a.hue})`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: a.grey ? theme.inkSoft : `oklch(0.35 0.09 ${a.hue})` }}>
                <Icon name={a.label === 'QR code' ? 'qr' : a.label === 'Contacts' ? 'users' : a.label === 'More' ? 'more' : 'share'} size={21}/>
              </div>
              <span style={{ fontSize: 11, color: theme.inkSoft }}>{a.label}</span>
            </div>
          ))}
        </div>
      </div>
    </AndroidChrome>
  );
}

// ──────────────────────────────────────────────────────────────────
// BRAND FINALIST CARD — decision aid: icon + wordmark + voice + verdict
// ──────────────────────────────────────────────────────────────────
function FinalistCard({ theme, name, dot = true, tagline, pros, cons }) {
  return (
    <div style={{ width: '100%', height: '100%', boxSizing: 'border-box', background: theme.bg, color: theme.ink, fontFamily: theme.sans, padding: 26, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {/* app icon */}
        <div style={{ width: 64, height: 64, borderRadius: 16, background: theme.ink, color: theme.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: theme.serif, fontSize: 32, position: 'relative', overflow: 'hidden', boxShadow: '0 8px 20px rgba(0,0,0,0.15)' }}>
          <div style={{ position: 'absolute', inset: 6, borderRadius: '50%', border: `1.5px solid ${theme.bg}`, opacity: 0.5 }}/>
          <span style={{ position: 'relative' }}>{name[0].toLowerCase()}</span>
        </div>
        <div>
          <div style={{ fontFamily: theme.serif, fontSize: 40, fontWeight: 500, letterSpacing: -1, lineHeight: 1 }}>
            {name}{dot && <span style={{ color: theme.accent }}>.</span>}
          </div>
          <div style={{ fontFamily: theme.serif, fontStyle: 'italic', fontSize: 13.5, color: theme.inkSoft, marginTop: 4 }}>{tagline}</div>
        </div>
      </div>
      <div style={{ height: 20 }}/>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ padding: 14, borderRadius: theme.radius, background: theme.surface, border: `1px solid ${theme.line}` }}>
          <SectionLabel theme={theme} style={{ color: theme.success }}>For</SectionLabel>
          <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pros.map(p => <li key={p} style={{ fontSize: 12.5, lineHeight: 1.45, color: theme.inkSoft }}>{p}</li>)}
          </ul>
        </div>
        <div style={{ padding: 14, borderRadius: theme.radius, background: theme.surface, border: `1px solid ${theme.line}` }}>
          <SectionLabel theme={theme} style={{ color: theme.danger }}>Against</SectionLabel>
          <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {cons.map(p => <li key={p} style={{ fontSize: 12.5, lineHeight: 1.45, color: theme.inkSoft }}>{p}</li>)}
          </ul>
        </div>
      </div>
      <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ fontFamily: theme.mono, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: theme.inkMuted }}>domains</div>
        <Chip theme={theme} tone="neutral" style={{ fontFamily: theme.mono, fontSize: 11 }}>{name.toLowerCase()}.app</Chip>
      </div>
    </div>
  );
}

Object.assign(window, {
  ScreenSettings, ScreenLockNotifs, ScreenLibraryEmpty, ScreenUploadError,
  AndroidPhone, AndroidChrome, ScreenAndroidLibrary, ScreenAndroidShareSheet, FinalistCard,
});
