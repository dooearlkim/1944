/* SKY ACE 1944 — original retro vertical shooter.
   Pure HTML5 Canvas + Vanilla JS. All graphics & sound are generated in code. */
'use strict';
(() => {
// =====================================================================
// 0. UTILS / CONFIG
// =====================================================================
const W = 240;
let H = 320;                       // chosen at boot from screen aspect (320..400)
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const $ = (id) => document.getElementById(id);
const R = Math.round;

const canvas = $('game');
let ctx = null;
const view = { scale: 1 };
let shx = 0, shy = 0;              // screen shake offset (world layer)

function setupCanvas() {
  canvas.width = W; canvas.height = H;
  ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;
}
function pickHeight() {
  const r = $('wrap').getBoundingClientRect();
  return clamp(Math.round((W * r.height / Math.max(1, r.width)) / 2) * 2, 320, 400);
}
function resize() {
  if (!ctx || G.state === 'title') {
    const nh = pickHeight();
    if (nh !== H || !ctx) { H = nh; setupCanvas(); }
  }
  const r = $('wrap').getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  // scale in *device* pixels; snap to an integer multiple when that wastes little space
  let s = Math.min(r.width * dpr / W, r.height * dpr / H);
  if (s >= 2) { const f = Math.floor(s); if ((s - f) / s < 0.12) s = f; }
  const cw = Math.floor(W * s) / dpr, ch = Math.floor(H * s) / dpr;
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
  view.scale = cw / W;
}

// deterministic hash / periodic value noise (for terrain)
function hash(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s, py) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const y0 = ((yi % py) + py) % py, y1 = (y0 + 1) % py;
  const a = hash(xi, y0, s), b = hash(xi + 1, y0, s), c = hash(xi, y1, s), d = hash(xi + 1, y1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s, py) {
  return vnoise(x, y, s, py) * 0.55 + vnoise(x * 2, y * 2, s + 7, py * 2) * 0.3 + vnoise(x * 4, y * 4, s + 13, py * 4) * 0.15;
}

// =====================================================================
// 1. SPRITE TOOLKIT (offscreen canvases, built once at boot)
// =====================================================================
function mk(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  return [c, g];
}
function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function fromRows(rows, pal) {
  const h = rows.length, w = rows[0].length;
  const [c, g] = mk(w, h);
  const id = g.createImageData(w, h), p = id.data;
  const cache = {};
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = rows[y][x];
    if (ch === '.' || ch === undefined) continue;
    const col = cache[ch] || (cache[ch] = rgb(pal[ch] || '#ff00ff'));
    const i = (y * w + x) * 4;
    p[i] = col[0]; p[i + 1] = col[1]; p[i + 2] = col[2]; p[i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  return c;
}
// mirror left-half rows (last char = center column)
function sym(half) { return half.map((r) => r + r.slice(0, -1).split('').reverse().join('')); }
function silhouette(src, color, alpha = 1) {
  const [c, g] = mk(src.width, src.height);
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.globalAlpha = alpha; g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}
// threshold alpha (pixel-crisp edges) and optionally add a 1px outline
function crisp(c, outline) {
  const w = c.width, h = c.height, g = c.getContext('2d');
  const d = g.getImageData(0, 0, w, h), p = d.data;
  for (let i = 3; i < p.length; i += 4) p[i] = p[i] >= 110 ? 255 : 0;
  if (!outline) { g.putImageData(d, 0, 0); return c; }
  const W2 = w + 2, H2 = h + 2;
  const [o, og] = mk(W2, H2);
  const od = og.createImageData(W2, H2), q = od.data;
  const oc = rgb(outline);
  const op = (x, y) => x >= 0 && y >= 0 && x < w && y < h && p[(y * w + x) * 4 + 3] > 0;
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
    const sx = x - 1, sy = y - 1, j = (y * W2 + x) * 4;
    if (op(sx, sy)) { const i = (sy * w + sx) * 4; q[j] = p[i]; q[j + 1] = p[i + 1]; q[j + 2] = p[i + 2]; q[j + 3] = 255; }
    else if (op(sx - 1, sy) || op(sx + 1, sy) || op(sx, sy - 1) || op(sx, sy + 1)) { q[j] = oc[0]; q[j + 1] = oc[1]; q[j + 2] = oc[2]; q[j + 3] = 255; }
  }
  og.putImageData(od, 0, 0);
  return o;
}
// paint procedurally then make crisp + outlined
function paint(w, h, fn, outline = '#10121c') {
  const [c, g] = mk(w, h);
  fn(g, w, h);
  return crisp(c, outline);
}
// pre-rotated frames (nearest neighbour) — base = angle the source sprite faces
function rotations(src, n) {
  const s = Math.ceil(Math.hypot(src.width, src.height)) + 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const [c, g] = mk(s, s);
    g.translate(s / 2, s / 2); g.rotate((i / n) * TAU);
    g.drawImage(src, -src.width / 2, -src.height / 2);
    out.push(crisp(c));
  }
  return out;
}
function rotIndex(ang, base, n) { return ((Math.round(((ang - base) / TAU) * n) % n) + n) % n; }
// sprite bundle: normal / white flash / shadow
function bundle(img) { return { n: img, w: silhouette(img, '#ffffff'), s: silhouette(img, '#000000', 0.32) }; }

const SPR = {};

// ---------- bitmap font 5x7 ----------
const FONT = {
  '0': [14,17,19,21,25,17,14], '1': [4,12,4,4,4,4,14], '2': [14,17,1,2,4,8,31], '3': [31,2,4,2,1,17,14],
  '4': [2,6,10,18,31,2,2], '5': [31,16,30,1,1,17,14], '6': [6,8,16,30,17,17,14], '7': [31,1,2,4,8,8,8],
  '8': [14,17,17,14,17,17,14], '9': [14,17,17,15,1,2,12],
  A: [14,17,17,31,17,17,17], B: [30,17,17,30,17,17,30], C: [14,17,16,16,16,17,14], D: [28,18,17,17,17,18,28],
  E: [31,16,16,30,16,16,31], F: [31,16,16,30,16,16,16], G: [14,17,16,23,17,17,15], H: [17,17,17,31,17,17,17],
  I: [14,4,4,4,4,4,14], J: [7,2,2,2,2,18,12], K: [17,18,20,24,20,18,17], L: [16,16,16,16,16,16,31],
  M: [17,27,21,21,17,17,17], N: [17,17,25,21,19,17,17], O: [14,17,17,17,17,17,14], P: [30,17,17,30,16,16,16],
  Q: [14,17,17,17,21,18,13], R: [30,17,17,30,20,18,17], S: [15,16,16,14,1,1,30], T: [31,4,4,4,4,4,4],
  U: [17,17,17,17,17,17,14], V: [17,17,17,17,17,10,4], W: [17,17,17,21,21,21,10], X: [17,17,10,4,10,17,17],
  Y: [17,17,17,10,4,4,4], Z: [31,1,2,4,8,16,31],
  '.': [0,0,0,0,0,12,12], ':': [0,12,12,0,12,12,0], '!': [4,4,4,4,4,0,4], '-': [0,0,0,31,0,0,0],
  '/': [1,1,2,4,8,16,16], '?': [14,17,1,2,4,0,4], '(': [2,4,8,8,8,4,2], ')': [8,4,2,2,2,4,8],
  '>': [8,4,2,1,2,4,8], '<': [2,4,8,16,8,4,2], "'": [4,4,8,0,0,0,0], ',': [0,0,0,0,12,4,8],
  '+': [0,4,4,31,4,4,0], '=': [0,0,31,0,31,0,0], '@': [14,17,23,25,23,17,14], '*': [0,21,14,31,14,21,0],
  ' ': [0,0,0,0,0,0,0],
};
const FONT_KEYS = Object.keys(FONT);
const FONT_IDX = {}; FONT_KEYS.forEach((k, i) => (FONT_IDX[k] = i));
const FONT_COLORS = { w: '#ffffff', y: '#ffd84a', r: '#ff5a4a', c: '#6ae8ff', g: '#9aa4b0', o: '#ff9a2a', n: '#7cf07c' };
const fontAtlas = {};
function buildFont() {
  for (const name in FONT_COLORS) {
    const [c, g] = mk(FONT_KEYS.length * 6, 8);
    for (let pass = 0; pass < 2; pass++) {
      g.fillStyle = pass ? FONT_COLORS[name] : '#000000';
      const o = pass ? 0 : 1;
      FONT_KEYS.forEach((k, i) => {
        const rows = FONT[k];
        for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++)
          if ((rows[y] >> (4 - x)) & 1) g.fillRect(i * 6 + x + o, y + o, 1, 1);
      });
    }
    fontAtlas[name] = c;
  }
}
// align: 0 left, 1 center, 2 right
function text(str, x, y, col = 'w', align = 0, sc = 1) {
  str = String(str).toUpperCase();
  const atlas = fontAtlas[col] || fontAtlas.w;
  const w = str.length * 6 * sc;
  let sx = align === 1 ? x - w / 2 : align === 2 ? x - w : x;
  sx = R(sx); y = R(y);
  for (let i = 0; i < str.length; i++) {
    const idx = FONT_IDX[str[i]];
    if (idx === undefined || idx === FONT_IDX[' ']) continue;
    ctx.drawImage(atlas, idx * 6, 0, 6, 8, sx + i * 6 * sc, y, 6 * sc, 8 * sc);
  }
}

// ---------- build all sprites ----------
function buildSprites() {
  buildFont();
  // PLAYER: original twin-boom twin-engine fighter "AE-44 TWIN HAWK", faces up
  const player = fromRows(sym([
    '....k.....k',
    '...kyk...ka',
    '...kak...ka',
    '...kak..kag',
    '...kbk..kag',
    'kkkkbkkkkbg',
    'krraaaaaaab',
    'kbbbbabbbbb',
    'kkcccbccccc',
    '.kkkkbkkkkc',
    '...kbk..kbc',
    '...kbk...kb',
    '...kbk....k',
    '...kbk.....',
    '..kkbkk....',
    'kkkcbckkkkk',
    'kaaabaaaaaa',
    'kkkkkkkkkkk',
  ]), { k: '#141824', a: '#e4ecf2', b: '#9fb4c8', c: '#5d7690', y: '#ffd23c', g: '#4fe0ff', r: '#e8403c' });
  SPR.player = bundle(player);
  SPR.playerIcon = fromRows(sym([
    '..k..k', '.kak.k', 'kkakkk', 'kaaaaa', '.kak..', 'kkakkk',
  ]), { k: '#141824', a: '#e4ecf2' });
  SPR.bombIcon = fromRows([
    '.kkk.', 'kyyyk', 'kyrrk', 'kyyyk', '.kkk.', '.k.k.',
  ], { k: '#141824', y: '#7cf07c', r: '#2a7a2a' });

  // ENEMY FIGHTER (faces down), green + red leader variant
  const fRows = sym([
    '..kkkkk', '..kbbba', '...kkkb', '.....kb', 'kkkkkkb', 'kaaaaaa',
    'kbrbbbb', '.kkkkkb', '.....kg', '.....kb', '.....ky', '....ppp',
  ]);
  const fGreen = fromRows(fRows, { k: '#1a1410', a: '#8fbf62', b: '#5b8a3c', r: '#f0c020', g: '#9ff0ff', y: '#e8e0c0', p: '#b8b8b8' });
  const fRed = fromRows(fRows, { k: '#1a1410', a: '#ff8a6a', b: '#c83c2c', r: '#ffe040', g: '#9ff0ff', y: '#e8e0c0', p: '#b8b8b8' });
  SPR.fighter = rotations(fGreen, 16).map(bundle);
  SPR.fighterRed = rotations(fRed, 16).map(bundle);

  // PLAYER SHOTS
  SPR.shot = fromRows(['.w.', 'wyw', 'yyy', 'yoy', 'yoy', '.o.', '.o.'], { w: '#ffffff', y: '#ffe860', o: '#ff9a20' });
  SPR.shot2 = fromRows(['ww', 'yy', 'oo', 'oo'], { w: '#ffffff', y: '#ffb060', o: '#ff6020' });

  // ENEMY BULLETS (bright round, dark outline)
  const ball = (r, c1, c2) => {
    const s = Math.ceil(r) * 2 + 3, m = (s - 1) / 2;
    const [c, g] = mk(s, s);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const d = Math.hypot(x - m, y - m);
      if (d <= r * 0.5) g.fillStyle = '#ffffff';
      else if (d <= r * 0.8) g.fillStyle = c2;
      else if (d <= r + 0.2) g.fillStyle = c1;
      else if (d <= r + 1.2) g.fillStyle = '#200818';
      else continue;
      g.fillRect(x, y, 1, 1);
    }
    return c;
  };
  SPR.bullets = [
    { img: ball(2.5, '#ff3a8a', '#ff9ad0'), r: 2 },   // 0 pink small
    { img: ball(3.5, '#ff7a10', '#ffd060'), r: 3 },   // 1 orange medium
    { img: ball(2.5, '#2a8aff', '#9ad8ff'), r: 2 },   // 2 blue small
    { img: ball(5, '#b03aff', '#e0a0ff'), r: 4 },     // 3 purple large
  ];

  // EXPLOSION frames (8 x 32px)
  SPR.expl = [];
  for (let f = 0; f < 8; f++) {
    const p = f / 7, [c, g] = mk(32, 32), rad = 4 + 11.5 * Math.sqrt(p);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const d = Math.hypot(x - 15.5, y - 15.5) / rad;
      if (d > 1) continue;
      const n = hash(x, y, f * 31 + 5);
      if (p > 0.45 && n < (p - 0.45) * 1.6 + (d > 0.8 ? 0.3 : 0)) continue;
      let col;
      const k = d * 0.6 + p * 0.8 + n * 0.25;
      if (k < 0.45) col = '#ffffff'; else if (k < 0.7) col = '#fff07a'; else if (k < 0.95) col = '#ffb030';
      else if (k < 1.2) col = '#f05a20'; else if (k < 1.4) col = '#a02a18'; else col = '#4a3a3a';
      g.fillStyle = col; g.fillRect(x, y, 1, 1);
    }
    SPR.expl.push(c);
  }
  // particle dots atlas (8 colors x 2 sizes)
  SPR.dotColors = ['#ffffff', '#fff07a', '#ffb030', '#f05a20', '#8a8a8a', '#5a4a3a', '#9ad8ff', '#7cf07c'];
  {
    const [c, g] = mk(8 * 3, 6);
    SPR.dotColors.forEach((col, i) => { g.fillStyle = col; g.fillRect(i * 3, 0, 1, 1); g.fillRect(i * 3, 2, 2, 2); });
    SPR.dots = c;
  }
  // title logo: big bitmap letters with gradient bands + outline
  const logo = (str, sc, bands, outline) => {
    const [c, g] = mk(str.length * 6 * sc, 7 * sc);
    [...str].forEach((ch, i) => FONT[ch].forEach((row, y) => {
      for (let x = 0; x < 5; x++) if ((row >> (4 - x)) & 1) {
        for (let yy = 0; yy < sc; yy++) { g.fillStyle = bands[Math.floor((y * sc + yy) / (7 * sc) * bands.length)]; g.fillRect((i * 6 + x) * sc, y * sc + yy, sc, 1); }
      }
    }));
    const o1 = crisp(c, outline);
    const [d, dg] = mk(o1.width + 3, o1.height + 3);
    dg.drawImage(silhouette(o1, '#000000', 0.6), 3, 3); dg.drawImage(o1, 0, 0);
    return d;
  };
  SPR.logo1 = logo('SKY ACE', 5, ['#fff8c0', '#ffe060', '#ffc030', '#ff9a20', '#f06a10', '#c84010'], '#2a0a00');
  SPR.logo2 = logo('1944', 4, ['#ffffff', '#c8e8ff', '#80c0ff', '#4a8ae0', '#2a5ab8'], '#081030');
  buildClouds();
  // ---------- step 2 sprites ----------
  SPR.bomber = bundle(paint(46, 34, (g) => {
    g.fillStyle = '#5e6c42';
    g.beginPath(); g.moveTo(23, 11); g.lineTo(45, 14); g.lineTo(44, 19); g.lineTo(23, 21); g.lineTo(2, 19); g.lineTo(1, 14); g.closePath(); g.fill();
    g.fillStyle = '#86965e'; g.fillRect(3, 14, 40, 2);
    g.fillStyle = '#5e6c42'; g.fillRect(13, 1, 20, 4); g.fillStyle = '#86965e'; g.fillRect(13, 1, 20, 1);
    g.fillStyle = '#4e5a36'; g.beginPath(); g.ellipse(23, 17, 4, 16, 0, 0, TAU); g.fill();
    g.fillStyle = '#9aaa70'; g.fillRect(22, 4, 1, 22);
    for (const ex of [12, 34]) { g.fillStyle = '#3e4a2c'; g.fillRect(ex - 3, 9, 6, 15); g.fillStyle = '#7a8a56'; g.fillRect(ex - 2, 9, 1, 14); g.fillStyle = '#26261e'; g.fillRect(ex - 2, 24, 4, 2); }
    g.fillStyle = '#9ff0ff'; g.fillRect(21, 27, 4, 3);
    g.fillStyle = '#ff9a2a'; for (const ex of [5, 41]) g.fillRect(ex - 1, 15, 3, 3);
  }));
  SPR.tankBody = bundle(paint(13, 15, (g) => {
    g.fillStyle = '#2e2e26'; g.fillRect(0, 0, 3, 15); g.fillRect(10, 0, 3, 15);
    g.fillStyle = '#5a5a4a'; for (let y = 1; y < 15; y += 3) { g.fillRect(0, y, 3, 1); g.fillRect(10, y, 3, 1); }
    g.fillStyle = '#7a7444'; g.fillRect(2, 1, 9, 13);
    g.fillStyle = '#9a9460'; g.fillRect(3, 2, 7, 1);
    g.fillStyle = '#5a5634'; g.fillRect(3, 12, 7, 1);
  }));
  const disc = (r, c1, c2) => paint(r * 2 + 1, r * 2 + 1, (g) => {
    g.fillStyle = c1; g.beginPath(); g.arc(r + 0.5, r + 0.5, r, 0, TAU); g.fill();
    g.fillStyle = c2; g.beginPath(); g.arc(r - r * 0.2 + 0.5, r - r * 0.25 + 0.5, r * 0.5, 0, TAU); g.fill();
  });
  SPR.tankTur = bundle(disc(3, '#8a8450', '#b0aa76'));
  SPR.gunTur = bundle(disc(4, '#767c84', '#a8b0b8'));
  SPR.turS = bundle(disc(5, '#646c7a', '#9aa2ae'));
  SPR.turB = bundle(disc(8, '#58606e', '#8e96a2'));
  SPR.turE = bundle(disc(6, '#33373e', '#6a7078'));
  SPR.emplace = paint(19, 19, (g) => {
    g.fillStyle = '#7c7a70'; g.beginPath();
    for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * TAU; g.lineTo(9.5 + Math.cos(a) * 9.5, 9.5 + Math.sin(a) * 9.5); }
    g.fill(); g.fillStyle = '#5a584f'; g.beginPath(); g.arc(9.5, 9.5, 6, 0, TAU); g.fill();
    g.fillStyle = '#a4a296'; g.fillRect(4, 2, 11, 1);
  }, '#1a1a14');
  const barrel = (len, th) => {
    const [c, g] = mk(len, th);
    g.fillStyle = '#15171c'; g.fillRect(0, 0, len, th);
    g.fillStyle = '#8a909a'; g.fillRect(0, th > 2 ? 1 : 0, len - 1, th > 4 ? 2 : 1);
    if (th >= 6) { g.fillStyle = '#15171c'; g.fillRect(0, 3, len, 0); g.fillStyle = '#6a707a'; g.fillRect(0, 4, len - 1, 1); }
    return c;
  };
  SPR.barS = barrel(7, 2); SPR.barB = barrel(11, 4); SPR.barH = barrel(24, 6);
  SPR.ship = bundle(paint(20, 62, (g) => {
    g.fillStyle = '#5c6470';
    g.beginPath(); g.moveTo(10, 0); g.quadraticCurveTo(20, 10, 19, 22); g.lineTo(19, 52); g.quadraticCurveTo(19, 61, 10, 61); g.quadraticCurveTo(1, 61, 1, 52); g.lineTo(1, 22); g.quadraticCurveTo(0, 10, 10, 0); g.fill();
    g.fillStyle = '#8a929e'; g.fillRect(4, 10, 12, 46);
    g.fillStyle = '#4a525c'; g.fillRect(6, 20, 8, 9); g.fillStyle = '#9ff0ff'; g.fillRect(7, 20, 6, 1);
    g.fillStyle = '#2c3038'; g.fillRect(7, 31, 6, 7); g.fillStyle = '#101216'; g.fillRect(8, 32, 4, 2);
    g.fillStyle = '#4a525c'; g.fillRect(6, 40, 8, 5);
  }));
  const box = (ch, bg, hl) => {
    const [c, g] = mk(13, 11);
    g.fillStyle = '#14161c'; g.fillRect(1, 0, 11, 11); g.fillRect(0, 1, 13, 9);
    g.fillStyle = bg; g.fillRect(1, 1, 11, 9); g.fillStyle = hl; g.fillRect(1, 1, 11, 1);
    g.fillStyle = '#ffffff';
    FONT[ch].forEach((row, y) => { for (let x = 0; x < 5; x++) if ((row >> (4 - x)) & 1) g.fillRect(4 + x, 2 + y, 1, 1); });
    return c;
  };
  SPR.itemP = [box('P', '#e83c2c', '#ff9a7a'), box('P', '#f08a20', '#ffe070')];
  SPR.itemB = [box('B', '#2a9a3a', '#8cf08c'), box('B', '#1a7a8a', '#8ce8f0')];
  SPR.medal = [5, 3.6, 1.5, 3.6].map((rx, i) => paint(11, 12, (g) => {
    g.fillStyle = i === 2 ? '#a06a10' : '#f0b820'; g.beginPath(); g.ellipse(5.5, 6, rx, 5.5, 0, 0, TAU); g.fill();
    if (i !== 2) { g.fillStyle = '#fff2a0'; g.beginPath(); g.ellipse(5.5 - rx * 0.3, 4.5, rx * 0.45, 2, 0, 0, TAU); g.fill(); g.fillStyle = '#c08010'; g.fillRect(5, 6, 1, 3); }
  }, '#3a2400'));
  SPR.wreck = paint(12, 12, (g) => {
    g.fillStyle = '#2a2622'; g.beginPath(); g.arc(6, 6, 5.5, 0, TAU); g.fill();
    g.fillStyle = '#4a3e34'; g.fillRect(3, 4, 3, 2); g.fillRect(7, 7, 2, 2);
    g.fillStyle = '#d06020'; g.fillRect(5, 6, 1, 1);
  }, '#0a0a0a');
  // ---------- bosses ----------
  SPR.boss = [
    bundle(paint(60, 172, (g) => {        // BATTLESHIP "LEVIATHAN"
      const hull = (n) => {
        g.beginPath(); g.moveTo(30, n * 1.6); g.quadraticCurveTo(58 - n, 28, 57 - n, 62); g.lineTo(57 - n, 140);
        g.quadraticCurveTo(56 - n, 166 - n, 30, 170 - n); g.quadraticCurveTo(4 + n, 166 - n, 3 + n, 140); g.lineTo(3 + n, 62);
        g.quadraticCurveTo(2 + n, 28, 30, n * 1.6); g.closePath();
      };
      g.fillStyle = '#48505c'; hull(0); g.fill();
      g.fillStyle = '#7c8490'; hull(3); g.fill();
      g.save(); hull(3); g.clip();
      g.fillStyle = '#6c7480'; for (let y = 4; y < 170; y += 5) g.fillRect(0, y, 60, 1);
      g.fillStyle = '#9aa2ae'; g.fillRect(6, 0, 2, 172); g.restore();
      g.fillStyle = '#3e4652'; g.fillRect(19, 66, 22, 30); g.fillStyle = '#5c6470'; g.fillRect(21, 68, 18, 26); g.fillStyle = '#7a828e'; g.fillRect(21, 68, 18, 2);
      g.fillStyle = '#2e323a'; g.beginPath(); g.ellipse(30, 106, 7, 9, 0, 0, TAU); g.fill();
      g.fillStyle = '#121418'; g.beginPath(); g.ellipse(30, 106, 4, 6, 0, 0, TAU); g.fill();
      const ring = (x, y, r) => { g.fillStyle = '#3a424c'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); };
      ring(30, 33, 11); ring(30, 143, 11); ring(14, 57, 7); ring(46, 57, 7); ring(14, 119, 7); ring(46, 119, 7);
      g.fillStyle = '#c8b890'; for (const y of [74, 84]) { g.fillRect(10, y, 3, 7); g.fillRect(47, y, 3, 7); }
      g.fillStyle = '#d04030'; g.fillRect(28, 162, 4, 3);
    })),
    bundle(paint(150, 74, (g) => {        // GIANT BOMBER "HEAVEN'S ANVIL"
      g.fillStyle = '#4c5640'; g.beginPath(); g.moveTo(75, 22); g.lineTo(148, 33); g.lineTo(147, 41); g.lineTo(75, 52); g.lineTo(3, 41); g.lineTo(2, 33); g.closePath(); g.fill();
      g.fillStyle = '#6c785a'; g.beginPath(); g.moveTo(75, 24); g.lineTo(146, 34); g.lineTo(146, 36); g.lineTo(75, 29); g.lineTo(4, 36); g.lineTo(4, 34); g.closePath(); g.fill();
      g.fillStyle = '#3a4430'; for (const x of [14, 36, 58, 92, 114, 136]) g.fillRect(x, 33, 1, 8);
      g.fillStyle = '#4c5640'; g.fillRect(50, 2, 50, 8); g.fillStyle = '#6c785a'; g.fillRect(50, 2, 50, 2);
      g.fillStyle = '#3a4430'; g.fillRect(74, 0, 2, 16);
      g.fillStyle = '#404a36'; g.beginPath(); g.ellipse(75, 36, 9, 35, 0, 0, TAU); g.fill();
      g.fillStyle = '#76825e'; g.fillRect(72, 6, 2, 54);
      for (const ex of [25, 47, 103, 125]) { g.fillStyle = '#353d2c'; g.fillRect(ex - 5, 26, 10, 24); g.fillStyle = '#6c785a'; g.fillRect(ex - 4, 26, 2, 22); }
      g.fillStyle = '#ff9a2a'; for (const x of [9, 141]) { g.beginPath(); g.moveTo(x, 33); g.lineTo(x + 4, 37); g.lineTo(x, 41); g.lineTo(x - 4, 37); g.fill(); }
      g.fillStyle = '#ffd040'; for (let i = 0; i < 3; i++) { g.fillRect(56 + i * 4, 8, 2, 2); g.fillRect(88 + i * 4, 8, 2, 2); }
    })),
    bundle(paint(44, 200, (g) => {        // RAIL CANNON "GOLIATH"
      const car = (x, y, w, h, c, hl) => { g.fillStyle = c; g.fillRect(x, y, w, h); g.fillStyle = hl; g.fillRect(x, y, w, 2); g.fillRect(x, y, 2, h); };
      g.fillStyle = '#1c1c1c'; for (let y = 4; y < 196; y += 12) { g.fillRect(0, y, 2, 6); g.fillRect(42, y, 2, 6); }
      car(3, 0, 38, 44, '#4e5638', '#6e7a50');
      g.fillStyle = '#a89870'; g.beginPath(); g.arc(12, 22, 8, 0, TAU); g.arc(32, 22, 8, 0, TAU); g.fill();
      g.fillStyle = '#4e5638'; g.beginPath(); g.arc(12, 22, 5, 0, TAU); g.arc(32, 22, 5, 0, TAU); g.fill();
      car(1, 48, 42, 82, '#5a5040', '#7a6e58');
      g.fillStyle = '#3a342a'; g.beginPath(); g.arc(22, 84, 15, 0, TAU); g.fill();
      g.fillStyle = '#ffd040'; for (let y = 52; y < 126; y += 8) { g.fillRect(3, y, 3, 3); g.fillRect(38, y, 3, 3); }
      g.fillStyle = '#3a342a'; g.beginPath(); g.arc(6, 110, 5, 0, TAU); g.arc(38, 110, 5, 0, TAU); g.fill();
      car(5, 134, 34, 66, '#3a3a40', '#5a5a64');
      g.fillStyle = '#50505a'; g.fillRect(10, 138, 24, 42); g.fillStyle = '#7a7a86'; g.fillRect(12, 138, 4, 42);
      g.fillStyle = '#2a2a30'; for (let y = 144; y < 180; y += 8) g.fillRect(10, y, 24, 1);
      g.fillStyle = '#0a0a0a'; g.beginPath(); g.arc(22, 142, 4, 0, TAU); g.fill();
      g.fillStyle = '#6a3a2a'; g.fillRect(8, 182, 28, 16); g.fillStyle = '#8a5a3a'; g.fillRect(8, 182, 28, 2);
      g.fillStyle = '#222222'; g.fillRect(20, 44, 4, 4); g.fillRect(20, 130, 4, 4);
    })),
  ];
  SPR.core = {
    C: bundle(paint(14, 18, (g) => {
      g.fillStyle = '#4a525e'; g.fillRect(0, 2, 14, 16); g.fillStyle = '#6a727e'; g.fillRect(2, 0, 10, 12);
      g.fillStyle = '#9ff0ff'; g.fillRect(3, 3, 8, 1); g.fillStyle = '#8a929e'; g.fillRect(2, 0, 10, 1);
      g.fillStyle = '#ff5030'; g.fillRect(6, 7, 2, 2);
    })),
    C2: bundle(paint(12, 10, (g) => {
      g.fillStyle = '#3aa8d8'; g.beginPath(); g.ellipse(6, 5, 6, 5, 0, 0, TAU); g.fill();
      g.fillStyle = '#c8f8ff'; g.fillRect(3, 2, 3, 2);
    })),
    C3: bundle(paint(16, 16, (g) => {
      g.fillStyle = '#7a4a30'; g.fillRect(0, 0, 16, 16); g.fillStyle = '#9a6a48'; g.fillRect(0, 0, 16, 2);
      g.fillStyle = '#3a2418'; for (const [x, y] of [[2, 4], [12, 4], [2, 12], [12, 12]]) g.fillRect(x, y, 2, 2);
      g.fillStyle = '#ff6020'; g.fillRect(6, 6, 4, 4); g.fillStyle = '#ffd040'; g.fillRect(7, 7, 2, 2);
    })),
  };
}

// =====================================================================
// 2. OBJECT POOLS (dense array + swap-remove, zero allocation per frame)
// =====================================================================
class Pool {
  constructor(n, make) { this.a = []; for (let i = 0; i < n; i++) this.a.push(make()); this.n = 0; }
  get() { return this.n < this.a.length ? this.a[this.n++] : null; }
  kill(i) { const a = this.a, t = a[i]; a[i] = a[--this.n]; a[this.n] = t; }
  clear() { this.n = 0; }
}
const pshots = new Pool(200, () => ({ x: 0, y: 0, vx: 0, vy: 0, dmg: 1, spr: 0, alive: false }));
const ebullets = new Pool(520, () => ({ x: 0, y: 0, vx: 0, vy: 0, type: 0, r: 2, alive: false, ax: 0, ay: 0 }));
const enemies = new Pool(96, () => ({}));
const explos = new Pool(160, () => ({ x: 0, y: 0, t: 0, dur: 0.5, sc: 1, delay: 0, vy: 0 }));
const parts = new Pool(400, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, c: 0, big: 0, g: 0 }));
const items = new Pool(40, () => ({}));
const popups = new Pool(24, () => ({ x: 0, y: 0, t: 0, s: '', col: 'w' }));

// =====================================================================
// 3. GAME STATE
// =====================================================================
const G = {
  state: 'boot', stateT: 0, paused: false,
  stage: 0, loop: 0, score: 0, hi: 0, lives: 3, bombs: 3,
  stageT: 0, scriptI: 0, camY: 0, scroll: 26,
  shake: 0, flash: 0, nextExtend: 100000, medalIdx: 0,
  boss: null, bossState: 0, bombT: 0, credits: 0,
};
const P = { x: 120, y: 280, alive: true, inv: 0, level: 1, fireT: 0, respawnT: 0, prop: 0, enterT: 0, hitR: 2 };
try { G.hi = parseInt(localStorage.getItem('skyace1944_hi') || '0', 10) || 0; } catch (e) { G.hi = 0; }
function saveHi() { try { localStorage.setItem('skyace1944_hi', String(G.hi)); } catch (e) { /* ignore */ } }
// Difficulty ramps up *within* each stage: easy start -> harder before the boss.
// stage 1: 0.55 -> 0.90, stage 2: 0.78 -> 1.13, stage 3: 1.00 -> 1.35, loop 2+: +0.35
function diff() {
  const prog = G.bossState ? 1 : clamp(G.stageT / 70, 0, 1);
  return 0.55 + G.stage * 0.225 + 0.35 * prog + G.loop * 0.35;
}
const firstRun = () => G.stage === 0 && G.loop === 0;
const grace = () => firstRun() && G.stageT < 20;      // stage 1 opening: fighters hold fire

// =====================================================================
// 3b. AUDIO — Web Audio synth SFX + step-sequenced chiptune BGM
// =====================================================================
const SFX = (() => {
  let ac = null, master, sfxG, musG, noiseBuf, unlocked = false;
  let song = null, songName = null, step = 0, nextT = 0;
  const last = {};
  const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
  const midi = (n) => { const m = /^([A-G][#b]?)(\d)$/.exec(n); return m ? 12 * (+m[2] + 1) + NOTE[m[1]] : null; };
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // ---- songs (original compositions) ----
  const S = (str) => str.trim().split(/\s+/);
  const bassFrom = (roots, pat) => roots.flatMap((r) => pat.map((o) => (o === null ? '.' : 'M' + (midi(r) + o))));
  const STAGE_LEAD = S(`
    A4 - - C5 - - E5 - D5 - C5 - D5 - E5 -   F5 - - E5 - - C5 - A4 - - - C5 - D5 -
    E5 - - G5 - - E5 - D5 - C5 - D5 - E5 -   D5 - - - B4 - G4 - B4 - D5 - G5 - - -
    A5 - - G5 - - E5 - - - C5 - E5 - A5 -    G5 - F5 - E5 - F5 - - - C5 - A4 - C5 -
    D5 - - E5 - - G5 - - - F5 - E5 - D5 -    E5 - - - G#4 - B4 - E5 - - - . . . .`);
  const OCT = [0, null, 12, null, 0, null, 12, null, 0, null, 12, null, 0, null, 12, null];
  const STAGE_BASS = bassFrom(['A2', 'F2', 'C3', 'G2', 'A2', 'F2', 'G2', 'E2'], OCT);
  const BOSS_LEAD = S(`
    D5 . . D5 . . F5 . E5 . D5 . C#5 . D5 .   A5 . . A5 . . G5 . F5 . E5 . F5 . G5 .
    F5 - - D5 - - Bb4 - - - D5 - F5 - Bb5 -   A5 - - - - - E5 - C#5 - - - A4 - - -`);
  const BOSS_BASS = bassFrom(['D2', 'D2', 'Bb1', 'A1'], [0, 0, 12, 0, 0, 12, 0, 12, 0, 0, 12, 0, 1, 12, 0, 12]);
  const SONGS = {
    title: { bpm: 112, lead: STAGE_LEAD, bass: STAGE_BASS, drum: 'k.......s.......', wave: 'triangle', tr: 0 },
    stage: { bpm: 144, lead: STAGE_LEAD, bass: STAGE_BASS, drum: 'k.h.s.h.k.h.s.hh', wave: 'square', tr: 0 },
    boss: { bpm: 168, lead: BOSS_LEAD, bass: BOSS_BASS, drum: 'k.hkshh.k.hks.ss', wave: 'sawtooth', tr: 0 },
    clear: { bpm: 150, once: true, lead: S('C5 - E5 - G5 - C6 - - - G5 - C6 - - - - - - - . . . .'), bass: S('M48 - - - M43 - - - M48 - - - M36 - - - - - - - . . . .'), drum: 'k...k...k.k.s...s.......', wave: 'square', tr: 0 },
    over: { bpm: 96, once: true, lead: S('E5 - D5 - C5 - A4 - - - G#4 - - - A4 - - - - - - -'), bass: S('M45 - - - M41 - - - M40 - - - M33 - - - - - - - . .'), drum: '', wave: 'triangle', tr: 0 },
  };
  const STAGE_TR = [0, 2, -2], STAGE_BPM = [144, 150, 156];

  function init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ac = new AC();
    master = ac.createGain(); master.gain.value = 0.55; master.connect(ac.destination);
    sfxG = ac.createGain(); sfxG.gain.value = 0.8; sfxG.connect(master);
    musG = ac.createGain(); musG.gain.value = 0.32; musG.connect(master);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }
  function ok() { return ac && ac.state === 'running'; }
  function throttle(k, s) { const t = ac.currentTime; if (last[k] && t - last[k] < s) return false; last[k] = t; return true; }
  function tone(type, f0, f1, dur, vol, t, dest) {
    t = t || ac.currentTime;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || sfxG); o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(dur, vol, ftype, f0, f1, t, dest) {
    t = t || ac.currentTime;
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; s.loop = true;
    f.type = ftype; f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || sfxG); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.03);
  }
  // ---- sequencer ----
  function tick() {
    if (!ok() || !song) return;
    const sp = 60 / song.bpm / 4, n = song.lead.length;
    if (nextT < ac.currentTime - 0.1) nextT = ac.currentTime + 0.03;
    while (nextT < ac.currentTime + 0.12) {
      if (step >= n) { if (song.once) { song = null; return; } step = 0; }
      const t = nextT;
      const play = (arr, wave, vol, oct) => {
        const tok = arr[step % arr.length];
        if (!tok || tok === '.' || tok === '-') return;
        let len = 1; while (arr[(step + len) % arr.length] === '-' && len < 16) len++;
        const m = tok[0] === 'M' ? +tok.slice(1) : midi(tok);
        if (m !== null) tone(wave, hz(m + song.tr + oct), 0, Math.max(0.06, len * sp * 0.95), vol, t, musG);
      };
      play(song.lead, song.wave, song.wave === 'square' ? 0.16 : song.wave === 'sawtooth' ? 0.13 : 0.3, 0);
      play(song.bass, 'triangle', 0.42, 0);
      const dr = song.drum && song.drum[step % song.drum.length];
      if (dr === 'k') tone('sine', 150, 40, 0.14, 0.7, t, musG);
      else if (dr === 's') noise(0.12, 0.35, 'bandpass', 1800, 900, t, musG);
      else if (dr === 'h') noise(0.035, 0.18, 'highpass', 7000, 0, t, musG);
      step++; nextT += sp;
    }
  }
  function music(name) {
    songName = name;
    if (!name) { song = null; return; }
    const base = SONGS[name];
    song = Object.assign({}, base);
    if (name === 'stage') { song.tr = STAGE_TR[G.stage % 3]; song.bpm = STAGE_BPM[G.stage % 3] + G.loop * 8; }
    step = 0; nextT = ac ? ac.currentTime + 0.05 : 0;
  }
  const api = {
    unlock() {
      if (!ac && !init()) return;
      if (ac.state === 'suspended' && !G.paused) ac.resume();
      if (!unlocked) {        // iOS: play a silent buffer inside the gesture
        const b = ac.createBuffer(1, 1, 22050), s = ac.createBufferSource(); s.buffer = b; s.connect(ac.destination); s.start(0);
        unlocked = true;
        if (songName) music(songName);
      }
    },
    tick, music,
    suspend() { if (ac && ac.state === 'running') ac.suspend(); },
    resume() { if (ac && ac.state === 'suspended') ac.resume(); },
    shot() { if (ok() && throttle('shot', 0.07)) { tone('square', 1300, 500, 0.045, 0.05); } },
    eshot() { if (ok() && throttle('eshot', 0.09)) tone('square', 520, 300, 0.06, 0.05); },
    boomS() { if (ok() && throttle('boomS', 0.04)) { noise(0.25, 0.4, 'lowpass', 2200, 300); } },
    boomM() { if (ok() && throttle('boomM', 0.05)) { noise(0.5, 0.6, 'lowpass', 1500, 120); tone('sine', 120, 40, 0.3, 0.5); } },
    boomL() { if (ok()) { noise(1.6, 0.9, 'lowpass', 1200, 60); tone('sine', 90, 25, 1.0, 0.8); } },
    die() { if (ok()) { noise(1.0, 0.8, 'lowpass', 3000, 100); tone('sawtooth', 600, 60, 0.8, 0.25); } },
    bomb() { if (ok()) { noise(2.0, 1.0, 'lowpass', 900, 50); tone('sine', 70, 30, 1.6, 0.9); tone('sawtooth', 200, 40, 1.2, 0.2); } },
    power() { if (ok()) { const t = ac.currentTime; [0, 4, 7, 12, 16].forEach((s, i) => tone('square', hz(72 + s), 0, 0.08, 0.12, t + i * 0.055)); } },
    medal() { if (ok() && throttle('medal', 0.05)) { const t = ac.currentTime; tone('square', 1760, 0, 0.06, 0.1, t); tone('square', 2637, 0, 0.12, 0.1, t + 0.05); } },
    extend() { if (ok()) { const t = ac.currentTime; [0, 7, 12, 7, 12, 19].forEach((s, i) => tone('square', hz(76 + s), 0, 0.1, 0.13, t + i * 0.08)); } },
    warn() { if (ok()) { const t = ac.currentTime; for (let i = 0; i < 4; i++) { tone('sawtooth', 440, 880, 0.35, 0.18, t + i * 0.7); tone('sawtooth', 880, 440, 0.3, 0.18, t + i * 0.7 + 0.35); } } },
    coin() { if (ok()) { const t = ac.currentTime; tone('square', 988, 0, 0.07, 0.15, t); tone('square', 1319, 0, 0.3, 0.15, t + 0.07); } },
    beep() { if (ok()) tone('square', 660, 0, 0.1, 0.12); },
    over() { music('over'); },
  };
  return api;
})();
function unlockAudio() { SFX.unlock(); }

// =====================================================================
// 4. INPUT — relative drag (anywhere), keyboard for desktop
// =====================================================================
const input = { dx: 0, dy: 0, dragId: null, lx: 0, ly: 0, keys: {}, tap: false, bomb: false };
function isButton(t) { return t && t.closest && t.closest('button'); }
window.addEventListener('pointerdown', (e) => {
  unlockAudio();
  if (isButton(e.target)) return;
  if (input.dragId === null) { input.dragId = e.pointerId; input.lx = e.clientX; input.ly = e.clientY; }
  input.tap = true;
}, { passive: true });
window.addEventListener('pointermove', (e) => {
  if (e.pointerId !== input.dragId) return;
  input.dx += e.clientX - input.lx; input.dy += e.clientY - input.ly;
  input.lx = e.clientX; input.ly = e.clientY;
}, { passive: true });
const endDrag = (e) => { if (e.pointerId === input.dragId) input.dragId = null; };
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);
// block scrolling / zoom / long-press menus
['touchstart', 'touchmove', 'gesturestart', 'gesturechange', 'dblclick', 'contextmenu'].forEach((ev) =>
  document.addEventListener(ev, (e) => { if (ev !== 'touchstart' || !isButton(e.target)) e.preventDefault(); }, { passive: false }));
document.addEventListener('touchend', () => unlockAudio(), { passive: true });

const KEYMAP = { ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r', ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd', KeyZ: 'fire', KeyJ: 'fire', Space: 'fire' };
window.addEventListener('keydown', (e) => {
  unlockAudio();
  const k = KEYMAP[e.code];
  if (k) { input.keys[k] = true; e.preventDefault(); }
  if (e.code === 'Enter' || e.code === 'KeyZ' || e.code === 'Space' || e.code === 'KeyJ') input.tap = true;
  if ((e.code === 'KeyX' || e.code === 'KeyK') && !e.repeat) input.bomb = true;
  if ((e.code === 'KeyP' || e.code === 'Escape') && !e.repeat) togglePause();
});
window.addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) input.keys[k] = false; });

const bombBtn = $('bombBtn'), pauseBtn = $('pauseBtn');
bombBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault(); e.stopPropagation(); unlockAudio();
  input.bomb = true; bombBtn.classList.add('on');
  setTimeout(() => bombBtn.classList.remove('on'), 150);
});
pauseBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); unlockAudio(); togglePause(); });

function togglePause(force) {
  if (G.state !== 'play' && G.state !== 'warning' && G.state !== 'bossdie') return;
  G.paused = force !== undefined ? force : !G.paused;
  input.dx = input.dy = 0; input.tap = false;
  if (G.paused) SFX.suspend(); else SFX.resume();
}
// auto-pause on app switch / screen off
document.addEventListener('visibilitychange', () => { if (document.hidden) togglePause(true); });
window.addEventListener('blur', () => togglePause(true));
window.addEventListener('pagehide', () => togglePause(true));

// =====================================================================
// 5. TERRAIN / BACKGROUND (procedural, pre-rendered into 256px chunks)
// =====================================================================
const TT = { DEEP: 0, WATER: 1, SHALLOW: 2, SAND: 3, GRASS: 4, FOREST: 5, ROCK: 6, DSAND: 7, DUNE: 8, BALLAST: 9, DIRT: 10 };
const TCOL = ['#1a3c88', '#2656b8', '#3a86d0', '#e6d28a', '#4f9a3a', '#2f6e2a', '#8a7658', '#e2b872', '#c8964e', '#6e6256', '#a08060'].map(rgb);
const CHUNK = 256;
let chunks = [], mapT = 3072, STG = null;

const STAGES = [
  { name: 'PACIFIC OCEAN', sub: 'OPERATION BLUE STORM', seed: 11, T: 3072, scroll: 26,
    field(x, wy, j) {
      const v = fbm(x / 64, wy / 64, this.seed, this.T / 64) + j;
      return v < 0.4 ? TT.DEEP : v < 0.66 ? TT.WATER : v < 0.71 ? TT.SHALLOW : v < 0.735 ? TT.SAND : v < 0.79 ? TT.GRASS : TT.FOREST;
    } },
  { name: 'SOUTHERN COAST', sub: 'OPERATION IRON SHORE', seed: 23, T: 3072, scroll: 26,
    field(x, wy, j) {
      const k = (wy / this.T) * TAU;
      const cx = 130 + 55 * Math.sin(k * 2) + 25 * Math.sin(k * 5 + 1);
      const v = 0.5 + (x - cx) / 110 + (fbm(x / 64, wy / 64, this.seed, this.T / 64) - 0.5) * 0.9 + j;
      return v < 0.3 ? TT.DEEP : v < 0.48 ? TT.WATER : v < 0.54 ? TT.SHALLOW : v < 0.6 ? TT.SAND : v < 0.86 ? TT.GRASS : TT.FOREST;
    } },
  { name: 'DESERT RAILWAY', sub: 'OPERATION SANDSTORM', seed: 37, T: 3072, scroll: 26,
    field(x, wy, j) {
      if (x >= 106 && x < 134) return TT.BALLAST;
      const v = fbm(x / 64, wy / 64, this.seed, this.T / 64) + j;
      if (v < 0.24) return TT.WATER;
      if (v < 0.28) return TT.GRASS;
      if (v > 0.74) return TT.ROCK;
      const d = Math.sin((wy + x * 0.4) / 11 + v * 14);
      return d > 0.55 ? TT.DUNE : TT.DSAND;
    } },
];
const isWater = (t) => t <= TT.SHALLOW;
const isLand = (t) => t >= TT.SAND && t !== TT.BALLAST;

function buildStageMap(si) {
  STG = STAGES[si]; mapT = STG.T;
  const n = mapT / CHUNK;
  if (chunks.length !== n) { chunks = []; for (let i = 0; i < n; i++) chunks.push(mk(W, CHUNK)); }
  for (let k = 0; k < n; k++) renderChunk(k, chunks[k][1]);
}
function renderChunk(k, g) {
  const id = g.createImageData(W, CHUNK), p = id.data;
  for (let cy = 0; cy < CHUNK / 2; cy++) {
    const wy = (k + 1) * CHUNK - cy * 2;
    for (let cx = 0; cx < W / 2; cx++) {
      const j = ((cx + cy) & 1) ? 0.012 : -0.012;   // checker dither on borders
      const t = STG.field(cx * 2 + 1, wy, j);
      const col = TCOL[t];
      // subtle per-cell noise shading
      const sh = (hash(cx, cy + k * 128, 3) * 10 - 5) | 0;
      for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) {
        const i = ((cy * 2 + yy) * W + cx * 2 + xx) * 4;
        p[i] = clamp(col[0] + sh, 0, 255); p[i + 1] = clamp(col[1] + sh, 0, 255); p[i + 2] = clamp(col[2] + sh, 0, 255); p[i + 3] = 255;
      }
    }
  }
  g.putImageData(id, 0, 0);
  // detail pass (8px cells)
  for (let cy = 0; cy < CHUNK / 8; cy++) for (let cx = 0; cx < W / 8; cx++) {
    const px = cx * 8 + 4, ry = cy * 8 + 4, wy = (k + 1) * CHUNK - ry;
    const t = STG.field(px, wy, 0);
    const h = hash(cx, (k * 32 + cy), STG.seed + 99), h2 = hash(cx + 50, k * 32 + cy, 7);
    const ox = ((h2 * 6) | 0) - 3, oy = ((h * 97 % 1) * 6 | 0) - 3;
    if (t === TT.DEEP || t === TT.WATER) {
      if (h < 0.12) { g.fillStyle = t === TT.DEEP ? '#3a64b8' : '#5a8ee0'; g.fillRect(px + ox - 2, ry + oy, 4, 1); g.fillRect(px + ox - 1, ry + oy - 1, 2, 1); }
    } else if (t === TT.SHALLOW) {
      if (h < 0.2) { g.fillStyle = '#9ad0f0'; g.fillRect(px + ox, ry + oy, 3, 1); }
    } else if (t === TT.FOREST || (t === TT.GRASS && h < 0.12)) {
      const n = t === TT.FOREST ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const tx = px + ox + i * 3 - 1, ty = ry + oy + i * 2 - 1;
        g.fillStyle = '#1c4a1c'; g.fillRect(tx - 2, ty - 1, 5, 4); g.fillRect(tx - 1, ty - 2, 3, 6);
        g.fillStyle = t === TT.FOREST ? '#3f8a34' : '#5aae44'; g.fillRect(tx - 1, ty - 1, 3, 3);
        g.fillStyle = '#7ccc5a'; g.fillRect(tx - 1, ty - 1, 1, 1);
      }
    } else if (t === TT.SAND || t === TT.DSAND || t === TT.DUNE) {
      if (h < 0.05) { g.fillStyle = '#6e5a40'; g.fillRect(px + ox, ry + oy, 3, 2); g.fillStyle = '#b09670'; g.fillRect(px + ox, ry + oy, 2, 1); }
    } else if (t === TT.ROCK) {
      if (h < 0.35) { g.fillStyle = '#5a4a38'; g.fillRect(px + ox - 2, ry + oy, 5, 3); g.fillStyle = '#b0a080'; g.fillRect(px + ox - 2, ry + oy, 3, 1); }
    }
  }
  // desert: railway + towns
  if (STG === STAGES[2]) {
    for (let ry = 0; ry < CHUNK; ry++) {
      const wy = (k + 1) * CHUNK - ry;
      if (wy % 7 === 0) { g.fillStyle = '#4a3624'; g.fillRect(110, ry, 20, 2); }
    }
    g.fillStyle = '#c8ccd4'; g.fillRect(113, 0, 2, CHUNK); g.fillRect(125, 0, 2, CHUNK);
    g.fillStyle = '#5a5e68'; g.fillRect(115, 0, 1, CHUNK); g.fillRect(127, 0, 1, CHUNK);
    for (let cy = 0; cy < CHUNK / 16; cy++) for (let cx = 0; cx < W / 16; cx++) {
      const bx = cx * 16, by = cy * 16;
      if (bx > 88 && bx < 140) continue;
      const wy = (k + 1) * CHUNK - by;
      const town = vnoise(bx / 90, wy / 90, 77, mapT / 90 | 0);
      const h = hash(cx, k * 16 + cy, 55);
      if (town > 0.7 && h < 0.5) {
        const bw = 7 + ((h * 50) | 0) % 7, bh = 6 + ((h * 90) | 0) % 7;
        g.fillStyle = '#5a4430'; g.fillRect(bx + 3, by + 3, bw, bh);
        g.fillStyle = h < 0.3 ? '#d8b888' : '#c09868'; g.fillRect(bx + 1, by + 1, bw, bh);
        g.fillStyle = '#f0d8a8'; g.fillRect(bx + 1, by + 1, bw, 1);
      }
    }
  }
}
function drawBackground() {
  const cm = ((G.camY % mapT) + mapT) % mapT, n = chunks.length;
  const k0 = Math.floor(cm / CHUNK), k1 = Math.floor((cm + H) / CHUNK);
  for (let k = k0; k <= k1; k++) {
    const dy = Math.floor(H + cm - (k + 1) * CHUNK);
    ctx.drawImage(chunks[k % n][0], shx, dy + shy);
  }
}
function terrainAt(x, sy) {
  const wy = ((G.camY + H - sy) % mapT + mapT) % mapT;
  return STG.field(x, wy, 0);
}
// stamp a crater / scorch decal permanently into the terrain chunk
function stampCrater(x, sy, size) {
  const t = terrainAt(x, sy);
  if (isWater(t)) return;
  const wy = ((G.camY + H - sy) % mapT + mapT) % mapT;
  const k = Math.floor(wy / CHUNK), ry = (k + 1) * CHUNK - wy;
  const n = chunks.length;
  const draw = (g, gy) => {
    g.fillStyle = '#3a2e22'; g.beginPath(); g.ellipse(x, gy, size, size * 0.8, 0, 0, TAU); g.fill();
    g.fillStyle = '#20180f'; g.beginPath(); g.ellipse(x + 1, gy + 1, size * 0.55, size * 0.45, 0, 0, TAU); g.fill();
  };
  draw(chunks[k][1], ry);
  // spill across chunk borders (chunk k+1 is "above" k)
  if (ry < size + 1) draw(chunks[(k + 1) % n][1], ry + CHUNK);
  if (ry > CHUNK - size - 1) draw(chunks[(k - 1 + n) % n][1], ry - CHUNK);
}

// =====================================================================
// 6. SPAWNING HELPERS
// =====================================================================
function spark(x, y, n, spd, c0, c1, big) {
  for (let i = 0; i < n; i++) {
    const p = parts.get(); if (!p) return;
    const a = Math.random() * TAU, s = spd * (0.3 + Math.random());
    p.x = x; p.y = y; p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s;
    p.max = p.life = rand(0.2, 0.55); p.c = c0 + ((Math.random() * (c1 - c0 + 1)) | 0); p.big = big ? 1 : 0; p.g = 0;
  }
}
function explode(x, y, sc = 1, n = 1, spread = 0, ground = false) {
  for (let i = 0; i < n; i++) {
    const e = explos.get(); if (!e) break;
    e.x = x + (i ? rand(-spread, spread) : 0); e.y = y + (i ? rand(-spread, spread) : 0);
    e.t = 0; e.dur = rand(0.4, 0.6) * (0.8 + sc * 0.2); e.sc = sc * (i ? rand(0.6, 1) : 1); e.delay = i ? rand(0, 0.12 * n) : 0;
    e.vy = ground ? G.scroll : 0;
  }
  spark(x, y, 6 + n * 3, 70 + sc * 30, 0, 3, true);
}
function popup(x, y, s, col = 'w') {
  const p = popups.get(); if (!p) return;
  p.x = x; p.y = y; p.t = 0; p.s = String(s); p.col = col;
}
function eShot(x, y, ang, spd, type) {
  const b = ebullets.get(); if (!b) return null;
  spd *= 0.85 + diff() * 0.15;
  b.x = x; b.y = y; b.vx = Math.cos(ang) * spd; b.vy = Math.sin(ang) * spd; b.ax = 0; b.ay = 0;
  b.type = type; b.r = SPR.bullets[type].r; b.alive = true;
  return b;
}
const aimAng = (x, y) => Math.atan2(P.y - y, P.x - x);
function fan(x, y, ang, n, spread, spd, type) { for (let i = 0; i < n; i++) eShot(x, y, ang + (i - (n - 1) / 2) * spread, spd, type); }
function ring(x, y, n, spd, type, off = 0) { for (let i = 0; i < n; i++) eShot(x, y, off + (i / n) * TAU, spd, type); }
function canFire(e) { return P.alive && e.y > 4 && e.y < P.y - 36 && e.x > 4 && e.x < W - 4 && G.state === 'play'; }

function addScore(v) {
  G.score += v;
  if (G.score > G.hi) G.hi = G.score;
  while (G.score >= G.nextExtend) {
    G.nextExtend += G.nextExtend < 200000 ? 150000 : 250000;
    G.lives = Math.min(G.lives + 1, 9);
    popup(P.x, P.y - 20, '1UP', 'n'); SFX.extend();
  }
}

// =====================================================================
// 7. ENEMIES
// =====================================================================
const EDEF = {
  f:  { hp: 3, hw: 6, hh: 6, score: 200 },
  rf: { hp: 8, hw: 6, hh: 6, score: 500 },
  b:  { hp: 70, hw: 21, hh: 12, score: 3000 },
  t:  { hp: 14, hw: 6, hh: 7, score: 600, ground: 1 },
  g:  { hp: 24, hw: 8, hh: 8, score: 900, ground: 1, drop: 3 },
  s:  { hp: 90, hw: 9, hh: 28, score: 4000, ground: 1 },
};
function spawnEnemy(kind) {
  const e = enemies.get(); if (!e) return null;
  const d = EDEF[kind];
  e.kind = kind; e.alive = true; e.t = 0; e.delay = 0; e.flash = 0;
  e.x = 0; e.y = 0; e.vx = 0; e.vy = 0; e.path = 0; e.p1 = 0; e.p2 = 0; e.p3 = 0;
  e.fireT = 0; e.cd = 0; e.cd2 = 0; e.st = 0; e.ang = Math.PI / 2; e.drop = d.drop || 0;
  e.hp = Math.ceil(d.hp * (1 + G.loop * 0.3)); e.maxhp = e.hp; e.hw = d.hw; e.hh = d.hh; e.score = d.score; e.ground = !!d.ground;
  return e;
}
const EUPD = {
  f(e, dt) {
    switch (e.path) {
      case 0: if (e.t < 0.9) e.vx += clamp(P.x - e.x, -1, 1) * 70 * dt; break;              // dive w/ slight homing
      case 1: { const w = 2.2; e.x = e.p1 + Math.sin(e.t * w + e.p3) * e.p2; e.vx = Math.cos(e.t * w + e.p3) * e.p2 * w; break; } // sine
      case 2: e.vy -= 105 * dt; break;                                                       // dive & retreat
      case 3: if (e.t > e.p1) { e.vy += 150 * dt; e.vx *= 1 - 1.3 * dt; } break;              // side entry, curve down
      case 4: break;                                                                         // straight
      case 5: if (e.y > e.p1 && e.st === 0) { e.st = 1; e.p2 = e.t; }                           // stop & shoot & leave
        if (e.st === 1) { e.vy *= 1 - 4 * dt; if (e.t - e.p2 > 1.0) { e.st = 2; if (canFire(e) && !grace()) fan(e.x, e.y, aimAng(e.x, e.y), 3, 0.22, 80, 0); } }
        if (e.st === 2) e.vy += 160 * dt; break;
    }
    if (e.path !== 1) e.x += e.vx * dt;
    e.y += e.vy * dt;
    if (Math.abs(e.vx) + Math.abs(e.vy) > 5) e.ang = Math.atan2(e.vy, e.vx);
    if (e.fireT > 0) { e.fireT -= dt; if (e.fireT <= 0 && canFire(e) && !grace()) eShot(e.x, e.y, aimAng(e.x, e.y), 85, 0); }
    if (e.t > 0.8 && (e.y > H + 20 || e.y < -40 || e.x < -40 || e.x > W + 40)) e.alive = false;
  },
};
EUPD.rf = EUPD.f;
EUPD.b = (e, dt) => {                       // medium bomber: descend, hover & shoot, leave
  if (e.st === 0) { e.vy = 55; if (e.y >= e.p1) { e.st = 1; e.p3 = e.t; } }
  else if (e.st === 1) { e.vy = 3; e.vx = Math.sin(e.t * 0.9) * 14; if (e.t - e.p3 > 5) e.st = 2; }
  else { e.vy = Math.min(50, e.vy + 25 * dt); }
  e.x += e.vx * dt; e.y += e.vy * dt;
  e.cd -= dt;
  if (e.cd <= 0 && e.st > 0) {
    e.cd = 1.5 / Math.sqrt(diff());
    if (canFire(e)) {
      if (e.cd2++ % 2) fan(e.x, e.y + 12, aimAng(e.x, e.y + 12), 5, 0.2, 78, 1);
      else ring(e.x, e.y, firstRun() ? 7 : 10 + G.stage * 2, 58, 0, e.t);
      SFX.eshot();
    }
  }
  if (e.y > H + 30) e.alive = false;
};
function groundMove(e, dt) { e.y += G.scroll * dt; if (e.y > H + 40) e.alive = false; }
function turnTo(o, x, y, dt, sp) {
  const t = aimAng(x, y); let d = t - o.ang; d = Math.atan2(Math.sin(d), Math.cos(d));
  o.ang += clamp(d, -sp * dt, sp * dt);
}
EUPD.t = (e, dt) => {                       // tank: drives, turret tracks player
  groundMove(e, dt); e.x += e.vx * dt; e.y += e.vy * dt; turnTo(e, e.x, e.y, dt, 2.2);
  e.cd -= dt;
  if (e.cd <= 0) { e.cd = rand(2, 3) / diff(); if (canFire(e)) eShot(e.x + Math.cos(e.ang) * 6, e.y + Math.sin(e.ang) * 6, e.ang, 72, 2); }
};
EUPD.g = (e, dt) => {                       // gun emplacement: 3-way fan
  groundMove(e, dt); turnTo(e, e.x, e.y, dt, 1.6);
  e.cd -= dt;
  if (e.cd <= 0) { e.cd = rand(2, 2.6) / diff(); if (canFire(e)) fan(e.x, e.y, e.ang, 3, 0.25, 70, 1); }
};
EUPD.s = (e, dt) => {                       // destroyer: sails slowly, aimed + ring
  e.y += (G.scroll - 9) * dt; if (e.y > H + 60) e.alive = false;
  turnTo(e, e.x, e.y - 16, dt, 1.5);
  e.p2 = aimAng(e.x, e.y + 18);
  e.cd -= dt;
  if (e.cd <= 0) { e.cd = 1.3 / diff(); if (canFire(e)) { const fy = e.cd2++ % 2 ? 18 : -16; eShot(e.x, e.y + fy, aimAng(e.x, e.y + fy), 82, 2); } }
  e.p3 -= dt;
  if (e.p3 <= 0) { e.p3 = 3.2 / diff(); if (canFire(e)) { ring(e.x, e.y, 12, 55, 0, e.t); SFX.eshot(); } }
};

function drawEnemy(e, layerShadow) {
  const fl = e.flash > 0;
  if (e.kind === 'f' || e.kind === 'rf') {
    const b = (e.kind === 'f' ? SPR.fighter : SPR.fighterRed)[rotIndex(e.ang, Math.PI / 2, 16)];
    if (layerShadow) blit(b.s, e.x + 10, e.y + 16); else blit(fl ? b.w : b.n, e.x, e.y);
    return;
  }
  switch (e.kind) {
    case 'b':
      if (layerShadow) { blit(SPR.bomber.s, e.x + 16, e.y + 24); return; }
      blit(fl ? SPR.bomber.w : SPR.bomber.n, e.x, e.y);
      drawProps(e.x, e.y + 11, [-11, 11], 9);
      return;
    case 't':
      blit(fl ? SPR.tankBody.w : SPR.tankBody.n, e.x, e.y);
      blitRot(SPR.barS, e.x + Math.cos(e.ang) * 5, e.y - 1 + Math.sin(e.ang) * 5, e.ang);
      blit(fl ? SPR.tankTur.w : SPR.tankTur.n, e.x, e.y - 1);
      return;
    case 'g':
      blit(SPR.emplace, e.x, e.y);
      blitRot(SPR.barB, e.x + Math.cos(e.ang) * 7, e.y + Math.sin(e.ang) * 7, e.ang);
      blit(fl ? SPR.gunTur.w : SPR.gunTur.n, e.x, e.y);
      return;
    case 's':
      ctx.fillStyle = '#d8ecff';
      ctx.fillRect(R(e.x) - 2 + shx, R(e.y) + 31 + shy, 4, 5); ctx.fillRect(R(e.x) - 5 + shx, R(e.y) + 35 + shy, 2, 7); ctx.fillRect(R(e.x) + 3 + shx, R(e.y) + 35 + shy, 2, 7);
      ctx.fillRect(R(e.x) - 1 + shx, R(e.y) - 33 + shy, 2, 2);
      blit(fl ? SPR.ship.w : SPR.ship.n, e.x, e.y);
      blitRot(SPR.barS, e.x + Math.cos(e.ang) * 5, e.y - 16 + Math.sin(e.ang) * 5, e.ang);
      blit(SPR.turS.n, e.x, e.y - 16);
      blitRot(SPR.barS, e.x + Math.cos(e.p2) * 5, e.y + 18 + Math.sin(e.p2) * 5, e.p2);
      blit(SPR.turS.n, e.x, e.y + 18);
  }
}
function drawProps(x, y, offs, w) {
  const f = ((G.stateT * 30) | 0) & 1;
  ctx.fillStyle = '#d0d0d0';
  for (const o of offs) {
    const px = R(x + o) + shx, py = R(y) + shy;
    if (f) ctx.fillRect(px - (w >> 1), py, w, 1); else ctx.fillRect(px - 1, py, 3, 1);
  }
}
function blit(img, x, y) { ctx.drawImage(img, R(x - img.width / 2) + shx, R(y - img.height / 2) + shy); }
function blitRot(img, x, y, a) {
  const c = Math.cos(a), s = Math.sin(a);
  ctx.setTransform(c, s, -s, c, R(x) + shx, R(y) + shy);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function killEnemy(e) {
  e.alive = false;
  addScore(e.score);
  if (e.kind === 'f' || e.kind === 'rf') { explode(e.x, e.y, 0.8, 1); SFX.boomS(); }
  else if (e.kind === 'b') { explode(e.x, e.y, 1.6, 5, 14); G.shake = 0.25; SFX.boomM(); }
  else if (e.ground) {
    const big = e.kind === 's';
    explode(e.x, e.y, big ? 1.5 : 1.1, big ? 7 : 2, big ? 22 : 4, true);
    if (!big) stampCrater(e.x, e.y, e.kind === 'g' ? 9 : 7);
    spark(e.x, e.y, 8, 60, 4, 5, true);
    SFX.boomM(); if (big) G.shake = 0.3;
  }
  if (e.kind === 'rf' || e.drop === 1) dropItem('P', e.x, e.y);
  else if (e.drop === 2) dropItem('B', e.x, e.y);
  else if (e.drop === 3) dropItem('M', e.x, e.y);
}

// formation waves
const WAVES = {
  line(x, n, path = 0, red = 0) {
    for (let i = 0; i < n; i++) {
      const e = spawnEnemy(red && i === n - 1 ? 'rf' : 'f'); if (!e) return;
      e.x = x; e.y = -12; e.vy = path === 2 ? 150 : 88; e.delay = i * 0.28; e.path = path;
      if (Math.random() < 0.35 * diff()) e.fireT = rand(0.5, 1.4);
    }
  },
  sine(x, n, amp = 50, red = 0) {
    for (let i = 0; i < n; i++) {
      const e = spawnEnemy(red && i === n - 1 ? 'rf' : 'f'); if (!e) return;
      e.p1 = x; e.p2 = amp; e.p3 = 0; e.x = x; e.y = -12; e.vy = 70; e.delay = i * 0.3; e.path = 1;
      if (Math.random() < 0.3 * diff()) e.fireT = rand(0.8, 1.6);
    }
  },
  dive(x, n) {
    for (let i = 0; i < n; i++) {
      const e = spawnEnemy('f'); if (!e) return;
      e.x = x + (i - (n - 1) / 2) * 20; e.y = -12 - Math.abs(i - (n - 1) / 2) * 10; e.vy = 160; e.path = 2;
      if (Math.random() < 0.5 * diff()) e.fireT = rand(0.6, 1.0);
    }
  },
  side(left, n, y = 40, red = 0) {
    for (let i = 0; i < n; i++) {
      const e = spawnEnemy(red && i === n - 1 ? 'rf' : 'f'); if (!e) return;
      e.x = left ? -10 : W + 10; e.y = y; e.vx = left ? 115 : -115; e.vy = 12; e.path = 3; e.p1 = 0.7; e.delay = i * 0.25;
      if (Math.random() < 0.3 * diff()) e.fireT = rand(0.8, 1.4);
    }
  },
  vee(x, n) {
    for (let i = 0; i < n; i++) {
      const e = spawnEnemy(i === 0 ? 'rf' : 'f'); if (!e) return;
      const k = Math.ceil(i / 2), sd = i % 2 ? -1 : 1;
      e.x = x + k * 15 * sd; e.y = -12 - k * 12; e.vy = 75; e.path = 4;
      if (Math.random() < 0.3 * diff()) e.fireT = rand(0.8, 1.6);
    }
  },
  stop(x, n, y = 70) {
    for (let i = 0; i < n; i++) {
      const e = spawnEnemy('f'); if (!e) return;
      e.x = x + (i - (n - 1) / 2) * 26; e.y = -12; e.vy = 130; e.path = 5; e.p1 = y + (i % 2) * 14; e.delay = i * 0.15;
    }
  },
  bomber(x) {
    const e = spawnEnemy('b'); if (!e) return;
    e.x = x; e.y = -24; e.p1 = rand(50, 85); e.cd = 1;
    G.bomberCount = (G.bomberCount || 0) + 1;
    e.drop = G.bomberCount % 3 === 0 ? 2 : 1;
  },
  ground(kind, x, n = 1) {
    for (let i = 0; i < n; i++) {
      const tx = findSpot(kind, x + (i - (n - 1) / 2) * 34);
      if (tx === null) continue;
      const e = spawnEnemy(kind); if (!e) return;
      e.x = tx; e.y = kind === 's' ? -34 : -12; e.cd = rand(0.6, 1.6); e.p3 = 1.5; e.p2 = Math.PI / 2;
      if (kind === 't') { e.vy = rand(-6, 10); e.vx = rand(-8, 8); if (Math.random() < 0.3) e.drop = 3; }
      if (kind === 's') e.drop = Math.random() < 0.5 ? 1 : 3;
    }
  },
};
function findSpot(kind, x0) {
  const sy = kind === 's' ? -34 : -12;
  for (let k = 0; k < 16; k++) {
    const x = clamp(x0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 14, 14, W - 14);
    if (kind === 's') {
      if ([[0, -26], [0, 0], [0, 26], [-9, 0], [9, 0]].every(([dx, dy]) => isWater(terrainAt(x + dx, sy + dy)))) return x;
    } else if ([[0, 0], [0, -7], [0, 7], [-7, 0], [7, 0]].every(([dx, dy]) => isLand(terrainAt(x + dx, sy + dy)))) return x;
  }
  return null;
}

// =====================================================================
// 8. PLAYER
// =====================================================================
function resetPlayer(full) {
  P.x = W / 2; P.y = H + 20; P.alive = true; P.inv = 3; P.enterT = 0.8; P.fireT = 0;
  if (full) P.level = 1;
}
function firePlayer() {
  const L = P.level, x = P.x, y = P.y - 8;
  const ps = (ox, a, spr, dmg = 1) => {
    const s = pshots.get(); if (!s) return;
    s.x = x + ox; s.y = y; s.vx = Math.sin(a) * 470; s.vy = -Math.cos(a) * 470; s.spr = spr; s.dmg = dmg; s.alive = true;
  };
  if (L === 1) { ps(-4, 0, 0); ps(4, 0, 0); }
  else if (L === 2) { ps(-6, 0, 0); ps(0, 0, 0); ps(6, 0, 0); }
  else if (L === 3) { ps(-7, 0, 0); ps(-2, 0, 0); ps(2, 0, 0); ps(7, 0, 0); ps(-10, -0.16, 1); ps(10, 0.16, 1); }
  else { ps(-8, 0, 0); ps(-3, 0, 0); ps(3, 0, 0); ps(8, 0, 0); ps(-10, -0.12, 1); ps(10, 0.12, 1); ps(-11, -0.27, 1); ps(11, 0.27, 1); }
  SFX.shot();
}
function killPlayer() {
  if (!P.alive || P.inv > 0) return;
  P.alive = false; P.respawnT = 1.6;
  explode(P.x, P.y, 1.6, 6, 12); spark(P.x, P.y, 30, 140, 0, 3, true);
  G.shake = 0.5; SFX.die();
  G.lives--;
  const lost = P.level > 1;
  P.level = Math.max(1, P.level - 1);
  if (lost) dropItem('P', P.x, Math.min(P.y, H - 60));
}
function updatePlayer(dt) {
  P.prop += dt;
  if (!P.alive) {
    input.dx = input.dy = 0;
    P.respawnT -= dt;
    if (P.respawnT <= 0) {
      if (G.lives <= 0) { gotoState('continue'); return; }
      resetPlayer(false); if (G.bombs < 3) G.bombs = 3;
    }
    return;
  }
  if (P.inv > 0) P.inv -= dt;
  if (P.enterT > 0) {                    // fly in from bottom after respawn
    P.enterT -= dt; P.y += (H - 50 - P.y) * Math.min(1, dt * 6);
    input.dx = input.dy = 0;
  } else {
    const sens = 1.25 / view.scale;      // finger px -> game px (slightly amplified)
    P.x += input.dx * sens; P.y += input.dy * sens; input.dx = input.dy = 0;
    const k = input.keys, sp = 150 * dt;
    if (k.l) P.x -= sp; if (k.r) P.x += sp; if (k.u) P.y -= sp; if (k.d) P.y += sp;
    P.x = clamp(P.x, 10, W - 10); P.y = clamp(P.y, 16, H - 12);
  }
  P.fireT -= dt;
  if (P.fireT <= 0 && G.state === 'play') { P.fireT += 0.075; if (P.fireT < 0) P.fireT = 0; firePlayer(); }
}
function drawPlayer(shadow) {
  if (!P.alive) return;
  if (P.inv > 0 && ((P.inv * 20) | 0) % 2 === 0 && !shadow) return;
  if (shadow) { blit(SPR.player.s, P.x + 12, P.y + 18); return; }
  blit(SPR.player.n, P.x, P.y);
  // spinning props
  const f = ((P.prop * 30) | 0) & 1;
  ctx.fillStyle = '#d8d8d8';
  const py = R(P.y - 9) + shy;
  for (const ox of [-6, 6]) {
    const px = R(P.x + ox) + shx;
    if (f) ctx.fillRect(px - 3, py, 7, 1); else { ctx.fillRect(px - 1, py, 3, 1); }
  }
  // muzzle flash
  if (G.state === 'play' && ((P.prop * 26) | 0) & 1) {
    ctx.fillStyle = '#fff8b0'; ctx.fillRect(R(P.x) - 1 + shx, R(P.y) - 12 + shy, 3, 2);
  }
}

// =====================================================================
// 8b. ITEMS  (P = shot power, B = bomb, M = score medal)
// =====================================================================
const MEDAL_V = [500, 1000, 2000, 3000, 5000, 8000, 10000];
function dropItem(type, x, y) {
  const it = items.get(); if (!it) return;
  it.type = type; it.x = clamp(x, 10, W - 10); it.y = Math.max(y, 10); it.t = 0; it.alive = true;
  if (type === 'M') { it.vx = rand(-10, 10); it.vy = -55; }
  else { const a = rand(-2.5, -0.65); it.vx = Math.cos(a) * 42; it.vy = Math.sin(a) * 42; }
}
function collect(it) {
  if (it.type === 'P') {
    if (P.level < 4) { P.level++; popup(it.x, it.y - 8, P.level === 4 ? 'MAX POWER' : 'POWER UP', 'y'); SFX.power(); }
    else { addScore(5000); popup(it.x, it.y - 8, '5000', 'y'); SFX.medal(); }
  } else if (it.type === 'B') {
    if (G.bombs < 6) { G.bombs++; popup(it.x, it.y - 8, 'BOMB', 'n'); SFX.power(); }
    else { addScore(5000); popup(it.x, it.y - 8, '5000', 'n'); SFX.medal(); }
  } else {
    const v = MEDAL_V[G.medalIdx]; G.medalIdx = Math.min(G.medalIdx + 1, MEDAL_V.length - 1);
    addScore(v); popup(it.x, it.y - 8, v, 'c'); SFX.medal();
  }
}
function updateItems(dt) {
  for (let i = items.n - 1; i >= 0; i--) {
    const it = items.a[i];
    if (!it.alive) { items.kill(i); continue; }
    it.t += dt;
    if (it.type === 'M') {
      it.vy = Math.min(it.vy + 140 * dt, 45); it.x += it.vx * dt; it.y += it.vy * dt;
      if (it.y > H + 10) { it.alive = false; G.medalIdx = 0; }
    } else {
      it.x += it.vx * dt; it.y += it.vy * dt;
      if (it.t < 9) {   // bounce around the screen for a while, then drift away
        if ((it.x < 8 && it.vx < 0) || (it.x > W - 8 && it.vx > 0)) it.vx = -it.vx;
        if ((it.y < 22 && it.vy < 0) || (it.y > H - 24 && it.vy > 0)) it.vy = -it.vy;
      }
      if (it.y > H + 12 || it.y < -12 || it.x < -12 || it.x > W + 12) it.alive = false;
    }
    if (it.alive && P.alive && Math.abs(it.x - P.x) < 15 && Math.abs(it.y - P.y) < 15) { collect(it); it.alive = false; }
  }
}
function drawItems() {
  for (let i = 0; i < items.n; i++) {
    const it = items.a[i]; if (!it.alive) continue;
    const f = ((it.t * 6) | 0);
    const img = it.type === 'P' ? SPR.itemP[f & 1] : it.type === 'B' ? SPR.itemB[f & 1] : SPR.medal[((it.t * 10) | 0) % 4];
    if (it.type !== 'M' && it.t > 7.5 && f % 2) continue;    // blink before leaving
    blit(img, it.x, it.y);
  }
}

// =====================================================================
// 8c. BOMB — screen-wide blast, cancels bullets, brief invincibility
// =====================================================================
function useBomb() {
  if (G.bombs <= 0 || !P.alive || P.enterT > 0 || G.bombT > 0 || G.state !== 'play') return;
  G.bombs--; G.bombT = 2.2; G.bombTick = 0; G.bombX = P.x; G.bombY = P.y - 70;
  P.inv = Math.max(P.inv, 3); G.flash = 0.3; G.shake = 1.0; SFX.bomb();
}
function updateBomb(dt) {
  if (G.bombT <= 0) return;
  G.bombT -= dt;
  for (let i = 0; i < ebullets.n; i++) {
    const b = ebullets.a[i];
    if (b.alive) { b.alive = false; if (Math.random() < 0.3) spark(b.x, b.y, 1, 30, 6, 6, false); }
  }
  G.bombTick -= dt;
  if (G.bombTick <= 0) {
    G.bombTick = 0.12;
    for (let j = 0; j < enemies.n; j++) {
      const e = enemies.a[j];
      if (!e.alive || e.delay > 0 || e.y < -10 || e.y > H + 10) continue;
      e.hp -= 6; e.flash = 0.05; if (e.hp <= 0) killEnemy(e);
    }
    const b = G.boss;
    if (b && !b.enter && !b.dying) for (const p of b.parts) if (p.alive) bossHit(b, p, 2);
  }
  if (G.bombT > 0.5 && Math.random() < 0.7) {
    const e = explos.get();
    if (e) { e.x = rand(10, W - 10); e.y = rand(10, H - 10); e.t = 0; e.dur = rand(0.4, 0.7); e.sc = rand(1, 2.2); e.delay = 0; e.vy = 0; }
  }
}
function drawBombFx() {
  if (G.bombT > 0) {
    const p = 2.2 - G.bombT, r = p * 260;
    ctx.strokeStyle = p < 0.8 ? '#fff6c0' : '#ffb040'; ctx.lineWidth = Math.max(1, 10 - p * 4);
    ctx.beginPath(); ctx.arc(G.bombX + shx, G.bombY + shy, r, 0, TAU); ctx.stroke();
    if (p < 1.2) { ctx.lineWidth = 3; ctx.strokeStyle = '#ff7020'; ctx.beginPath(); ctx.arc(G.bombX + shx, G.bombY + shy, r * 0.6, 0, TAU); ctx.stroke(); }
  }
  if (G.flash > 0) { ctx.fillStyle = 'rgba(255,250,230,' + Math.min(0.85, G.flash * 3).toFixed(2) + ')'; ctx.fillRect(0, 0, W, H); }
}

// =====================================================================
// 8d. BOSSES — body sprite + destructible parts (all parts = total HP)
// part: [ox, oy, hp, gun, rate, gun2([name, rate], phase>=2), img, barrel]
// =====================================================================
const PART_HIT = { S: [6, 6], B: [9, 9], E: [7, 7], C: [7, 9], C2: [6, 5], C3: [8, 8] };
const BAR_OFF = { S: 5, B: 7, H: 13 };
const BOSSDEF = [
  { name: "BATTLESHIP LEVIATHAN", ground: true, hw: 28, hh: 84, startY: -95,
    parts: [[0, -53, 160, 'fan5', 2.6, null, 'B', 'B'], [-16, -29, 70, 'aim3', 1.7, null, 'S', 'S'], [16, -29, 70, 'aim3', 1.9, null, 'S', 'S'],
      [-16, 33, 70, 'aim', 1.3, null, 'S', 'S'], [16, 33, 70, 'aim', 1.5, null, 'S', 'S'], [0, 57, 160, 'fan7', 3.0, null, 'B', 'B'],
      [0, -5, 380, 'ring', 2.4, ['spiral', 0.11], 'C', '']],
    move(b, dt) {
      const ty = 96 + (H - 320) * 0.3;
      if (b.enter) { b.y += 48 * dt; if (b.y >= ty) { b.enter = false; b.t0 = b.t; } return; }
      const t = b.t - b.t0; b.x = W / 2 + 30 * Math.sin(t * 0.35); b.y = ty + 10 * Math.sin(t * 0.6);
    } },
  { name: "GIANT BOMBER HEAVEN'S ANVIL", ground: false, hw: 72, hh: 20, startY: -50,
    parts: [[-50, 13, 90, 'fan5', 2.8, null, 'E', 'S'], [-28, 13, 90, 'aim3', 1.6, null, 'E', 'S'], [28, 13, 90, 'aim3', 1.7, null, 'E', 'S'],
      [50, 13, 90, 'fan5', 3.0, null, 'E', 'S'], [0, -29, 90, 'stream', 2.2, null, 'S', 'S'], [0, 25, 420, 'ring', 2.2, ['spiral', 0.1], 'C2', '']],
    move(b, dt) {
      if (b.enter) { b.y += 40 * dt; if (b.y >= 72) { b.enter = false; b.t0 = b.t; } return; }
      const t = b.t - b.t0; b.x = W / 2 + 55 * Math.sin(t * 0.55); b.y = 72 + 18 * Math.sin(t * 1.1);
    },
    extra(b, dt) {
      b.sum = (b.sum || 0) + dt;
      if (b.phase >= 2 && b.sum > 7) { b.sum = 0; WAVES.side(Math.random() < 0.5, 4, 60, 1); }
    } },
  { name: 'RAIL CANNON GOLIATH', ground: true, hw: 21, hh: 100, startY: -110,
    parts: [[-10, -78, 80, 'aim3', 1.6, null, 'S', 'S'], [10, -78, 80, 'aim3', 1.8, null, 'S', 'S'], [0, -16, 420, 'big', 3.0, ['ring', 1.7], 'B', 'H'],
      [-16, 10, 70, 'aim', 1.2, null, 'S', 'S'], [16, 10, 70, 'aim', 1.3, null, 'S', 'S'], [0, 60, 360, 'fan7', 2.4, ['spiral', 0.1], 'C3', '']],
    move(b, dt) {
      b.x = W / 2;
      if (b.enter) { b.y += 45 * dt; if (b.y >= 104) { b.enter = false; b.t0 = b.t; } return; }
      b.y = 104 + 34 * Math.sin((b.t - b.t0) * 0.4);
    },
    extra(b, dt) {
      b.sm = (b.sm || 0) - dt;
      if (b.sm <= 0 && b.parts[5].alive) {
        b.sm = 0.07; const p = parts.get();
        if (p) { p.x = b.x + rand(-1, 1); p.y = b.y + 42; p.vx = rand(-8, 8); p.vy = rand(10, 30); p.max = p.life = 0.9; p.c = 4 + (Math.random() < 0.5 ? 1 : 0); p.big = 1; p.g = 0; }
      }
    } },
];
function spawnBoss() {
  const d = BOSSDEF[G.stage], m = (1 + G.loop * 0.45) * (firstRun() ? 0.82 : 1);   // stage 1 boss: -18% HP
  const b = { def: d, x: W / 2, y: d.startY, t: 0, t0: 0, enter: true, phase: 1, parts: [], ground: d.ground,
    hw: d.hw, hh: d.hh, name: d.name, img: SPR.boss[G.stage], dying: false, dieT: 0, max: 0, hp: 0 };
  for (const q of d.parts) {
    const hit = PART_HIT[q[6]];
    b.parts.push({ ox: q[0], oy: q[1], hp: q[2] * m, gun: q[3], rate: q[4], gun2: q[5], img: q[6], bar: q[7],
      hw: hit[0], hh: hit[1], alive: true, flash: 0, ang: Math.PI / 2, cd: rand(0.8, q[4]), sp: 0, burst: 0 });
    b.max += q[2] * m;
  }
  b.hp = b.max;
  G.boss = b;
}
function fireGun(name, p, x, y, b) {
  switch (name) {
    case 'aim': eShot(x, y, aimAng(x, y), 92, 0); break;
    case 'aim3': fan(x, y, aimAng(x, y), 3, 0.12, 95, 2); break;
    case 'fan5': fan(x, y, p.ang, 5, 0.22, 80, 1); break;
    case 'fan7': fan(x, y, p.bar ? p.ang : aimAng(x, y), 7, 0.17, 75, 1); break;
    case 'ring': ring(x, y, 14 + G.loop * 4 + G.stage * 2, 62, 0, b.t); break;
    case 'spiral': p.sp += 0.33; for (let k = 0; k < 3; k++) eShot(x, y, p.sp + k * TAU / 3, 72, 2); return;
    case 'big': fan(x, y, p.ang, 5, 0.28, 62, 3); fan(x, y, p.ang, 4, 0.28, 88, 1); G.shake = 0.2; break;
    case 'stream':
      if (p.burst <= 0) p.burst = 6;
      eShot(x, y, aimAng(x, y), 115, 0);
      if (--p.burst > 0) p.cd = 0.09;
      return;
  }
  spark(x, y, 3, 40, 1, 2, false);
  SFX.eshot();
}
function updateBoss(dt) {
  const b = G.boss; if (!b) return;
  b.t += dt;
  for (const p of b.parts) if (p.flash > 0) p.flash -= dt;
  if (b.dying) {
    b.dieT += dt;
    if (Math.random() < 0.5) { explode(b.x + rand(-b.hw, b.hw), b.y + rand(-b.hh, b.hh), rand(0.8, 1.8), 1); if (Math.random() < 0.3) SFX.boomS(); }
    G.shake = 0.3;
    if (b.dieT > 2.6) {
      explode(b.x, b.y, 3.5, 14, Math.min(b.hw, b.hh) + 10); spark(b.x, b.y, 50, 180, 0, 3, true);
      G.flash = 0.35; G.shake = 1; SFX.boomL();
      if (b.ground && G.stage !== 0) { stampCrater(b.x, b.y - 30, 14); stampCrater(b.x, b.y + 30, 12); }
      G.boss = null;
    }
    return;
  }
  b.def.move(b, dt);
  if (b.enter) return;
  const fr = b.hp / b.max;
  b.phase = fr > 0.6 ? 1 : fr > 0.3 ? 2 : 3;
  const rm = (b.phase === 3 ? 0.62 : b.phase === 2 ? 0.8 : 1) / Math.sqrt(diff()) * (firstRun() ? 1.2 : 1);  // stage 1 boss fires less often
  for (const p of b.parts) {
    const px = b.x + p.ox, py = b.y + p.oy;
    if (!p.alive) {
      if (Math.random() < dt * 6) { const s = parts.get(); if (s) { s.x = px + rand(-3, 3); s.y = py; s.vx = rand(-5, 5); s.vy = -25 + (b.ground ? G.scroll : 0); s.max = s.life = 0.7; s.c = 4; s.big = 1; s.g = 0; } }
      continue;
    }
    if (p.bar) turnTo(p, px, py, dt, 1.8);
    p.cd -= dt;
    if (p.cd <= 0) {
      const g2 = b.phase >= 2 && p.gun2;
      p.cd = (g2 ? p.gun2[1] : p.rate) * (g2 && p.gun2[0] === 'spiral' ? 1 : rm);
      if (P.alive && G.state === 'play') fireGun(g2 ? p.gun2[0] : p.gun, p, px, py, b);
    }
  }
  if (b.def.extra) b.def.extra(b, dt);
}
function bossHit(b, p, dmg) {
  if (!p.alive || b.dying) return;
  const d = Math.min(dmg, p.hp);
  p.hp -= d; b.hp -= d; p.flash = 0.05;
  if (p.hp <= 0) {
    p.alive = false;
    const px = b.x + p.ox, py = b.y + p.oy;
    explode(px, py, 1.4, 4, 8); spark(px, py, 12, 90, 0, 3, true);
    addScore(5000); popup(px, py - 10, '5000', 'y'); SFX.boomM(); G.shake = 0.3;
    if (b.parts.every((q) => !q.alive)) bossDie(b);
  }
}
function bossDie(b) {
  b.dying = true; b.dieT = 0;
  for (let i = 0; i < ebullets.n; i++) ebullets.a[i].alive = false;
  const bonus = 50000 * (G.stage + 1) * (G.loop + 1);
  addScore(bonus); popup(b.x, b.y, bonus, 'y');
  gotoState('bossdie'); SFX.music(null); SFX.boomL();
}
function shotVsBoss(s) {
  const b = G.boss;
  if (!b || b.enter || b.dying) return;
  for (const p of b.parts) {
    if (!p.alive) continue;
    if (Math.abs(s.x - (b.x + p.ox)) < p.hw + 2 && Math.abs(s.y - (b.y + p.oy)) < p.hh + 5) {
      s.alive = false; bossHit(b, p, s.dmg);
      if (Math.random() < 0.3) spark(s.x, s.y + 2, 1, 50, 0, 1, false);
      return;
    }
  }
  if (Math.abs(s.x - b.x) < b.hw && Math.abs(s.y - b.y) < b.hh) { s.alive = false; if (Math.random() < 0.25) spark(s.x, s.y + 3, 1, 40, 4, 4, false); }
}
function drawBoss(b, shadow) {
  if (shadow) { blit(b.img.s, b.x + 22, b.y + 34); return; }
  const fl = b.dying && ((b.dieT * 16) | 0) % 2;
  blit(fl ? b.img.w : b.img.n, b.x, b.y);
  for (const p of b.parts) {
    const px = b.x + p.ox, py = b.y + p.oy;
    if (!p.alive) { blit(SPR.wreck, px, py); continue; }
    if (p.bar) {
      const o = BAR_OFF[p.bar];
      blitRot(SPR['bar' + p.bar], px + Math.cos(p.ang) * o, py + Math.sin(p.ang) * o, p.ang);
    }
    const im = p.img[0] === 'C' ? SPR.core[p.img] : p.img === 'B' ? SPR.turB : p.img === 'E' ? SPR.turE : SPR.turS;
    blit(p.flash > 0 ? im.w : im.n, px, py);
    if (p.img === 'E') drawProps(px, py + 7, [0], 15);
    if (p.gun === 'big' && p.cd < 0.7 && !b.enter && ((b.t * 20) | 0) % 2) {      // main cannon charge glow
      const tx = px + Math.cos(p.ang) * 26, ty = py + Math.sin(p.ang) * 26;
      ctx.drawImage(SPR.expl[1], R(tx - 8) + shx, R(ty - 8) + shy, 16, 16);
    }
  }
}

// =====================================================================
// 9. STAGE SCRIPT
// =====================================================================
// [time(s), wave, ...args]
const SCRIPTS = [
  [ // STAGE 1 — ocean: fighters, bombers, destroyers
    [1.5, 'line', 60, 5], [3, 'line', 180, 5], [5.5, 'sine', 120, 5, 70, 1], [8, 'ground', 's', 60], [9, 'side', 1, 5, 40],
    [11, 'side', 0, 5, 70, 1], [13, 'bomber', 120], [16, 'dive', 80, 5], [17, 'dive', 170, 5], [19, 'ground', 's', 180],
    [20, 'vee', 120, 7], [23, 'stop', 120, 4], [25, 'line', 40, 6, 2, 1], [26, 'line', 200, 6, 2], [28, 'ground', 's', 110, 2],
    [30, 'bomber', 70], [31, 'bomber', 170], [34, 'sine', 60, 6, 40], [35, 'sine', 180, 6, 40, 1], [38, 'side', 1, 6, 30],
    [38.5, 'side', 0, 6, 50], [41, 'ground', 's', 120, 2], [43, 'dive', 120, 7], [46, 'vee', 60, 5], [46.5, 'vee', 180, 5],
    [49, 'stop', 120, 5, 60], [51, 'bomber', 120], [53, 'line', 120, 8, 0, 1], [56, 'ground', 's', 60], [56, 'ground', 's', 190],
    [58, 'sine', 120, 8, 80], [61, 'side', 1, 5, 40, 1], [62, 'side', 0, 5, 40], [64, 'dive', 120, 5], [66, 'bomber', 80],
    [67, 'bomber', 160], [70, 'vee', 120, 7], [73, 'line', 60, 6, 2], [73.5, 'line', 180, 6, 2, 1],
  ],
  [ // STAGE 2 — coast: tanks, gun emplacements, ships
    [1.5, 'line', 60, 5], [2.5, 'ground', 't', 170, 2], [4, 'line', 180, 5, 0, 1], [6, 'ground', 'g', 180], [7, 'sine', 100, 5, 60],
    [9, 'ground', 's', 40], [10, 'side', 1, 5, 50, 1], [12, 'ground', 't', 200, 3], [13, 'bomber', 120], [15, 'ground', 'g', 160, 2],
    [17, 'dive', 120, 6], [19, 'ground', 's', 50], [20, 'vee', 140, 7], [22, 'ground', 't', 190, 2], [24, 'stop', 120, 5],
    [26, 'ground', 'g', 200], [27, 'bomber', 70], [28, 'bomber', 170], [31, 'ground', 't', 170, 3], [32, 'side', 0, 6, 40],
    [34, 'ground', 's', 40, 2], [35, 'line', 120, 8, 2, 1], [38, 'ground', 'g', 180, 2], [40, 'sine', 60, 6, 40, 1],
    [40.5, 'sine', 180, 6, 40], [43, 'ground', 't', 150, 3], [45, 'dive', 80, 5], [45.5, 'dive', 170, 5], [48, 'bomber', 120],
    [50, 'ground', 'g', 200, 2], [52, 'side', 1, 6, 30, 1], [53, 'side', 0, 6, 60], [55, 'ground', 't', 180, 3],
    [57, 'ground', 's', 50], [58, 'vee', 120, 7], [61, 'stop', 120, 6, 60], [63, 'ground', 'g', 170, 2], [65, 'bomber', 80],
    [66, 'bomber', 160], [69, 'line', 60, 6, 2, 1], [69.5, 'line', 180, 6, 2], [72, 'ground', 't', 180, 3], [74, 'sine', 120, 8, 80, 1],
  ],
  [ // STAGE 3 — desert railway: armour columns, flak, heavy bombers
    [1.5, 'ground', 't', 60, 3], [2.5, 'ground', 't', 190, 3], [4, 'line', 120, 6, 0, 1], [6, 'ground', 'g', 50], [6, 'ground', 'g', 190],
    [8, 'side', 1, 6, 40], [9, 'side', 0, 6, 60, 1], [11, 'bomber', 70], [11.5, 'bomber', 170], [13, 'ground', 't', 120, 4],
    [15, 'dive', 120, 7], [17, 'ground', 'g', 60, 2], [18, 'ground', 'g', 180, 2], [19, 'sine', 80, 6, 50, 1], [20, 'sine', 160, 6, 50],
    [22, 'ground', 't', 60, 3], [23, 'stop', 120, 6, 60], [25, 'bomber', 120], [27, 'ground', 't', 190, 4], [28, 'vee', 80, 7],
    [29, 'vee', 170, 7], [31, 'ground', 'g', 120, 3], [33, 'line', 40, 7, 2, 1], [33.5, 'line', 200, 7, 2], [35, 'bomber', 60],
    [36, 'bomber', 180], [38, 'ground', 't', 120, 5], [40, 'side', 1, 7, 30], [40.5, 'side', 0, 7, 50, 1], [43, 'ground', 'g', 50, 2],
    [43, 'ground', 'g', 190, 2], [45, 'dive', 70, 5], [45.5, 'dive', 170, 5], [47, 'stop', 120, 6, 50], [49, 'bomber', 120],
    [51, 'ground', 't', 70, 4], [52, 'ground', 't', 180, 4], [54, 'sine', 120, 9, 90, 1], [57, 'bomber', 70], [58, 'bomber', 170],
    [60, 'ground', 'g', 120, 3], [62, 'line', 60, 7, 0, 1], [62.5, 'line', 180, 7], [65, 'dive', 120, 9], [67, 'ground', 't', 120, 5],
    [69, 'vee', 120, 9], [72, 'side', 1, 6, 40, 1], [72.5, 'side', 0, 6, 70],
  ],
];
function runScript(dt) {
  G.stageT += dt;
  const sc = SCRIPTS[G.stage % SCRIPTS.length];
  while (G.scriptI < sc.length && sc[G.scriptI][0] <= G.stageT) {
    const ev = sc[G.scriptI++];
    WAVES[ev[1]](...ev.slice(2));
  }
  if (G.bossState === 0 && G.scriptI >= sc.length && G.stageT > sc[sc.length - 1][0] + 5) {
    G.bossState = 1; gotoState('warning'); SFX.music(null); SFX.warn();
  }
}

// =====================================================================
// 10. UPDATE
// =====================================================================
function updateWorld(dt) {
  G.camY += G.scroll * dt;
  // enemies
  for (let i = enemies.n - 1; i >= 0; i--) {
    const e = enemies.a[i];
    if (!e.alive) { enemies.kill(i); continue; }
    if (e.delay > 0) { e.delay -= dt; continue; }
    e.t += dt; if (e.flash > 0) e.flash -= dt;
    EUPD[e.kind](e, dt);
    if (!e.alive) enemies.kill(i);
  }
  // player shots
  for (let i = pshots.n - 1; i >= 0; i--) {
    const s = pshots.a[i];
    s.x += s.vx * dt; s.y += s.vy * dt;
    if (!s.alive || s.y < -10 || s.x < -10 || s.x > W + 10) pshots.kill(i);
  }
  // enemy bullets
  for (let i = ebullets.n - 1; i >= 0; i--) {
    const b = ebullets.a[i];
    b.vx += b.ax * dt; b.vy += b.ay * dt;
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (!b.alive || b.x < -12 || b.x > W + 12 || b.y < -12 || b.y > H + 12) ebullets.kill(i);
  }
  // explosions
  for (let i = explos.n - 1; i >= 0; i--) {
    const e = explos.a[i];
    if (e.delay > 0) { e.delay -= dt; continue; }
    e.t += dt; e.y += e.vy * dt;
    if (e.t >= e.dur) explos.kill(i);
  }
  // particles
  for (let i = parts.n - 1; i >= 0; i--) {
    const p = parts.a[i];
    p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - 2.5 * dt; p.vy *= 1 - 2.5 * dt; p.vy += p.g * dt;
    if (p.life <= 0) parts.kill(i);
  }
  for (let i = popups.n - 1; i >= 0; i--) { const p = popups.a[i]; p.t += dt; p.y -= 18 * dt; if (p.t > 1) popups.kill(i); }
  updateItems(dt);
  updateBomb(dt);
  updateBoss(dt);
  if (G.shake > 0) G.shake -= dt;
  if (G.flash > 0) G.flash -= dt;
}

function collide() {
  // player shots vs enemies
  for (let i = 0; i < pshots.n; i++) {
    const s = pshots.a[i];
    if (!s.alive) continue;
    for (let j = 0; j < enemies.n; j++) {
      const e = enemies.a[j];
      if (!e.alive || e.delay > 0 || e.y < -8) continue;
      if (Math.abs(s.x - e.x) < e.hw + 2 && Math.abs(s.y - e.y) < e.hh + 5) {
        s.alive = false; e.hp -= s.dmg; e.flash = 0.05;
        if (e.hp <= 0) killEnemy(e); else if (Math.random() < 0.3) spark(s.x, s.y + 2, 1, 50, 0, 1, false);
        break;
      }
    }
    if (s.alive && G.boss) shotVsBoss(s);
  }
  if (!P.alive || G.state !== 'play') return;
  const hr = P.hitR;
  if (P.inv <= 0) {
    // enemy bullets vs tiny center hitbox
    for (let i = 0; i < ebullets.n; i++) {
      const b = ebullets.a[i];
      const dx = b.x - P.x, dy = b.y - P.y, rr = b.r + hr;
      if (dx * dx + dy * dy < rr * rr) { b.alive = false; killPlayer(); return; }
    }
    // body collision with air enemies
    for (let j = 0; j < enemies.n; j++) {
      const e = enemies.a[j];
      if (!e.alive || e.ground || e.delay > 0) continue;
      if (Math.abs(e.x - P.x) < e.hw * 0.7 + hr && Math.abs(e.y - P.y) < e.hh * 0.7 + hr) { killPlayer(); return; }
    }
  }
  // @@COLLIDE2
}

// =====================================================================
// 11. STATES
// =====================================================================
function gotoState(s) {
  G.state = s; G.stateT = 0; input.tap = false; input.bomb = false;
  document.body.classList.toggle('playing', s === 'play' || s === 'warning' || s === 'bossdie');
  // @@STATEHOOK
}
function clearField() { enemies.clear(); pshots.clear(); ebullets.clear(); explos.clear(); parts.clear(); items.clear(); popups.clear(); }
function newGame() {
  G.score = 0; G.lives = 3; G.bombs = 3; G.stage = 0; G.loop = 0; G.nextExtend = 100000; G.medalIdx = 0;
  resetPlayer(true);
  startStage(0);
}
function startStage(si) {
  G.stage = si; G.stageT = -2.5; G.scriptI = 0; G.camY = 0; G.boss = null; G.bossState = 0; G.bombT = 0; G.flash = 0;
  G.bombs = Math.max(G.bombs, 3);
  G.scroll = STAGES[si].scroll;
  clearField();
  buildStageMap(si);
  resetPlayer(false);
  gotoState('play');
  SFX.music('stage');
}

function update(dt) {
  G.stateT += dt;
  switch (G.state) {
    case 'title':
      G.camY += 20 * dt;
      if (input.tap && G.stateT > 0.4) { SFX.coin(); newGame(); }
      break;
    case 'play': case 'warning': case 'bossdie':
      if (input.bomb) { input.bomb = false; useBomb(); }
      input.tap = false;
      runScript(dt);
      updatePlayer(dt);
      updateWorld(dt);
      collide();
      break;
    case 'continue':
      updateWorld(dt);
      if (Math.floor(G.stateT) !== Math.floor(G.stateT - dt) && G.stateT < 10) SFX.beep();
      if (input.tap && G.stateT > 0.5) {
        G.lives = 3; G.bombs = 3; G.credits++; resetPlayer(false); gotoState('play');
      } else if (G.stateT > 10) { gotoState('gameover'); SFX.music(null); SFX.over(); }
      break;
    case 'gameover':
      updateWorld(dt);
      if ((input.tap && G.stateT > 2) || G.stateT > 7) { saveHi(); gotoTitle(); }
      break;
    case 'clear':
      updateWorld(dt);
      if (G.stateT > 2.2) P.y -= 200 * (G.stateT - 2.2) * dt;      // fly off the top
      if (G.stateT > 6.5 || (input.tap && G.stateT > 3)) {
        if (G.stage >= STAGES.length - 1) { gotoState('ending'); SFX.music('clear'); }
        else startStage(G.stage + 1);
      }
      input.tap = false;
      break;
    case 'ending':
      G.camY += 30 * dt;
      updateWorld(dt);
      if (input.tap && G.stateT > 3) { G.loop++; startStage(0); }
      break;
  }
  if (G.state === 'warning' && G.stateT > 3) { spawnBoss(); gotoState('play'); SFX.music('boss'); }
  if (G.state === 'bossdie' && !G.boss && G.stateT > 4.2) {
    if (!P.alive) { G.lives = Math.max(G.lives, 1); resetPlayer(false); P.enterT = 0; P.y = H - 50; }
    G.bonus = G.bombs * 5000 + P.level * 5000;
    addScore(G.bonus);
    gotoState('clear'); SFX.music('clear');
  }
}
function gotoTitle() { saveHi(); clearField(); buildStageMap(0); G.camY = 0; gotoState('title'); resize(); SFX.music('title'); }

// =====================================================================
// 12. RENDER
// =====================================================================
function render() {
  if (G.shake > 0) { const m = Math.min(4, G.shake * 10); shx = R(rand(-m, m)); shy = R(rand(-m, m)); } else { shx = shy = 0; }
  drawBackground();
  if (G.state === 'title') { drawTitle(); return; }
  // ground layer
  for (let i = 0; i < enemies.n; i++) { const e = enemies.a[i]; if (e.alive && e.ground && e.delay <= 0) drawEnemy(e, false); }
  const B = G.boss;
  if (B && B.ground) drawBoss(B, false);
  drawClouds();
  // shadows of air units
  for (let i = 0; i < enemies.n; i++) { const e = enemies.a[i]; if (e.alive && !e.ground && e.delay <= 0) drawEnemy(e, true); }
  if (B && !B.ground) drawBoss(B, true);
  drawPlayer(true);
  drawItems();
  for (let i = 0; i < pshots.n; i++) { const s = pshots.a[i]; blit(s.spr ? SPR.shot2 : SPR.shot, s.x, s.y); }
  for (let i = 0; i < enemies.n; i++) { const e = enemies.a[i]; if (e.alive && !e.ground && e.delay <= 0) drawEnemy(e, false); }
  if (B && !B.ground) drawBoss(B, false);
  drawPlayer(false);
  for (let i = 0; i < explos.n; i++) {
    const e = explos.a[i]; if (e.delay > 0) continue;
    const img = SPR.expl[Math.min(7, (e.t / e.dur * 8) | 0)], s = 32 * e.sc;
    ctx.drawImage(img, R(e.x - s / 2) + shx, R(e.y - s / 2) + shy, R(s), R(s));
  }
  for (let i = 0; i < parts.n; i++) {
    const p = parts.a[i];
    ctx.drawImage(SPR.dots, p.c * 3, p.big ? 2 : 0, p.big ? 2 : 1, p.big ? 2 : 1, R(p.x) + shx, R(p.y) + shy, p.big ? 2 : 1, p.big ? 2 : 1);
  }
  for (let i = 0; i < ebullets.n; i++) { const b = ebullets.a[i]; blit(SPR.bullets[b.type].img, b.x, b.y); }
  drawBombFx();
  for (let i = 0; i < popups.n; i++) { const p = popups.a[i]; text(p.s, p.x, p.y, p.col, 1); }
  drawHUD();
  drawOverlay();
}
function drawHUD() {
  text('1P', 4, 3, 'r'); text(String(G.score).padStart(8, ' '), 16, 3, 'w');
  text('HI', W / 2 - 6, 3, 'y'); text(String(G.hi), W / 2 + 8, 3, 'w');
  for (let i = 0; i < Math.min(G.lives - 1, 6); i++) ctx.drawImage(SPR.playerIcon, 4 + i * 13, H - 22);
  for (let i = 0; i < Math.min(G.bombs, 8); i++) ctx.drawImage(SPR.bombIcon, 4 + i * 8, H - 12);
  const b = G.boss;
  if (b && !b.dying) {
    const w = 150, x0 = (W - w) >> 1, f = b.enter ? Math.min(1, b.t / 2) : b.hp / b.max;
    ctx.fillStyle = '#000000'; ctx.fillRect(x0 - 1, 13, w + 2, 6);
    ctx.fillStyle = '#4a1010'; ctx.fillRect(x0, 14, w, 4);
    ctx.fillStyle = b.phase === 3 && ((G.stateT * 8) | 0) % 2 ? '#ffe040' : '#ff4030'; ctx.fillRect(x0, 14, R(w * f), 4);
    ctx.fillStyle = '#ff9a80'; ctx.fillRect(x0, 14, R(w * f), 1);
  }
}
function drawOverlay() {
  const blink = ((G.stateT * 3) | 0) % 2 === 0;
  if (G.state === 'play' && G.stageT < 0) {
    text('STAGE ' + (G.stage + 1), W / 2, H / 2 - 30, 'y', 1, 2);
    text(STAGES[G.stage].name, W / 2, H / 2 - 6, 'w', 1);
    if (blink) text('READY', W / 2, H / 2 + 14, 'c', 1);
  }
  if (G.state === 'continue') {
    dim(0.45);
    text('CONTINUE?', W / 2, H / 2 - 30, 'y', 1, 2);
    text(String(Math.max(0, 9 - Math.floor(G.stateT))), W / 2, H / 2, 'w', 1, 3);
    if (blink) text('TAP TO CONTINUE', W / 2, H / 2 + 40, 'c', 1);
  }
  if (G.state === 'gameover') { dim(0.5); text('GAME OVER', W / 2, H / 2 - 10, 'r', 1, 2); }
  if (G.paused) {
    dim(0.55);
    text('PAUSE', W / 2, H / 2 - 20, 'y', 1, 2);
    if (blink) text('TAP TO RESUME', W / 2, H / 2 + 10, 'w', 1);
  }
  if (G.state === 'warning') {
    const on = ((G.stateT * 4) | 0) % 2 === 0, y = H / 2 - 30;
    ctx.fillStyle = 'rgba(160,0,0,0.35)'; ctx.fillRect(0, y - 6, W, 60);
    ctx.fillStyle = '#ff3020'; ctx.fillRect(0, y - 6, W, 2); ctx.fillRect(0, y + 52, W, 2);
    if (on) text('WARNING!!', W / 2, y + 4, 'r', 1, 3);
    text(BOSSDEF[G.stage].name, W / 2, y + 36, 'y', 1);
  }
  if (G.state === 'clear' && G.stateT > 0.6) {
    text('STAGE ' + (G.stage + 1) + ' CLEAR!', W / 2, H / 2 - 50, 'y', 1, 2);
    if (G.stateT > 1.4) text('BOMB+POWER BONUS', W / 2, H / 2 - 10, 'w', 1);
    if (G.stateT > 1.8) text(String(G.bonus), W / 2, H / 2 + 6, 'c', 1, 2);
  }
  if (G.state === 'ending') {
    dim(0.4);
    text('CONGRATULATIONS!', W / 2, 70, 'y', 1, 2);
    text('THE ENEMY FLEET IS BROKEN.', W / 2, 110, 'w', 1);
    text('YOU ARE THE TRUE', W / 2, 126, 'w', 1);
    text('SKY ACE', W / 2, 146, 'o', 1, 2);
    text('SCORE ' + G.score, W / 2, 190, 'c', 1);
    if (G.stateT > 3 && blink) text('TAP FOR LOOP ' + (G.loop + 2), W / 2, 230, 'w', 1);
  }
}
function dim(a) { ctx.fillStyle = 'rgba(0,0,0,' + a + ')'; ctx.fillRect(0, 0, W, H); }
function drawTitle() {
  drawClouds();
  const t = G.stateT;
  // demo plane gently weaving
  const px = W / 2 + Math.sin(t * 0.9) * 40, py = H * 0.72 + Math.sin(t * 1.7) * 6;
  blit(SPR.player.s, px + 12, py + 18); blit(SPR.player.n, px, py);
  P.prop = t; drawProps(px, py - 9, [-6, 6], 7);
  dim(0.18);
  const ly = Math.min(46, -60 + t * 140);              // logo slides in
  ctx.drawImage(SPR.logo1, R((W - SPR.logo1.width) / 2), R(ly));
  ctx.drawImage(SPR.logo2, R((W - SPR.logo2.width) / 2), R(ly + SPR.logo1.height + 4));
  text('ORIGINAL ARCADE SHOOTER', W / 2, ly + 92, 'c', 1);
  text('HI SCORE', W / 2, 14, 'r', 1); text(String(G.hi), W / 2, 24, 'w', 1);
  if (t > 1 && ((t * 2.5) | 0) % 2 === 0) text('TAP TO START', W / 2, H * 0.52, 'y', 1, 2);
  text('DRAG ANYWHERE TO MOVE', W / 2, H * 0.52 + 26, 'w', 1);
  text('AUTO FIRE  /  BOMB BUTTON', W / 2, H * 0.52 + 37, 'w', 1);
  text('KEYS: ARROWS/WASD  Z  X  P', W / 2, H * 0.52 + 48, 'g', 1);
  text('@ 2026 SKY ACE TEAM', W / 2, H - 22, 'g', 1);
  text('FREE PLAY   CREDIT ' + String(G.credits).padStart(2, '0'), W / 2, H - 11, 'w', 1);
}
// ---------- parallax clouds ----------
const clouds = [];
function buildClouds() {
  SPR.clouds = [];
  for (let k = 0; k < 3; k++) {
    const w = 60 + k * 20, h = 30 + k * 6;
    const shape = paint(w, h, (g) => {
      for (let i = 0; i < 9 + k * 2; i++) {
        const x = rand(w * 0.2, w * 0.8), y = rand(h * 0.35, h * 0.65), r = rand(h * 0.2, h * 0.42);
        g.fillStyle = '#c8d8e8'; g.beginPath(); g.arc(x, y + 2, r, 0, TAU); g.fill();
        g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x - 1, y - 1, r * 0.85, 0, TAU); g.fill();
      }
    }, null);
    const [c, g] = mk(shape.width, shape.height);
    g.globalAlpha = 0.72; g.drawImage(shape, 0, 0);
    SPR.clouds.push(c);
  }
}
function drawClouds() {
  const dt = G.dt || 1 / 60;
  if (clouds.length < (G.stage === 2 ? 2 : 4) && Math.random() < 0.006) {
    clouds.push({ x: rand(-20, W + 20), y: -60, k: (Math.random() * 3) | 0, v: rand(1.8, 2.6) });
  }
  for (let i = clouds.length - 1; i >= 0; i--) {
    const c = clouds[i];
    if (!G.paused) c.y += G.scroll * c.v * dt;
    if (c.y > H + 60) { clouds.splice(i, 1); continue; }
    blit(SPR.clouds[c.k], c.x, c.y);
  }
}

// =====================================================================
// 13. MAIN LOOP
// =====================================================================
let last = 0, drewPaused = false;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now;
  if (!(dt > 0)) dt = 0; if (dt > 0.05) dt = 0.05;
  if (G.paused) {
    if (input.tap) { input.tap = false; togglePause(false); }
    // render at low rate while paused (saves battery)
    if (!drewPaused || ((now / 500) | 0) % 2 !== ((now - dt * 1000) / 500 | 0) % 2) { render(); drewPaused = true; }
    return;
  }
  drewPaused = false;
  G.dt = dt;
  SFX.tick();
  update(dt);
  render();
}
function boot() {
  resize();
  buildSprites();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));
  gotoTitle();
  requestAnimationFrame((t) => { last = t; frame(t); });
  // PWA offline cache (service workers need https or localhost)
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
// debug/test hooks (harmless in production)
window.__SKY = { G, P, startStage: (i) => startStage(i), spawnBoss: () => { G.bossState = 1; spawnBoss(); }, item: (t) => dropItem(t, P.x, P.y - 30), bomb: () => useBomb() };
boot();
})();
