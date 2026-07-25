// theme.jsx — design tokens for "Photu"
// Two aesthetic directions: A "Keepsake" (warm) and B "Quiet" (cool premium)

const THEMES = {
  keepsake: {
    name: 'Keepsake',
    bg: '#F4EEE3',           // cream paper
    surface: '#FBF7EE',      // raised card
    surfaceAlt: '#EDE5D5',   // subtle card
    ink: '#1B1814',          // deep ink
    inkSoft: '#5A5249',      // body text
    inkMuted: '#8E867A',     // captions
    line: 'rgba(27,24,20,0.10)',
    lineStrong: 'rgba(27,24,20,0.18)',
    accent: 'oklch(0.62 0.14 50)',     // terracotta
    accentInk: '#FFFFFF',
    accentSoft: 'oklch(0.92 0.04 60)',
    danger: 'oklch(0.55 0.18 25)',
    success: 'oklch(0.55 0.10 145)',
    serif: '"EB Garamond", "Iowan Old Style", Georgia, serif',
    sans: '"Inter Tight", "Inter", -apple-system, system-ui, sans-serif',
    mono: '"JetBrains Mono", "SF Mono", ui-monospace, monospace',
    radius: 18,
    radiusSm: 10,
    radiusLg: 24,
  },
  quiet: {
    name: 'Quiet',
    bg: '#F7F6F3',
    surface: '#FFFFFF',
    surfaceAlt: '#EFEDE8',
    ink: '#15171A',
    inkSoft: '#454A52',
    inkMuted: '#8A8F97',
    line: 'rgba(21,23,26,0.08)',
    lineStrong: 'rgba(21,23,26,0.16)',
    accent: 'oklch(0.55 0.13 250)',    // cobalt
    accentInk: '#FFFFFF',
    accentSoft: 'oklch(0.94 0.03 250)',
    danger: 'oklch(0.55 0.18 25)',
    success: 'oklch(0.55 0.10 145)',
    serif: '"Fraunces", "Iowan Old Style", Georgia, serif',
    sans: '"Inter Tight", "Inter", -apple-system, system-ui, sans-serif',
    mono: '"JetBrains Mono", "SF Mono", ui-monospace, monospace',
    radius: 14,
    radiusSm: 8,
    radiusLg: 20,
  },
};

// Default phone canvas
const PHONE = { w: 390, h: 844 };

// Sample data ───────────────────────────────────────────────────────────────
const PEOPLE = [
  { id: 'me',   name: 'You',     hue: 28,  initials: 'YO' },
  { id: 'maya', name: 'Maya',    hue: 340, initials: 'MA' },
  { id: 'sam',  name: 'Sam',     hue: 220, initials: 'SA' },
  { id: 'priya',name: 'Priya',   hue: 160, initials: 'PR' },
  { id: 'leo',  name: 'Leo',     hue: 50,  initials: 'LE' },
  { id: 'ana',  name: 'Ana',     hue: 290, initials: 'AN' },
  { id: 'jun',  name: 'Jun',     hue: 100, initials: 'JU' },
];

// Photo placeholders — soft-toned gradient swatches (no real photos shipped,
// but we can label them as if they were the holiday set: beach, dinner, etc.)
const PHOTO_SET = [
  { id: 'p1', tag: 'beach',  ar: 1.5, faces: ['me','maya'],     scene: 'beach golden hour' },
  { id: 'p2', tag: 'dinner', ar: 0.75,faces: ['sam','priya'],   scene: 'dinner table candle' },
  { id: 'p3', tag: 'view',   ar: 1.5, faces: [],                scene: 'mountain view' },
  { id: 'p4', tag: 'group',  ar: 1.0, faces: ['me','maya','sam','priya','leo'], scene: 'group selfie' },
  { id: 'p5', tag: 'street', ar: 0.75,faces: ['leo'],           scene: 'lisbon street' },
  { id: 'p6', tag: 'food',   ar: 1.0, faces: [],                scene: 'pastel de nata' },
  { id: 'p7', tag: 'pool',   ar: 1.5, faces: ['me','priya'],    scene: 'pool morning' },
  { id: 'p8', tag: 'walk',   ar: 0.75,faces: ['ana','jun'],     scene: 'cobblestone walk' },
  { id: 'p9', tag: 'sunset', ar: 1.5, faces: [],                scene: 'sunset over tagus' },
  { id: 'p10',tag: 'cafe',   ar: 1.0, faces: ['me'],            scene: 'cafe espresso' },
  { id: 'p11',tag: 'tram',   ar: 0.75,faces: ['maya','leo'],    scene: '28 tram' },
  { id: 'p12',tag: 'tile',   ar: 1.0, faces: [],                scene: 'azulejo tiles close-up' },
];

// Person -> color helper
const personColor = (id) => {
  const p = PEOPLE.find(x => x.id === id);
  if (!p) return '#888';
  return `oklch(0.78 0.10 ${p.hue})`;
};

// Photo background — generated from the scene tag, deterministic.
// Uses layered gradients to feel like a real photo at small scale.
function photoBackground(photo, theme) {
  const presets = {
    beach:  'linear-gradient(155deg, #f7c98a 0%, #e9a567 35%, #c87a4a 70%, #6f4a3a 100%)',
    dinner: 'linear-gradient(170deg, #2a1c14 0%, #5b3220 35%, #c47a3e 75%, #f0c184 100%)',
    view:   'linear-gradient(180deg, #b9d4e3 0%, #7fa8be 50%, #4a6878 100%)',
    group:  'linear-gradient(160deg, #d8b896 0%, #b88560 50%, #6e4a36 100%)',
    street: 'linear-gradient(170deg, #f0d8b4 0%, #c89870 50%, #5a3e2a 100%)',
    food:   'linear-gradient(160deg, #f3dca4 0%, #d8a25a 60%, #6c4424 100%)',
    pool:   'linear-gradient(180deg, #cfe5e8 0%, #6fa8b8 60%, #2c5868 100%)',
    walk:   'linear-gradient(180deg, #ead7b6 0%, #b89066 50%, #4a3220 100%)',
    sunset: 'linear-gradient(180deg, #f4b878 0%, #d87a5a 40%, #5e3050 80%, #1c1830 100%)',
    cafe:   'linear-gradient(170deg, #d4b48a 0%, #8a5e3c 60%, #2e1c10 100%)',
    tram:   'linear-gradient(160deg, #e8c878 0%, #b8784a 50%, #4a2818 100%)',
    tile:   'linear-gradient(135deg, #b8c8d8 0%, #6888a0 50%, #2c4858 100%)',
  };
  return presets[photo.tag] || presets.view;
}

window.THEMES = THEMES;
window.PHONE = PHONE;
window.PEOPLE = PEOPLE;
window.PHOTO_SET = PHOTO_SET;
window.personColor = personColor;
window.photoBackground = photoBackground;
