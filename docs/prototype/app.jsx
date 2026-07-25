// app.jsx — WiredApp: the full Phase-1 prototype, every flow reachable by tapping.
// A nav stack + real app state (hidden photos, allowlist, album lifecycle, free-album count).

const { Icon, Button, Chip } = window.UI;

const FLOW_NOTES = {
  signin:   'Flow 1 · Onboarding — any provider continues',
  name:     'Flow 1 · Profile name',
  faceref:  'Flow 1 · Face reference (optional, skippable)',
  library:  'Home · tap an album, the FAB, the bell, or your avatar',
  libraryEmpty: 'First-run empty state',
  create:   'Flow 2 · Create album',
  invite:   'Flow 2 · Invite the group',
  join:     'Flow 3 · Join via link (invitee entry point)',
  upload:   'Flow 4 · Uploading — progress is live',
  uploadError: 'Flow 4 · Upload failure — retry resumes',
  tag:      'Flow 5 · Confirm face tags',
  feed:     'Flow 6 · Album feed — tap a photo, "Just me", or Extend',
  viewer:   'Flow 6 · Viewer — try Hide me or Allowlist',
  hideme:   'Flow 7 · Subject veto — confirming really removes the photo',
  extend:   'Flow 9 · Owner extends the window once',
  locked:   'Flow 10 · Keepsake state',
  paywall:  'Flow 11 · Album 4 paywall (you have 3/3 free used)',
  receipt:  'Flow 12 · Split receipt',
  activity: 'Cross-cutting · Activity inbox',
  settings: 'Cross-cutting · Settings',
  privacy:  'Privacy explainer',
  allowlist:'Flow 8 · Per-member allowlist — toggles persist',
};

function WiredApp({ theme, startAt = 'library' }) {
  const [stack, setStack] = React.useState([startAt]);
  const screen = stack[stack.length - 1];
  const push = s => setStack(st => [...st, s]);
  const pop = () => setStack(st => (st.length > 1 ? st.slice(0, -1) : st));
  const reset = s => setStack([s]);

  // real app state
  const [justMe, setJustMe] = React.useState(false);
  const [hidden, setHidden] = React.useState([]);
  const [albumState, setAlbumState] = React.useState('closing');
  const [granted, setGranted] = React.useState(['sam']);
  const [uploadPct, setUploadPct] = React.useState(0.1);
  const [paid, setPaid] = React.useState(false);
  const [viewerPhoto, setViewerPhoto] = React.useState(PHOTO_SET[3]);
  const [toast, setToast] = React.useState(null);
  const toastTimer = React.useRef(null);
  const say = msg => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  };

  // live upload progress
  React.useEffect(() => {
    if (screen !== 'upload') return;
    setUploadPct(0.1);
    const iv = setInterval(() => setUploadPct(p => {
      if (p >= 1) { clearInterval(iv); return 1; }
      return Math.min(1, p + 0.04 + Math.random() * 0.05);
    }), 180);
    return () => clearInterval(iv);
  }, [screen]);
  React.useEffect(() => {
    if (screen === 'upload' && uploadPct >= 1) {
      const t = setTimeout(() => { push('tag'); say('Upload complete — 12 photos at original quality'); }, 500);
      return () => clearTimeout(t);
    }
  }, [screen, uploadPct]);

  const tab = id => {
    if (id === 'library') reset('library');
    else if (id === 'notif') reset('activity');
    else if (id === 'me') reset('settings');
    else say('Invites lives in Phase 2 — use the album invite sheet');
  };

  const feedOn = {
    back: () => reset('library'),
    openPhoto: p => { setViewerPhoto(p); push('viewer'); },
    upload: () => push('upload'),
    extend: () => push('extend'),
    justMe: () => setJustMe(true),
    all: () => setJustMe(false),
    members: () => push('allowlist'),
    tab,
  };

  const body = (() => {
    switch (screen) {
      case 'signin':  return <window.ScreenSignIn theme={theme} on={{ signIn: () => push('name') }}/>;
      case 'name':    return <window.ScreenName theme={theme} on={{ next: () => push('faceref') }}/>;
      case 'faceref': return <window.ScreenFaceRef theme={theme} captured on={{ next: () => { reset('library'); say('Welcome to photu'); }, skip: () => { reset('library'); say('You can add a face photo later in Settings'); } }}/>;
      case 'library': return <window.ScreenLibrary theme={theme} on={{
        openAlbum: a => { setAlbumState(a.status === 'locked' ? 'locked' : a.status); push(a.status === 'locked' ? 'locked' : 'feed'); },
        create: () => push(paid ? 'create' : 'paywall'),
        activity: () => push('activity'),
        settings: () => push('settings'),
        tab,
      }}/>;
      case 'libraryEmpty': return <window.ScreenLibraryEmpty theme={theme} on={{ create: () => push('create'), paste: () => push('join') }}/>;
      case 'create':  return <window.ScreenCreateAlbum theme={theme} on={{ close: pop, create: () => push('invite') }}/>;
      case 'invite':  return <window.ScreenInvite theme={theme} on={{ done: () => { setAlbumState('active'); reset('library'); setTimeout(() => push('feed'), 0); say('Album created — 30-day window open'); } }}/>;
      case 'join':    return <window.ScreenJoin theme={theme} on={{ close: pop, join: () => push('signin'), browse: () => { setAlbumState('active'); push('feed'); say('Read-only until you sign in'); } }}/>;
      case 'upload':  return <window.ScreenUpload theme={theme} progress={uploadPct} on={{ close: pop }}/>;
      case 'uploadError': return <window.ScreenUploadError theme={theme} on={{ close: pop, retry: () => { pop(); push('upload'); }, auto: () => { pop(); say('Will retry automatically on Wi-Fi'); } }}/>;
      case 'tag':     return <window.ScreenFaceTag theme={theme} on={{ close: pop, confirm: () => { setStack(st => st.filter(s => s !== 'upload' && s !== 'tag')); say('Tagged in 12 photos'); }, reject: () => { setStack(st => st.filter(s => s !== 'upload' && s !== 'tag')); say('Thanks — matching improved'); } }}/>;
      case 'feed':    return <window.ScreenAlbumFeed theme={theme} viewer="me" privacyMode="face" state={albumState} justMe={justMe} hiddenIds={hidden} on={feedOn}/>;
      case 'viewer':  return <window.ScreenViewer theme={theme} photo={viewerPhoto} on={{ back: pop, hideMe: () => push('hideme'), allowlist: () => push('allowlist'), save: () => say('Saved at original quality'), share: () => say('Share sheet (system)') }}/>;
      case 'hideme':  return <window.ScreenViewer theme={theme} photo={viewerPhoto} showHideSheet on={{
        back: pop, cancelHide: pop,
        confirmHide: () => { setHidden(h => [...h, viewerPhoto.id]); setStack(st => st.filter(s => s !== 'viewer' && s !== 'hideme')); say('Hidden for everyone · Maya was notified'); },
      }}/>;
      case 'extend':  return <window.ScreenExtendWindow theme={theme} on={{ close: pop, extend: () => { setAlbumState('active'); pop(); say('Extended to April 16 — members notified'); } }}/>;
      case 'locked':  return <window.ScreenLocked theme={theme} on={{ back: () => reset('library') }}/>;
      case 'paywall': return <window.ScreenPaywall theme={theme} on={{ close: pop, pay: () => { setPaid(true); push('receipt'); }, later: () => say('You can add it to Splitwise from the receipt') }}/>;
      case 'receipt': return <window.ScreenSplitReceipt theme={theme} on={{ close: () => push('create'), done: () => { push('create'); say('Receipt sent to Splitwise'); } }}/>;
      case 'activity':return <window.ScreenActivity theme={theme} on={{ settings: () => push('settings'), tab }}/>;
      case 'settings':return <window.ScreenSettings theme={theme} on={{
        back: () => reset('library'),
        privacy: () => push('privacy'), allowlist: () => push('allowlist'),
        faceRef: () => push('faceref'),
        deleteFace: () => say('Face data deleted — matching disabled'),
        export: () => say('Export starts in the background'),
        leave: () => say('Pick an album to leave'), deleteAccount: () => say('We\u2019d email a confirmation first'),
      }}/>;
      case 'privacy': return <window.ScreenPrivacyExplainer theme={theme} on={{ back: pop }}/>;
      case 'allowlist': return <window.ScreenAllowlist theme={theme} granted={granted} on={{ back: pop, toggle: id => setGranted(g => g.includes(id) ? g.filter(x => x !== id) : [...g, id]) }}/>;
      default: return null;
    }
  })();

  const entries = [
    { id: 'signin', label: 'New user', icon: 'user' },
    { id: 'library', label: 'Returning', icon: 'home' },
    { id: 'join', label: 'Invitee (link)', icon: 'link' },
    { id: 'libraryEmpty', label: 'First run', icon: 'sparkle' },
    { id: 'uploadError', label: 'Upload fails', icon: 'x' },
  ];

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 32 }}>
      <div style={{ position: 'relative' }}>
        <window.PhoneShell theme={theme}>{body}</window.PhoneShell>
        {/* toast */}
        {toast && (
          <div style={{
            position: 'absolute', bottom: 120, left: 30, right: 30, zIndex: 300,
            padding: '12px 16px', borderRadius: 14,
            background: 'rgba(20,18,15,0.92)', color: '#F4EEE3', backdropFilter: 'blur(10px)',
            fontFamily: theme.sans, fontSize: 13, fontWeight: 500, lineHeight: 1.4, textAlign: 'center',
            boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
          }}>{toast}</div>
        )}
      </div>
      {/* side panel */}
      <div style={{ width: 250, paddingTop: 28, fontFamily: theme.sans }}>
        <div style={{ fontFamily: theme.mono, fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase', color: theme.inkMuted }}>Start from</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {entries.map(e => (
            <button key={e.id} onClick={() => { setStack([e.id]); setJustMe(false); }} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '7px 12px', borderRadius: 999, border: `1px solid ${stack[0] === e.id ? theme.ink : theme.lineStrong}`,
              background: stack[0] === e.id ? theme.ink : 'transparent',
              color: stack[0] === e.id ? theme.bg : theme.inkSoft,
              fontFamily: theme.sans, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
            }}><Icon name={e.icon} size={13}/>{e.label}</button>
          ))}
        </div>
        <div style={{ height: 22 }}/>
        <div style={{ fontFamily: theme.mono, fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase', color: theme.inkMuted }}>You are here</div>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {stack.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0 6px', paddingLeft: i * 14 }}>
              {i > 0 && <span style={{ color: theme.inkMuted }}>↳</span>}
              <span style={{
                fontFamily: theme.sans, fontSize: 13, fontWeight: i === stack.length - 1 ? 700 : 500,
                color: i === stack.length - 1 ? theme.ink : theme.inkMuted,
              }}>{s}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 8, padding: 12, borderRadius: 12, background: theme.surface, border: `1px solid ${theme.line}`, fontSize: 12, lineHeight: 1.5, color: theme.inkSoft }}>
          {FLOW_NOTES[screen]}
        </div>
        <div style={{ height: 18 }}/>
        <div style={{ fontFamily: theme.mono, fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase', color: theme.inkMuted }}>Live state</div>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: theme.inkSoft }}>
          <div>Hidden photos: <strong style={{ color: theme.ink }}>{hidden.length}</strong>{hidden.length > 0 && <span onClick={() => setHidden([])} style={{ marginLeft: 8, color: theme.accent, cursor: 'pointer', textDecoration: 'underline' }}>restore</span>}</div>
          <div>Allowlist: <strong style={{ color: theme.ink }}>{granted.length ? granted.join(', ') : 'nobody'}</strong></div>
          <div>Album window: <strong style={{ color: theme.ink }}>{albumState}</strong></div>
          <div>Free albums: <strong style={{ color: theme.ink }}>3/3 used{paid ? ' · album 4 paid' : ''}</strong></div>
        </div>
        {stack.length > 1 && (
          <button onClick={pop} style={{ marginTop: 16, padding: '8px 16px', borderRadius: 999, border: `1px solid ${theme.lineStrong}`, background: 'transparent', color: theme.ink, fontFamily: theme.sans, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="chevron-left" size={13}/>Back one screen
          </button>
        )}
      </div>
    </div>
  );
}

window.WiredApp = WiredApp;
