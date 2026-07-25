// screens-album.jsx — album feed, viewer, face-privacy, hide-me, save, locked.

const { Avatar, AvatarStack, PhotoTile, Button, Chip, SectionLabel, StatusBar, Icon } = window.UI;
const { Frame, IconButton, TabBar } = window;

// ──────────────────────────────────────────────────────────────────
// ALBUM FEED — chronological grid
// ──────────────────────────────────────────────────────────────────
function ScreenAlbumFeed({ theme, viewer = 'me', privacyMode = 'face', state = 'active', daysLeft = 4, justMe = false, hiddenIds = [], on = {} }) {
  const allPhotos = PHOTO_SET.filter(p => !hiddenIds.includes(p.id));
  // Apply face privacy
  let visible = allPhotos;
  if (privacyMode === 'face' && !justMe) {
    visible = allPhotos.filter(p => p.faces.length === 0 || p.faces.includes(viewer));
  } else if (justMe) {
    visible = allPhotos.filter(p => p.faces.includes(viewer));
  }
  // Group by day
  const days = [
    { label: 'Today',    range: [0, 4] },
    { label: 'Yesterday',range: [4, 8] },
    { label: 'Mar 28',   range: [8, 12] },
  ];
  return (
    <Frame theme={theme}>
      <AlbumHeader theme={theme} title="Lisbon, March" subtitle="5 members · 184 photos" state={state} daysLeft={daysLeft} cover={PHOTO_SET[0]} on={on} />
      <div style={{ padding: '0 16px 12px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <FilterChip theme={theme} active={!justMe} onClick={on.all}>All</FilterChip>
        <FilterChip theme={theme} active={justMe} icon="face" onClick={on.justMe}>Just me</FilterChip>
        <FilterChip theme={theme}>By person</FilterChip>
        <FilterChip theme={theme}>By scene</FilterChip>
      </div>
      {state === 'closing' && <ClosingBanner theme={theme} hours={36} onExtend={on.extend} />}
      <div style={{ flex: 1, overflow: 'auto', padding: '0 16px 100px' }}>
        {days.map(d => {
          const photos = visible.slice(d.range[0], d.range[1]);
          if (!photos.length) return null;
          return (
            <div key={d.label} style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '8px 4px 10px' }}>
                <div style={{ fontFamily: theme.serif, fontSize: 17, fontWeight: 500, color: theme.ink }}>{d.label}</div>
                <div style={{ fontFamily: theme.mono, fontSize: 11, color: theme.inkMuted, letterSpacing: 0.5 }}>{photos.length} photos</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
                {photos.map(p => (
                  <div key={p.id} style={{ aspectRatio: '1', position: 'relative' }}>
                    <PhotoTile photo={{...p, ar: 1}} theme={theme} w={110} rounded={6}
                      dimmed={state === 'locked'} onClick={on.openPhoto ? () => on.openPhoto(p) : undefined} />
                    {p.faces.includes(viewer) && privacyMode === 'face' && (
                      <div style={{ position: 'absolute', top: 4, left: 4, width: 14, height: 14, borderRadius: 14, background: theme.accent, color: theme.accentInk, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name="face" size={9} stroke={2.2}/>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {visible.length === 0 && <FaceEmptyState theme={theme} onAll={on.all} />}
      </div>
      {state !== 'locked' && (
        <div style={{ position: 'absolute', bottom: 96, right: 20, zIndex: 5 }}>
          <button onClick={on.upload} style={{
            height: 56, padding: '0 22px 0 18px', borderRadius: 56,
            background: theme.accent, color: theme.accentInk, border: 'none',
            display: 'flex', alignItems: 'center', gap: 8,
            fontFamily: theme.sans, fontSize: 15, fontWeight: 600,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)', cursor: 'pointer',
          }}>
            <Icon name="upload" size={18} color={theme.accentInk}/>
            Add photos
          </button>
        </div>
      )}
      <TabBar theme={theme} active="library" onTab={on.tab} />
    </Frame>
  );
}

function AlbumHeader({ theme, title, subtitle, state, daysLeft, cover, on = {} }) {
  return (
    <div style={{ position: 'relative', padding: '6px 16px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 12 }}>
        <IconButton theme={theme} icon="chevron-left" onClick={on.back}/>
        <div style={{ flex: 1 }} />
        <IconButton theme={theme} icon="users" onClick={on.members}/>
        <IconButton theme={theme} icon="more" onClick={on.more}/>
      </div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end' }}>
        <PhotoTile photo={cover} theme={theme} w={70} rounded={theme.radius} />
        <div style={{ flex: 1, minWidth: 0, paddingBottom: 4 }}>
          <h1 style={{ margin: 0, fontFamily: theme.serif, fontSize: 26, fontWeight: 500, letterSpacing: -0.3 }}>{title}</h1>
          <div style={{ fontSize: 12.5, color: theme.inkMuted, marginTop: 2 }}>{subtitle}</div>
          <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {state === 'active' && <Chip theme={theme} tone="neutral" leading={<Icon name="clock" size={11}/>}>{daysLeft} days left</Chip>}
            {state === 'closing' && <Chip theme={theme} tone="danger" leading={<Icon name="clock" size={11}/>}>Locks in 36h</Chip>}
            {state === 'locked' && <Chip theme={theme} tone="ink" leading={<Icon name="lock" size={11}/>}>Locked · Keepsake</Chip>}
            <Chip theme={theme} tone="neutral" leading={<Icon name="face" size={11}/>}>Face-privacy</Chip>
          </div>
        </div>
      </div>
    </div>
  );
}

function FilterChip({ theme, active, icon, children, onClick }) {
  return (
    <span onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '7px 12px', borderRadius: 999,
      background: active ? theme.ink : theme.surface,
      color: active ? theme.bg : theme.ink,
      border: active ? 'none' : `1px solid ${theme.line}`,
      fontSize: 13, fontWeight: 500,
      cursor: onClick ? 'pointer' : undefined,
    }}>{icon && <Icon name={icon} size={12}/>}{children}</span>
  );
}

function ClosingBanner({ theme, hours, onExtend }) {
  return (
    <div style={{
      margin: '0 16px 12px', padding: '10px 14px',
      background: 'oklch(0.96 0.04 60)', color: 'oklch(0.40 0.13 50)',
      borderRadius: theme.radius, display: 'flex', alignItems: 'center', gap: 10,
      border: `1px solid oklch(0.85 0.06 60)`,
    }}>
      <Icon name="clock" size={16}/>
      <div style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>Album locks in {hours} hours · upload now</div>
      <span onClick={onExtend} style={{ fontSize: 12, fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 2, cursor: onExtend ? 'pointer' : undefined }}>Extend</span>
    </div>
  );
}

function FaceEmptyState({ theme, onAll }) {
  return (
    <div style={{ padding: '60px 32px', textAlign: 'center' }}>
      <div style={{ width: 64, height: 64, borderRadius: 64, background: theme.surface, border: `1px solid ${theme.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: theme.inkMuted }}>
        <Icon name="face" size={28}/>
      </div>
      <div style={{ fontFamily: theme.serif, fontSize: 22, fontWeight: 500, lineHeight: 1.2, marginBottom: 8 }}>No photos of you yet</div>
      <div style={{ fontSize: 14, color: theme.inkSoft, lineHeight: 1.5 }}>This album uses face-privacy. As the group uploads, photos of you will appear here automatically.</div>
      <div style={{ height: 18 }} />
      <Button theme={theme} kind="outline" size="md" onClick={onAll}>See all (no people detected)</Button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// FULL-SCREEN VIEWER + hide-me menu
// ──────────────────────────────────────────────────────────────────
function ScreenViewer({ theme, photo = PHOTO_SET[3], showHideSheet = false, on = {} }) {
  return (
    <Frame theme={theme} dark statusDark>
      <div style={{
        position: 'absolute', inset: 0,
        background: photoBackground(photo), 
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse at 30% 20%, rgba(255,255,255,0.18), transparent 50%), radial-gradient(ellipse at 80% 90%, rgba(0,0,0,0.35), transparent 60%)',
          mixBlendMode: 'overlay',
        }} />
      </div>
      {/* top bar */}
      <div style={{ position: 'absolute', top: 8, left: 0, right: 0, padding: '0 16px', display: 'flex', alignItems: 'center', gap: 4 }}>
        <button onClick={on.back} style={{ width: 40, height: 40, borderRadius: 40, background: 'rgba(0,0,0,0.45)', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(12px)', cursor: on.back ? 'pointer' : undefined }}>
          <Icon name="chevron-left" size={18} color="#fff"/>
        </button>
        <div style={{ flex: 1 }} />
        <Chip theme={theme} tone="glass" style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(12px)' }} leading={<Icon name="user" size={10} color="#fff"/>}>Maya · 14:22</Chip>
        <div style={{ width: 8 }} />
        <button style={{ width: 40, height: 40, borderRadius: 40, background: 'rgba(0,0,0,0.45)', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(12px)' }}>
          <Icon name="more" size={18} color="#fff"/>
        </button>
      </div>
      {/* face chips */}
      <div style={{ position: 'absolute', bottom: showHideSheet ? 360 : 110, left: 16, right: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {photo.faces.slice(0,4).map(id => (
          <span key={id} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 10px 4px 4px', borderRadius: 999,
            background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(12px)',
            color: '#fff', fontSize: 12, fontWeight: 500,
          }}>
            <Avatar id={id} size={20} theme={theme}/>{PEOPLE.find(p => p.id === id)?.name}
          </span>
        ))}
      </div>
      {/* bottom toolbar */}
      <div style={{ position: 'absolute', bottom: 36, left: 16, right: 16, display: 'flex', gap: 8 }}>
        {[
          { i: 'download', l: 'Save',      act: on.save },
          { i: 'share',    l: 'Share',     act: on.share },
          { i: 'eye-off',  l: 'Hide me',   act: on.hideMe },
          { i: 'heart',    l: 'Allowlist', act: on.allowlist },
        ].map(b => (
          <div key={b.i} onClick={b.act} style={{
            flex: 1, height: 56, borderRadius: 16,
            background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(16px)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, color: '#fff',
            cursor: b.act ? 'pointer' : undefined,
          }}>
            <Icon name={b.i} size={18} color="#fff"/>
            <div style={{ fontSize: 10.5, fontWeight: 500 }}>{b.l}</div>
          </div>
        ))}
      </div>
      {showHideSheet && <HideMeSheet theme={theme} on={on}/>}
    </Frame>
  );
}

function HideMeSheet({ theme, on = {} }) {
  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0,
      background: theme.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
      padding: '14px 24px 28px', boxShadow: '0 -10px 40px rgba(0,0,0,0.3)',
    }}>
      <div style={{ width: 40, height: 4, borderRadius: 4, background: theme.lineStrong, margin: '0 auto 14px' }} />
      <div style={{ fontFamily: theme.serif, fontSize: 22, fontWeight: 500, letterSpacing: -0.2 }}>Hide this photo of you?</div>
      <p style={{ marginTop: 8, color: theme.inkSoft, fontSize: 14, lineHeight: 1.5 }}>
        It will be removed from the album for everyone. <span style={{ color: theme.ink, fontWeight: 500 }}>Maya</span> (the photographer) will keep their copy and get a polite heads-up.
      </p>
      <div style={{ marginTop: 14, padding: 12, borderRadius: theme.radius, background: theme.surface, border: `1px solid ${theme.line}`, display: 'flex', gap: 10, alignItems: 'center' }}>
        <Avatar id="maya" size={28} theme={theme}/>
        <div style={{ flex: 1, fontSize: 13, color: theme.inkSoft }}>"Hi Maya — Dev hid a photo. No reason needed, just a heads up."</div>
      </div>
      <div style={{ height: 14 }} />
      <Button theme={theme} kind="primary" size="lg" full onClick={on.confirmHide}>Hide for everyone</Button>
      <div style={{ height: 8 }} />
      <Button theme={theme} kind="ghost" size="md" full onClick={on.cancelHide}>Cancel</Button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// LOCKED ALBUM — keepsake state
// ──────────────────────────────────────────────────────────────────
function ScreenLocked({ theme, on = {} }) {
  return (
    <Frame theme={theme}>
      <div style={{ padding: '6px 16px 14px', display: 'flex', alignItems: 'center', gap: 4 }}>
        <IconButton theme={theme} icon="chevron-left" onClick={on.back}/>
        <div style={{ flex: 1 }} />
        <IconButton theme={theme} icon="more"/>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '0 24px 100px' }}>
        <div style={{
          aspectRatio: '4/5', borderRadius: theme.radiusLg, position: 'relative',
          background: photoBackground(PHOTO_SET[8]), overflow: 'hidden',
          boxShadow: '0 20px 50px rgba(0,0,0,0.18)',
        }}>
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 50%, rgba(0,0,0,0.6) 100%)' }} />
          <div style={{ position: 'absolute', top: 14, left: 14 }}>
            <Chip theme={theme} tone="glass" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(12px)' }} leading={<Icon name="lock" size={10} color="#fff"/>}>Locked</Chip>
          </div>
          <div style={{ position: 'absolute', bottom: 22, left: 22, right: 22, color: '#fff' }}>
            <div style={{ fontFamily: theme.mono, fontSize: 11, letterSpacing: 1.5, opacity: 0.85, textTransform: 'uppercase' }}>March 2 — April 2</div>
            <div style={{ fontFamily: theme.serif, fontSize: 36, fontWeight: 500, letterSpacing: -0.5, marginTop: 4 }}>Lisbon, March</div>
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <AvatarStack ids={['me','maya','sam','priya','leo']} theme={theme} size={22}/>
              <div style={{ fontSize: 12.5, opacity: 0.85 }}>5 members · 184 photos</div>
            </div>
          </div>
        </div>
        <div style={{ height: 22 }} />
        <div style={{ fontFamily: theme.serif, fontSize: 17, color: theme.inkSoft, lineHeight: 1.5, fontStyle: 'italic' }}>
          The album is now read-only. Save what you want to keep, or order a printed photo book later this year.
        </div>
        <div style={{ height: 18 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Button theme={theme} kind="primary" size="lg" full leading={<Icon name="download" size={18} color={theme.bg}/>}>Save album to camera roll</Button>
          <Button theme={theme} kind="outline" size="lg" full leading={<Icon name="sparkle" size={18}/>}>Photo book — coming soon</Button>
        </div>
        <div style={{ height: 26 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
          {PHOTO_SET.slice(0, 9).map(p => (
            <div key={p.id} style={{ aspectRatio: '1' }}>
              <PhotoTile photo={{...p, ar: 1}} theme={theme} w={110} rounded={4} dimmed/>
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
}

// ──────────────────────────────────────────────────────────────────
// UPLOAD progress
// ──────────────────────────────────────────────────────────────────
function ScreenUpload({ theme, progress = 0.62, on = {} }) {
  return (
    <Frame theme={theme}>
      <div style={{ padding: '6px 16px 14px', display: 'flex', alignItems: 'center', gap: 4 }}>
        <IconButton theme={theme} icon="x" onClick={on.close}/>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 15, fontWeight: 600 }}>Uploading 12 photos</div>
        <div style={{ width: 38 }} />
      </div>
      <div style={{ padding: '0 24px', flex: 1, overflow: 'auto' }}>
        <div style={{
          padding: 16, borderRadius: theme.radius,
          background: theme.surface, border: `1px solid ${theme.line}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div style={{ fontFamily: theme.mono, fontSize: 11, letterSpacing: 1.4, color: theme.inkMuted, textTransform: 'uppercase' }}>Original quality</div>
            <div style={{ fontFamily: theme.mono, fontSize: 12, color: theme.inkSoft }}>{Math.round(progress * 100)}%</div>
          </div>
          <div style={{ height: 6, background: theme.surfaceAlt, borderRadius: 6, marginTop: 10, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress * 100}%`, background: theme.accent, borderRadius: 6 }} />
          </div>
          <div style={{ marginTop: 10, fontSize: 12.5, color: theme.inkSoft }}>1.4 GB of 2.3 GB · ~ 2 min remaining</div>
        </div>
        <div style={{ height: 18 }} />
        <SectionLabel theme={theme}>In this batch</SectionLabel>
        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
          {PHOTO_SET.slice(0, 12).map((p, i) => (
            <div key={p.id} style={{ aspectRatio: '1', position: 'relative' }}>
              <PhotoTile photo={{...p, ar: 1}} theme={theme} w={80} rounded={6} dimmed={i > 7}/>
              {i <= 7 && (
                <div style={{ position: 'absolute', top: 4, right: 4, width: 16, height: 16, borderRadius: 16, background: theme.success, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="check" size={10} stroke={3} color="#fff"/>
                </div>
              )}
            </div>
          ))}
        </div>
        <div style={{ height: 18 }} />
        <div style={{
          padding: 14, borderRadius: theme.radius, background: theme.accentSoft,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <Icon name="sparkle" size={18} color={theme.accent}/>
          <div style={{ flex: 1, fontSize: 13, color: theme.ink }}>
            <div style={{ fontWeight: 600 }}>Finding faces…</div>
            <div style={{ color: theme.inkSoft, marginTop: 2 }}>We'll ask you to confirm tags once everything is uploaded.</div>
          </div>
        </div>
      </div>
    </Frame>
  );
}

// ──────────────────────────────────────────────────────────────────
// FACE TAG CONFIRM
// ──────────────────────────────────────────────────────────────────
function ScreenFaceTag({ theme, on = {} }) {
  return (
    <Frame theme={theme}>
      <div style={{ padding: '6px 16px 14px', display: 'flex', alignItems: 'center', gap: 4 }}>
        <IconButton theme={theme} icon="x" onClick={on.close}/>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 15, fontWeight: 600 }}>Confirm tags</div>
        <div style={{ width: 38 }} />
      </div>
      <div style={{ padding: '0 24px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ textAlign: 'center', padding: '12px 0 18px' }}>
          <div style={{ fontFamily: theme.mono, fontSize: 11, letterSpacing: 1.4, color: theme.inkMuted, textTransform: 'uppercase' }}>1 of 3 people</div>
          <h2 style={{ margin: '8px 0 4px', fontFamily: theme.serif, fontSize: 26, fontWeight: 500, letterSpacing: -0.3 }}>Is this you in 12 photos?</h2>
          <div style={{ fontSize: 13.5, color: theme.inkSoft }}>Helps the group find you across the album.</div>
        </div>
        <div style={{ flex: 1, position: 'relative', borderRadius: theme.radiusLg, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, background: photoBackground(PHOTO_SET[3]) }} />
          {/* face highlight */}
          <div style={{
            position: 'absolute', top: '38%', left: '32%',
            width: 84, height: 84, borderRadius: 8,
            border: `2.5px solid ${theme.accent}`,
            boxShadow: `0 0 0 9999px rgba(0,0,0,0.45)`,
          }} />
          <div style={{ position: 'absolute', bottom: 14, left: 14, right: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Chip theme={theme} tone="glass" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(12px)' }}>1 / 12</Chip>
            <div style={{ flex: 1 }} />
            <Chip theme={theme} tone="glass" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(12px)' }}>98% match</Chip>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, padding: '18px 0 28px' }}>
          <Button theme={theme} kind="outline" size="lg" full onClick={on.reject} leading={<Icon name="x" size={16}/>}>Not me</Button>
          <Button theme={theme} kind="primary" size="lg" full onClick={on.confirm} leading={<Icon name="check" size={16} color={theme.bg}/>}>Yes — for all 12</Button>
        </div>
      </div>
    </Frame>
  );
}

Object.assign(window, {
  ScreenAlbumFeed, AlbumHeader, FilterChip, ClosingBanner, FaceEmptyState,
  ScreenViewer, HideMeSheet, ScreenLocked, ScreenUpload, ScreenFaceTag,
});
