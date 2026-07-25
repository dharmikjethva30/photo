// screens-core.jsx — onboarding, library, create-album, invite, paywall.
// Each screen renders into a 390×844 surface (phone safe area).
// All screens accept { theme, viewer, t /* tweak hook */ } and ignore what they don't need.

const { Avatar, AvatarStack, PhotoTile, Button, Chip, SectionLabel, StatusBar, Icon } = window.UI;

// Frame ─ provides bg, status bar, scroll. Most screens wrap themselves with this.
function Frame({ children, theme, dark = false, statusDark, time = '9:41', flat = false }) {
  const chrome = React.useContext(window.ChromeCtx);
  return (
    <div style={{
      width: '100%', height: '100%',
      background: dark ? '#0E0C09' : theme.bg,
      color: dark ? '#fff' : theme.ink,
      fontFamily: theme.sans,
      display: 'flex', flexDirection: 'column',
      position: 'relative', overflow: 'hidden',
    }}>
      {chrome === 'android'
        ? <window.AndroidStatus theme={theme} dark={statusDark ?? dark} time="9:30" />
        : <StatusBar theme={theme} dark={statusDark ?? dark} time={time} />}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>{children}</div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// 1. ONBOARDING — sign in, name, optional face reference
// ──────────────────────────────────────────────────────────────────
function ScreenSignIn({ theme, on = {} }) {
  return (
    <Frame theme={theme}>
      <div style={{ flex: 1, padding: '40px 28px 32px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <PhotuMark theme={theme} size={56} />
          <div style={{ height: 28 }} />
          <h1 style={{ margin: 0, fontFamily: theme.serif, fontSize: 38, lineHeight: 1.05, fontWeight: 500, letterSpacing: -0.6, color: theme.ink }}>
            One album.<br/>Everyone's photos.<br/><em style={{ color: theme.accent, fontStyle: 'italic' }}>Original quality.</em>
          </h1>
          <p style={{ marginTop: 18, fontSize: 15.5, lineHeight: 1.45, color: theme.inkSoft, maxWidth: 300 }}>
            Time-bounded albums for trips, weddings, and dinners. Three free, then a small one-off for each.
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Button kind="primary" size="lg" full theme={theme} onClick={on.signIn} leading={<Icon name="apple" size={18} color={theme.bg}/>}>Continue with Apple</Button>
          <Button kind="outline" size="lg" full theme={theme} onClick={on.signIn} leading={<Icon name="google" size={18} color={theme.ink}/>}>Continue with Google</Button>
          <Button kind="ghost" size="lg" full theme={theme} onClick={on.signIn} leading={<Icon name="phone" size={18}/>}>Use phone number</Button>
          <div style={{ marginTop: 8, textAlign: 'center', fontSize: 12, color: theme.inkMuted, lineHeight: 1.5 }}>
            By continuing you agree to our Terms.<br/>We never sell photos. Ever.
          </div>
        </div>
      </div>
    </Frame>
  );
}

function ScreenName({ theme, on = {} }) {
  return (
    <Frame theme={theme}>
      <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', height: '100%' }}>
        <SectionLabel theme={theme}>Step 1 of 3 · Your profile</SectionLabel>
        <div style={{ height: 12 }} />
        <ProgressDots step={1} total={3} theme={theme} />
        <div style={{ height: 28 }} />
        <h2 style={{ margin: 0, fontFamily: theme.serif, fontSize: 30, fontWeight: 500, letterSpacing: -0.4, color: theme.ink }}>What should friends call you?</h2>
        <p style={{ marginTop: 10, color: theme.inkSoft, fontSize: 14.5 }}>This is the name that appears next to photos you upload.</p>
        <div style={{ height: 24 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 84, height: 84, borderRadius: 84,
            background: theme.surfaceAlt, display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: `1.5px dashed ${theme.lineStrong}`, color: theme.inkMuted,
          }}>
            <Icon name="camera" size={26}/>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: theme.inkMuted }}>Photo (optional)</div>
            <div style={{ fontSize: 14, color: theme.inkSoft, marginTop: 2 }}>Helps friends spot you in invites.</div>
          </div>
        </div>
        <div style={{ height: 28 }} />
        <FormField theme={theme} label="Name">
          <div style={{ fontSize: 18, color: theme.ink }}>Dev<span style={{ borderRight: `2px solid ${theme.accent}`, marginLeft: 1, animation: 'caret 1s steps(2) infinite' }}/></div>
        </FormField>
        <div style={{ flex: 1 }} />
        <Button kind="primary" size="lg" full theme={theme} onClick={on.next} trailing={<Icon name="arrow-right" size={18} color={theme.bg}/>}>Continue</Button>
      </div>
    </Frame>
  );
}

function ScreenFaceRef({ theme, captured = false, on = {} }) {
  return (
    <Frame theme={theme}>
      <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', height: '100%' }}>
        <SectionLabel theme={theme}>Step 3 of 3 · Face match (optional)</SectionLabel>
        <div style={{ height: 12 }} />
        <ProgressDots step={3} total={3} theme={theme} />
        <div style={{ height: 24 }} />
        <h2 style={{ margin: 0, fontFamily: theme.serif, fontSize: 28, fontWeight: 500, letterSpacing: -0.4 }}>A reference photo<br/>so we can find you in the album.</h2>
        <div style={{ height: 22 }} />
        <div style={{
          alignSelf: 'center', width: 220, height: 220, borderRadius: 220,
          background: 'radial-gradient(circle at 50% 40%, #d8b896 0%, #8a5e3c 70%, #2a1810 100%)',
          position: 'relative', boxShadow: `0 12px 28px rgba(0,0,0,0.18)`,
          overflow: 'hidden',
        }}>
          {captured && (
            <div style={{
              position: 'absolute', inset: 24, borderRadius: 200,
              border: `2px solid ${theme.accent}`,
              boxShadow: `0 0 0 4px ${theme.bg}`,
            }} />
          )}
        </div>
        <div style={{ height: 18 }} />
        <div style={{
          background: theme.surface, borderRadius: theme.radius, padding: 16,
          border: `1px solid ${theme.line}`,
        }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ width: 28, height: 28, borderRadius: 28, background: theme.accentSoft, color: theme.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icon name="lock" size={14}/>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.5, color: theme.inkSoft }}>
              Your face data is encrypted and only used to match you in albums you join. Delete any time in Settings.{' '}
              <span style={{ color: theme.accent, textDecoration: 'underline', textUnderlineOffset: 3 }}>How this works</span>
            </div>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Button kind="primary" size="lg" full theme={theme} onClick={on.next}>{captured ? 'Looks good — Finish' : 'Take reference photo'}</Button>
          <Button kind="ghost" size="md" full theme={theme} onClick={on.skip}>Skip for now</Button>
        </div>
      </div>
    </Frame>
  );
}

function ProgressDots({ step, total, theme }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{
          height: 4, flex: 1, borderRadius: 2,
          background: i < step ? theme.ink : theme.lineStrong,
          opacity: i < step ? 1 : 0.4,
        }} />
      ))}
    </div>
  );
}

function FormField({ label, children, theme, hint }) {
  return (
    <div>
      <div style={{ fontFamily: theme.mono, fontSize: 10.5, letterSpacing: 1.2, textTransform: 'uppercase', color: theme.inkMuted, marginBottom: 8 }}>{label}</div>
      <div style={{
        background: theme.surface, borderRadius: theme.radius,
        padding: '14px 16px', minHeight: 52,
        border: `1px solid ${theme.line}`,
        display: 'flex', alignItems: 'center',
      }}>{children}</div>
      {hint && <div style={{ marginTop: 8, fontSize: 12, color: theme.inkMuted }}>{hint}</div>}
    </div>
  );
}

// Brand wordmark / monogram
function PhotuMark({ theme, size = 40, name = 'photu' }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        width: size, height: size, borderRadius: size * 0.28,
        background: theme.ink, color: theme.bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: theme.serif, fontWeight: 500, fontSize: size * 0.5, letterSpacing: -0.5,
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', inset: 4, borderRadius: '50%', border: `1.5px solid ${theme.bg}`, opacity: 0.5 }} />
        <span style={{ position: 'relative' }}>p</span>
      </div>
      <span style={{ fontFamily: theme.serif, fontSize: size * 0.55, fontWeight: 500, letterSpacing: -0.5, color: theme.ink }}>{name}</span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// 2. LIBRARY — home screen with all albums
// ──────────────────────────────────────────────────────────────────
function ScreenLibrary({ theme, t = {}, on = {} }) {
  const albums = [
    { id: 'a1', title: 'Lisbon, March', members: ['me','maya','sam','priya','leo'], photos: 184, status: 'active', daysLeft: 4, cover: PHOTO_SET[0] },
    { id: 'a2', title: 'Anu + Jay Wedding', members: ['me','maya','ana','jun','leo','priya'], photos: 612, status: 'closing', daysLeft: 1, cover: PHOTO_SET[3] },
    { id: 'a3', title: 'Sunday Roast', members: ['me','sam','priya'], photos: 23, status: 'active', daysLeft: 22, cover: PHOTO_SET[5] },
    { id: 'a4', title: 'Family Reunion 2025', members: ['me','maya','sam','priya','leo','ana','jun'], photos: 421, status: 'locked', daysLeft: 0, cover: PHOTO_SET[8] },
    { id: 'a5', title: 'Leo\'s 30th', members: ['me','leo','sam','priya'], photos: 96, status: 'locked', daysLeft: 0, cover: PHOTO_SET[1] },
  ];
  return (
    <Frame theme={theme}>
      <div style={{ padding: '8px 24px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <PhotuMark theme={theme} size={30} />
        <div style={{ display: 'flex', gap: 6 }}>
          <IconButton theme={theme} icon="bell" badge="2" onClick={on.activity} />
          <IconButton theme={theme} icon="user" onClick={on.settings} />
        </div>
      </div>
      <div style={{ padding: '8px 24px 16px' }}>
        <h1 style={{ margin: 0, fontFamily: theme.serif, fontSize: 34, fontWeight: 500, letterSpacing: -0.5, color: theme.ink }}>Your albums</h1>
      </div>
      <div style={{ overflow: 'auto', flex: 1, padding: '0 16px 100px' }}>
        {albums.map(a => <AlbumRow key={a.id} album={a} theme={theme} onClick={on.openAlbum ? () => on.openAlbum(a) : undefined} />)}
      </div>
      <FAB theme={theme} onClick={on.create} />
      <TabBar theme={theme} active="library" onTab={on.tab} />
    </Frame>
  );
}

function AlbumRow({ album, theme, onClick }) {
  const statusMap = {
    active: { tone: 'neutral', label: `${album.daysLeft} days left` },
    closing: { tone: 'danger', label: `Locks in ${album.daysLeft}d` },
    locked: { tone: 'neutral', label: 'Locked · Keepsake' },
  };
  const s = statusMap[album.status];
  return (
    <div onClick={onClick} style={{
      display: 'flex', gap: 14, padding: '12px 8px', alignItems: 'center',
      borderBottom: `1px solid ${theme.line}`,
      cursor: onClick ? 'pointer' : undefined,
    }}>
      <PhotoTile photo={album.cover} theme={theme} w={84} rounded={theme.radius}
        dimmed={album.status === 'locked'} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: theme.serif, fontSize: 19, fontWeight: 500, color: theme.ink, letterSpacing: -0.2 }}>{album.title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <AvatarStack ids={album.members} theme={theme} size={18} max={4} />
          <div style={{ fontSize: 12, color: theme.inkMuted }}>·  {album.photos} photos</div>
        </div>
        <div style={{ marginTop: 8 }}>
          <Chip theme={theme} tone={s.tone}
            leading={<div style={{ width: 6, height: 6, borderRadius: 6, background: album.status === 'closing' ? theme.danger : album.status === 'active' ? theme.success : theme.inkMuted }} />}
          >{s.label}</Chip>
        </div>
      </div>
      <Icon name="chevron-right" size={16} color={theme.inkMuted}/>
    </div>
  );
}

function IconButton({ theme, icon, badge, onClick }) {
  return (
    <button onClick={onClick} style={{
      width: 38, height: 38, borderRadius: 38,
      background: theme.surface, border: `1px solid ${theme.line}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', position: 'relative', color: theme.ink,
    }}>
      <Icon name={icon} size={17}/>
      {badge && (
        <div style={{
          position: 'absolute', top: 4, right: 4,
          minWidth: 14, height: 14, borderRadius: 14, padding: '0 3px',
          background: theme.accent, color: theme.accentInk,
          fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{badge}</div>
      )}
    </button>
  );
}

function FAB({ theme, onClick, label = 'New album' }) {
  return (
    <div style={{ position: 'absolute', bottom: 96, right: 20, zIndex: 5 }}>
      <button onClick={onClick} style={{
        height: 52, padding: '0 22px 0 18px', borderRadius: 52,
        background: theme.accent, color: theme.accentInk, border: 'none',
        display: 'flex', alignItems: 'center', gap: 8,
        fontFamily: theme.sans, fontSize: 15, fontWeight: 600,
        boxShadow: '0 8px 24px rgba(0,0,0,0.14), 0 2px 6px rgba(0,0,0,0.08)',
        cursor: 'pointer',
      }}>
        <Icon name="plus" size={18} color={theme.accentInk}/>
        {label}
      </button>
    </div>
  );
}

function TabBar({ theme, active = 'library', onTab }) {
  const tabs = [
    { id: 'library', icon: 'home', label: 'Albums' },
    { id: 'invites', icon: 'users', label: 'Invites' },
    { id: 'notif', icon: 'bell', label: 'Activity' },
    { id: 'me', icon: 'user', label: 'Me' },
  ];
  // Detect a dark theme so the island can pick the right material.
  const isDark = (() => {
    const c = (theme.bg || '').toLowerCase();
    if (c.startsWith('#') && c.length >= 4) {
      const r = parseInt(c.length === 4 ? c[1]+c[1] : c.slice(1,3), 16);
      const g = parseInt(c.length === 4 ? c[2]+c[2] : c.slice(3,5), 16);
      const b = parseInt(c.length === 4 ? c[3]+c[3] : c.slice(5,7), 16);
      return (r*0.299 + g*0.587 + b*0.114) < 130;
    }
    return false;
  })();
  const islandBg = isDark ? 'rgba(28,28,30,0.72)' : 'rgba(255,255,255,0.72)';
  const islandBorder = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)';
  const islandShadow = isDark
    ? '0 1px 0 rgba(255,255,255,0.08) inset, 0 12px 28px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.30)'
    : '0 1px 0 rgba(255,255,255,0.65) inset, 0 12px 28px rgba(20,18,14,0.18), 0 2px 8px rgba(20,18,14,0.10)';
  const activePillBg = isDark ? 'rgba(255,255,255,0.14)' : theme.ink;
  const activePillInk = isDark ? theme.ink : theme.bg;
  return (
    <div style={{
      position: 'absolute', bottom: 18, left: 0, right: 0,
      display: 'flex', justifyContent: 'center',
      pointerEvents: 'none', zIndex: 6,
    }}>
      <div style={{
        pointerEvents: 'auto',
        display: 'flex', alignItems: 'center', gap: 4,
        padding: 6,
        background: islandBg,
        backdropFilter: 'blur(28px) saturate(200%)',
        WebkitBackdropFilter: 'blur(28px) saturate(200%)',
        borderRadius: 999,
        border: `0.5px solid ${islandBorder}`,
        boxShadow: islandShadow,
      }}>
        {tabs.map(t => {
          const isActive = active === t.id;
          return (
            <div key={t.id} onClick={onTab ? () => onTab(t.id) : undefined} style={{
              cursor: onTab ? 'pointer' : undefined,
              display: 'flex', alignItems: 'center', gap: 6,
              height: 40, padding: isActive ? '0 14px 0 12px' : '0 12px',
              borderRadius: 999,
              background: isActive ? activePillBg : 'transparent',
              color: isActive ? activePillInk : theme.inkSoft,
              transition: 'all 180ms ease',
              fontFamily: theme.sans,
              fontSize: 13, fontWeight: 600, letterSpacing: -0.1,
            }}>
              <Icon name={t.icon} size={18} stroke={isActive ? 2.2 : 1.8}/>
              {isActive && <span>{t.label}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// 3. CREATE ALBUM
// ──────────────────────────────────────────────────────────────────
function ScreenCreateAlbum({ theme, step = 'template', on = {} }) {
  return (
    <Frame theme={theme}>
      <div style={{ padding: '8px 16px 4px', display: 'flex', alignItems: 'center', gap: 4 }}>
        <IconButton theme={theme} icon="x" onClick={on.close}/>
        <div style={{ flex: 1, textAlign: 'center', fontFamily: theme.sans, fontSize: 15, fontWeight: 600 }}>New album</div>
        <div style={{ width: 38 }} />
      </div>
      <div style={{ padding: '0 24px', flex: 1, overflow: 'auto' }}>
        <h1 style={{ fontFamily: theme.serif, fontSize: 32, fontWeight: 500, letterSpacing: -0.4, margin: '12px 0 24px' }}>What's the occasion?</h1>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {[
            { id: 'trip',     label: 'Trip',     hint: '30-day window',  hue: 220, selected: true },
            { id: 'wedding',  label: 'Wedding',  hint: '14-day window',  hue: 340 },
            { id: 'dinner',   label: 'Dinner',   hint: '3-day window',   hue: 50 },
            { id: 'birthday', label: 'Birthday', hint: '7-day window',   hue: 290 },
            { id: 'family',   label: 'Family',   hint: '60-day window',  hue: 100 },
            { id: 'other',    label: 'Other',    hint: 'Choose window',  hue: 200 },
          ].map(o => (
            <div key={o.id} style={{
              padding: 16, borderRadius: theme.radius,
              background: o.selected ? theme.ink : theme.surface,
              color: o.selected ? theme.bg : theme.ink,
              border: `1px solid ${o.selected ? theme.ink : theme.line}`,
              minHeight: 110, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
              position: 'relative', overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute', top: -10, right: -10,
                width: 60, height: 60, borderRadius: 60,
                background: `oklch(0.78 0.10 ${o.hue})`, opacity: o.selected ? 0.4 : 0.55,
              }} />
              <div style={{ fontFamily: theme.serif, fontSize: 22, fontWeight: 500, position: 'relative' }}>{o.label}</div>
              <div style={{ fontSize: 11.5, opacity: 0.7, fontFamily: theme.mono, letterSpacing: 0.3, position: 'relative' }}>{o.hint}</div>
            </div>
          ))}
        </div>
        <div style={{ height: 28 }} />
        <FormField theme={theme} label="Album name">
          <div style={{ fontSize: 18, color: theme.ink, fontFamily: theme.serif }}>Lisbon, March<span style={{ borderRight: `2px solid ${theme.accent}`, marginLeft: 1 }}/></div>
        </FormField>
        <div style={{ height: 14 }} />
        <FormField theme={theme} label="Upload window" hint="Members can add photos until then. You can extend once.">
          <div style={{ flex: 1, color: theme.ink, fontSize: 16 }}>30 days · ends April 2</div>
          <Icon name="chevron-down" size={16} color={theme.inkMuted}/>
        </FormField>
        <div style={{ height: 14 }} />
        <FormField theme={theme} label="Privacy mode">
          <div style={{ flex: 1, color: theme.ink, fontSize: 16 }}>Face-Privacy <span style={{ color: theme.inkMuted, fontSize: 13 }}>· recommended</span></div>
          <Icon name="chevron-right" size={16} color={theme.inkMuted}/>
        </FormField>
        <div style={{ height: 100 }} />
      </div>
      <div style={{ padding: '12px 24px 28px', borderTop: `1px solid ${theme.line}`, background: theme.bg }}>
        <Button kind="primary" size="lg" full theme={theme} onClick={on.create} trailing={<Icon name="arrow-right" size={18} color={theme.bg}/>}>Create album</Button>
      </div>
    </Frame>
  );
}

// ──────────────────────────────────────────────────────────────────
// 4. INVITE SHEET
// ──────────────────────────────────────────────────────────────────
function ScreenInvite({ theme, on = {} }) {
  return (
    <Frame theme={theme}>
      <div style={{
        position: 'absolute', inset: 0,
        background: `linear-gradient(180deg, ${photoBackground(PHOTO_SET[0])} 0%, ${theme.bg}DD 50%, ${theme.bg} 100%)`,
        opacity: 0.4,
      }} />
      <div style={{ position: 'absolute', top: 60, left: 24, right: 24 }}>
        <Chip theme={theme} tone="ink">✓ Album created</Chip>
        <div style={{ height: 14 }} />
        <h1 style={{ margin: 0, fontFamily: theme.serif, fontSize: 32, fontWeight: 500, letterSpacing: -0.4 }}>Invite the group</h1>
        <p style={{ marginTop: 8, color: theme.inkSoft, fontSize: 14.5, lineHeight: 1.5 }}>
          Send a link, scan the QR, or pick from your contacts. They don't need to install anything to start contributing.
        </p>
      </div>
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, top: 290,
        background: theme.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
        padding: '20px 24px', display: 'flex', flexDirection: 'column',
        boxShadow: '0 -10px 30px rgba(0,0,0,0.06)',
      }}>
        <div style={{ width: 40, height: 4, borderRadius: 4, background: theme.lineStrong, alignSelf: 'center', marginBottom: 16 }} />
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: 14, borderRadius: theme.radius,
          background: theme.surfaceAlt, marginBottom: 12,
        }}>
          <Icon name="link" size={20} color={theme.ink}/>
          <div style={{ flex: 1, fontFamily: theme.mono, fontSize: 13, color: theme.inkSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            photu.app/a/lisbon-93jx
          </div>
          <Button kind="ink" size="sm" theme={theme} style={{ background: theme.ink, color: theme.bg }}>Copy</Button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          <ActionCard theme={theme} icon="qr"      title="Show QR"      sub="In-person"/>
          <ActionCard theme={theme} icon="users"   title="Contacts"     sub="Pick people"/>
          <ActionCard theme={theme} icon="share"   title="Share sheet"  sub="WhatsApp, iMessage"/>
          <ActionCard theme={theme} icon="phone"   title="Text invite"  sub="By number"/>
        </div>
        <SectionLabel theme={theme}>Members · 1</SectionLabel>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
          <Avatar id="me" size={32} theme={theme}/>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>You</div>
            <div style={{ fontSize: 12, color: theme.inkMuted }}>Owner</div>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <Button kind="primary" size="lg" full theme={theme} onClick={on.done}>Done — open album</Button>
      </div>
    </Frame>
  );
}

function ActionCard({ theme, icon, title, sub }) {
  return (
    <div style={{
      padding: 14, borderRadius: theme.radius,
      background: theme.bg, border: `1px solid ${theme.line}`,
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <Icon name={icon} size={20} color={theme.ink}/>
      <div style={{ fontWeight: 600, fontSize: 14, marginTop: 6 }}>{title}</div>
      <div style={{ fontSize: 11.5, color: theme.inkMuted }}>{sub}</div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// 5. PAYWALL — 4th album
// ──────────────────────────────────────────────────────────────────
function ScreenPaywall({ theme, on = {} }) {
  return (
    <Frame theme={theme}>
      <div style={{ padding: '8px 16px 4px', display: 'flex', alignItems: 'center', gap: 4 }}>
        <IconButton theme={theme} icon="x" onClick={on.close}/>
        <div style={{ flex: 1 }} />
      </div>
      <div style={{ padding: '12px 24px 0', flex: 1, overflow: 'auto' }}>
        <SectionLabel theme={theme} style={{ color: theme.accent }}>Album 4</SectionLabel>
        <h1 style={{ margin: '12px 0 14px', fontFamily: theme.serif, fontSize: 34, fontWeight: 500, letterSpacing: -0.5, lineHeight: 1.05 }}>
          Your fourth album.<br/><em style={{ fontStyle: 'italic', color: theme.accent }}>£1.49</em>, one-time.
        </h1>
        <p style={{ color: theme.inkSoft, fontSize: 14.5, lineHeight: 1.5, marginTop: 0 }}>
          Folds neatly into the trip cost. Below is how to add it to Splitwise so the group splits it like the Airbnb.
        </p>
        <div style={{
          marginTop: 18, padding: 16, background: theme.surface,
          borderRadius: theme.radius, border: `1px solid ${theme.line}`,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={{ fontFamily: theme.serif, fontSize: 22, fontWeight: 500 }}>Lisbon, March</div>
            <div style={{ fontFamily: theme.mono, fontSize: 13, color: theme.inkMuted }}>5 ppl</div>
          </div>
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Row theme={theme} label="Album cost" value="£1.49"/>
            <Row theme={theme} label="Split between" value="5 people"/>
            <div style={{ height: 1, background: theme.line, margin: '4px 0' }} />
            <Row theme={theme} label="Per person" value="£0.30" bold/>
          </div>
        </div>
        <ul style={{ listStyle: 'none', padding: 0, margin: '20px 0 0' }}>
          {[
            'Original-quality photos, no compression',
            'Up to 30 members, unlimited storage for the album',
            'Face-privacy + filter-your-photos included',
            'Locked albums kept forever',
          ].map(t => (
            <li key={t} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', fontSize: 14, color: theme.inkSoft }}>
              <div style={{ width: 18, height: 18, borderRadius: 18, background: theme.accentSoft, color: theme.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}><Icon name="check" size={11} stroke={2.5}/></div>
              {t}
            </li>
          ))}
        </ul>
      </div>
      <div style={{ padding: '12px 24px 28px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Button kind="accent" size="lg" full theme={theme} onClick={on.pay}>Pay £1.49 — create album</Button>
        <Button kind="ghost" size="md" full theme={theme} onClick={on.later}>Add to Splitwise after</Button>
      </div>
    </Frame>
  );
}

function Row({ theme, label, value, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <div style={{ fontSize: 14, color: theme.inkSoft }}>{label}</div>
      <div style={{ fontSize: bold ? 18 : 14, fontWeight: bold ? 600 : 500, color: theme.ink, fontFamily: bold ? theme.serif : theme.sans }}>{value}</div>
    </div>
  );
}

Object.assign(window, {
  Frame, ScreenSignIn, ScreenName, ScreenFaceRef, ProgressDots, FormField, PhotuMark,
  ScreenLibrary, AlbumRow, IconButton, FAB, TabBar,
  ScreenCreateAlbum, ScreenInvite, ActionCard, ScreenPaywall, Row,
});
