// prototype.jsx — clickable hero flow inside an iOS-shaped device.
// Linear path: library → create → invite → upload → tag-confirm → feed (face-privacy on) → viewer → hide-me → paywall.

const { Avatar, AvatarStack, PhotoTile, Button, Chip, Icon } = window.UI;

const STEPS = [
  { id: 'library',  label: 'Library' },
  { id: 'create',   label: 'New album' },
  { id: 'invite',   label: 'Invite group' },
  { id: 'upload',   label: 'Uploading' },
  { id: 'tag',      label: 'Confirm tag' },
  { id: 'feed',     label: 'Album feed' },
  { id: 'viewer',   label: 'Photo viewer' },
  { id: 'hideme',   label: 'Hide me' },
  { id: 'paywall',  label: 'Paywall (4th)' },
  { id: 'receipt',  label: 'Split receipt' },
];

function Prototype({ theme }) {
  const [stepIdx, setStepIdx] = React.useState(0);
  const step = STEPS[stepIdx];

  const screen = (() => {
    switch (step.id) {
      case 'library': return <window.ScreenLibrary theme={theme}/>;
      case 'create':  return <window.ScreenCreateAlbum theme={theme}/>;
      case 'invite':  return <window.ScreenInvite theme={theme}/>;
      case 'upload':  return <window.ScreenUpload theme={theme}/>;
      case 'tag':     return <window.ScreenFaceTag theme={theme}/>;
      case 'feed':    return <window.ScreenAlbumFeed theme={theme}/>;
      case 'viewer':  return <window.ScreenViewer theme={theme}/>;
      case 'hideme':  return <window.ScreenViewer theme={theme} showHideSheet/>;
      case 'paywall': return <window.ScreenPaywall theme={theme}/>;
      case 'receipt': return <window.ScreenSplitReceipt theme={theme}/>;
      default: return null;
    }
  })();

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 32 }}>
      <PhoneShell theme={theme}>{screen}</PhoneShell>
      <div style={{ width: 240, paddingTop: 40, fontFamily: theme.sans }}>
        <div style={{ fontFamily: theme.mono, fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase', color: theme.inkMuted, marginBottom: 12 }}>Hero flow</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {STEPS.map((s, i) => (
            <button key={s.id} onClick={() => setStepIdx(i)} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px', borderRadius: 10, border: 'none', textAlign: 'left',
              background: i === stepIdx ? theme.ink : 'transparent',
              color: i === stepIdx ? theme.bg : theme.inkSoft,
              fontFamily: theme.sans, fontSize: 13.5, fontWeight: i === stepIdx ? 600 : 500,
              cursor: 'pointer',
            }}>
              <span style={{
                fontFamily: theme.mono, fontSize: 11, opacity: 0.6,
                width: 20,
              }}>{String(i + 1).padStart(2, '0')}</span>
              <span style={{ flex: 1 }}>{s.label}</span>
              {i === stepIdx && <Icon name="arrow-right" size={14} color={theme.bg}/>}
            </button>
          ))}
        </div>
        <div style={{ height: 18 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <Button theme={theme} kind="outline" size="sm" onClick={() => setStepIdx(Math.max(0, stepIdx - 1))} leading={<Icon name="chevron-left" size={14}/>}>Back</Button>
          <Button theme={theme} kind="primary" size="sm" onClick={() => setStepIdx(Math.min(STEPS.length - 1, stepIdx + 1))} trailing={<Icon name="chevron-right" size={14} color={theme.bg}/>}>Next</Button>
        </div>
      </div>
    </div>
  );
}

// Phone shell — an iPhone-style bezel matching the brand. Using minimal device chrome.
function PhoneShell({ children, theme, w = 390, h = 844 }) {
  return (
    <div style={{
      width: w + 14, height: h + 14, padding: 7,
      borderRadius: 56, background: '#1a1a1a',
      boxShadow: '0 30px 70px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,0,0,0.5)',
    }}>
      <div style={{
        width: w, height: h, borderRadius: 48, overflow: 'hidden',
        background: theme.bg, position: 'relative',
      }}>
        {/* Dynamic Island */}
        <div style={{ position: 'absolute', top: 11, left: '50%', transform: 'translateX(-50%)', width: 120, height: 34, borderRadius: 24, background: '#000', zIndex: 100 }}/>
        <div style={{ width: '100%', height: '100%' }}>{children}</div>
        {/* home indicator */}
        <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', width: 130, height: 5, borderRadius: 5, background: 'rgba(0,0,0,0.25)', zIndex: 200 }}/>
      </div>
    </div>
  );
}

window.Prototype = Prototype;
window.PhoneShell = PhoneShell;
