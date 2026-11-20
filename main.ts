// News in one image: the world on Thursday 19 November 2026.
// Pure Node 22 standard library. Generates /output/entry.png deterministically:
// fixed layout, fixed content baked into the code, no clock, no randomness,
// no network at grade time. Run: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const W = 1024;
const H = 1024;

// ---------- CRC32 (PNG chunks) ----------
const CRC_TABLE = (() => {
  const t = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ---------- PNG encoder (8-bit RGB, filter 0) ----------
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePNG(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const idat = deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- Framebuffer ----------
const fb = Buffer.alloc(W * H * 3);

function setPixel(x, y, c) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  fb[i] = c[0]; fb[i + 1] = c[1]; fb[i + 2] = c[2];
}

function fillRect(x, y, w, h, c) {
  const x0 = Math.max(0, x), y0 = Math.max(0, y);
  const x1 = Math.min(W, x + w), y1 = Math.min(H, y + h);
  for (let yy = y0; yy < y1; yy++) {
    let i = (yy * W + x0) * 3;
    for (let xx = x0; xx < x1; xx++) {
      fb[i] = c[0]; fb[i + 1] = c[1]; fb[i + 2] = c[2];
      i += 3;
    }
  }
}

function fillCircle(cx, cy, r, c) {
  for (let y = -r; y <= r; y++) {
    const w = Math.floor(Math.sqrt(r * r - y * y));
    fillRect(cx - w, cy + y, w * 2 + 1, 1, c);
  }
}

function fillTriangle(x0, y0, x1, y1, x2, y2, c) {
  const minY = Math.max(0, Math.min(y0, y1, y2));
  const maxY = Math.min(H - 1, Math.max(y0, y1, y2));
  const edges = [[x0, y0, x1, y1], [x1, y1, x2, y2], [x2, y2, x0, y0]];
  for (let y = minY; y <= maxY; y++) {
    const xs = [];
    for (const e of edges) {
      const ax = e[0], ay = e[1], bx = e[2], by = e[3];
      if ((ay <= y && by > y) || (by <= y && ay > y)) {
        xs.push(ax + (y - ay) * (bx - ax) / (by - ay));
      }
    }
    if (xs.length >= 2) {
      const a = Math.floor(Math.min(xs[0], xs[1]));
      const b = Math.ceil(Math.max(xs[0], xs[1]));
      fillRect(a, y, b - a + 1, 1, c);
    }
  }
}

function drawLine(x0, y0, x1, y1, c, t) {
  t = t || 1;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0, y = y0;
  const half = Math.floor(t / 2);
  for (;;) {
    fillRect(x - half, y - half, t, t, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

function lerpColor(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// ---------- 5x7 bitmap font (uppercase, digits, punctuation) ----------
const FONT = {
  'A': [0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
  'B': [0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E],
  'C': [0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E],
  'D': [0x1E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1E],
  'E': [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F],
  'F': [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10],
  'G': [0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0F],
  'H': [0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
  'I': [0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E],
  'J': [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0C],
  'K': [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  'L': [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F],
  'M': [0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11],
  'N': [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  'O': [0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
  'P': [0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10],
  'Q': [0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0D],
  'R': [0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11],
  'S': [0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E],
  'T': [0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  'U': [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
  'V': [0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04],
  'W': [0x11, 0x11, 0x11, 0x15, 0x15, 0x1B, 0x11],
  'X': [0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11],
  'Y': [0x11, 0x11, 0x0A, 0x04, 0x04, 0x04, 0x04],
  'Z': [0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F],
  '0': [0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E],
  '1': [0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E],
  '2': [0x0E, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1F],
  '3': [0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E],
  '4': [0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02],
  '5': [0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E],
  '6': [0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E],
  '7': [0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E],
  '9': [0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C],
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 0x0C, 0x0C],
  ',': [0, 0, 0, 0, 0x0C, 0x04, 0x08],
  ':': [0, 0x0C, 0x0C, 0, 0x0C, 0x0C, 0],
  ';': [0, 0x0C, 0x0C, 0, 0x0C, 0x04, 0x08],
  "'": [0x04, 0x04, 0x08, 0, 0, 0, 0],
  '-': [0, 0, 0, 0x0E, 0, 0, 0],
  '/': [0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10],
  '(': [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02],
  ')': [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
  '%': [0x19, 0x19, 0x02, 0x04, 0x08, 0x13, 0x13],
  '$': [0x04, 0x0F, 0x14, 0x0E, 0x05, 0x1E, 0x04],
  '&': [0x0C, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0D],
  '!': [0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04],
  '?': [0x0E, 0x11, 0x01, 0x02, 0x04, 0, 0x04],
  '+': [0, 0x04, 0x04, 0x1F, 0x04, 0x04, 0],
  '=': [0, 0, 0x1F, 0, 0x1F, 0, 0],
  '"': [0x0A, 0x0A, 0x0A, 0, 0, 0, 0],
  '*': [0, 0x04, 0x15, 0x0E, 0x15, 0x04, 0],
  '_': [0, 0, 0, 0, 0, 0, 0x1F],
  '|': [0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
};

function drawChar(ch, x, y, s, c) {
  const g = FONT[ch];
  if (!g) return;
  for (let row = 0; row < 7; row++) {
    const bits = g[row];
    for (let col = 0; col < 5; col++) {
      if (bits & (1 << (4 - col))) fillRect(x + col * s, y + row * s, s, s, c);
    }
  }
}

function textWidth(text, s) {
  return text.length * 6 * s - s;
}

function drawText(text, x, y, s, c, shadow) {
  if (shadow) {
    const o = Math.max(2, s);
    for (let i = 0; i < text.length; i++) drawChar(text[i], x + i * 6 * s + o, y + o, s, shadow);
  }
  for (let i = 0; i < text.length; i++) drawChar(text[i], x + i * 6 * s, y, s, c);
}

function drawCentered(text, cx, y, s, c, shadow) {
  drawText(text, cx - Math.floor(textWidth(text, s) / 2), y, s, c, shadow);
}

function wrapText(text, s, maxW) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (textWidth(t, s) <= maxW) cur = t;
    else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ---------- Palette ----------
const INK = [16, 16, 22];
const WHITE = [255, 255, 255];
const PAPER = [251, 247, 238];
const RED = [255, 77, 77];
const YELLOW = [255, 209, 102];
const TEAL = [14, 124, 107];
const NAVY = [30, 58, 95];
const GOLD = [201, 162, 39];
const DARKRED = [61, 10, 10];
const ORANGE = [255, 94, 58];
const GREY = [154, 154, 165];

// ---------- Masthead ----------
function drawMasthead() {
  fillRect(0, 0, W, 100, INK);
  drawCentered('THE WORLD IN ONE IMAGE', Math.floor(W / 2), 12, 5, WHITE);
  drawCentered('THURSDAY 19 NOVEMBER 2026', Math.floor(W / 2), 60, 2, RED);
  fillRect(0, 96, W, 4, RED);
}

// ---------- Hero: GTA VI over a Vice City sunset ----------
const SKY_STOPS = [
  [100, [36, 16, 71]],
  [170, [91, 42, 134]],
  [230, [184, 50, 128]],
  [290, [255, 94, 58]],
  [340, [255, 158, 61]],
  [404, [255, 196, 107]],
];

function skyColor(y) {
  for (let i = 0; i < SKY_STOPS.length - 1; i++) {
    const y0 = SKY_STOPS[i][0], c0 = SKY_STOPS[i][1];
    const y1 = SKY_STOPS[i + 1][0], c1 = SKY_STOPS[i + 1][1];
    if (y >= y0 && y <= y1) {
      const t = (y - y0) / (y1 - y0);
      return lerpColor(c0, c1, t);
    }
  }
  return SKY_STOPS[SKY_STOPS.length - 1][1];
}

const STARS = [
  [60, 112], [140, 130], [220, 108], [330, 140], [420, 116], [520, 132],
  [610, 110], [700, 128], [880, 116], [950, 138], [90, 170], [260, 178],
  [470, 168], [580, 182], [840, 172], [980, 168], [180, 210], [380, 205],
];

const BUILDINGS = [
  [0, 46, 58], [52, 34, 88], [92, 58, 44], [156, 30, 104], [192, 44, 66],
  [242, 38, 120], [286, 52, 52], [344, 30, 96], [380, 48, 72], [434, 36, 110],
  [476, 56, 60], [538, 32, 92], [576, 44, 50], [626, 40, 84], [672, 30, 64],
  [708, 52, 98], [766, 36, 58], [808, 46, 80], [860, 32, 66], [898, 54, 94],
  [958, 40, 56], [1004, 20, 72],
];

function drawHero() {
  // Sunset sky.
  for (let y = 100; y < 404; y++) fillRect(0, y, W, 1, skyColor(y));
  // Stars in the upper sky.
  for (const st of STARS) fillRect(st[0], st[1], 3, 3, WHITE);
  // Synthwave sun with slits.
  fillCircle(780, 300, 80, YELLOW);
  for (let y = 312; y < 380; y += 12) {
    fillRect(700, y, 160, 5, skyColor(y));
  }
  // Skyline silhouettes with lit windows.
  const base = 368;
  for (const b of BUILDINGS) {
    const bx = b[0], bw = b[1], bh = b[2];
    fillRect(bx, base - bh, bw, bh, [20, 9, 43]);
    for (let wy = base - bh + 8; wy < base - 10; wy += 14) {
      for (let wx = bx + 6; wx < bx + bw - 8; wx += 12) {
        if ((wx + wy) % 28 < 14) fillRect(wx, wy, 4, 6, YELLOW);
      }
    }
  }
  // Dark band at the bottom of the hero.
  fillRect(0, 368, W, 36, [20, 9, 43]);
  // Text over the sky.
  drawText('GAMING', 32, 122, 2, YELLOW);
  drawText('GTA VI IS OUT', 32, 152, 8, WHITE, [20, 9, 43]);
  const sub = wrapText("ROCKSTAR'S VICE CITY EPIC LANDS AT MIDNIGHT ON PS5 AND XBOX AFTER TWO DELAYS", 2, 960);
  sub.forEach((ln, i) => drawText(ln, 32, 226 + i * 20, 2, WHITE, [20, 9, 43]));
  drawText('MIDNIGHT LOCAL LAUNCH  |  $3B+ YEAR-ONE FORECAST  |  PRELOAD FROM 10 NOV', 32, 378, 2, WHITE);
}

// ---------- Story panels ----------
function panel(x, y, w, h, bg, accent) {
  fillRect(x, y, w, h, bg);
  fillRect(x, y, w, 8, accent);
}

function drawAnthropic() {
  const x = 8, y = 412, w = 496, h = 280;
  panel(x, y, w, h, PAPER, TEAL);
  drawText('WALL STREET', x + 20, y + 20, 2, TEAL);
  drawText('ANT +17% ON DEBUT', x + 20, y + 46, 4, INK);
  const body = wrapText('PRICED AT $83, OPENED AT $111.50 IN THE LARGEST IPO EVER. $81.3B RAISED.', 2, 456);
  body.forEach((ln, i) => drawText(ln, x + 20, y + 88 + i * 20, 2, INK));
  // Intraday chart: opens high, closes lower. Y scale: $83 (IPO) at
  // the axis bottom (y 664), ~$115 at the top (y 556).
  const pts = [
    [40, 568], [90, 580], [140, 574], [190, 560], [240, 556],
    [290, 570], [340, 588], [390, 600], [440, 610], [480, 616],
  ];
  drawLine(28, 664, 484, 664, INK, 2);
  drawLine(28, 556, 28, 664, INK, 2);
  for (let i = 0; i < pts.length - 1; i++) {
    drawLine(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], TEAL, 4);
  }
  fillCircle(pts[0][0], pts[0][1], 5, TEAL);
  fillCircle(pts[pts.length - 1][0], pts[pts.length - 1][1], 5, TEAL);
  drawText('OPEN $111.50', 56, 544, 1, TEAL);
  drawText('$83', 36, 670, 1, INK);
  drawText('CLOSE $97.17', 396, 670, 1, INK);
}

function drawICJ() {
  const x = 520, y = 412, w = 496, h = 280;
  panel(x, y, w, h, PAPER, NAVY);
  drawText('THE HAGUE', x + 20, y + 20, 2, NAVY);
  const head = wrapText('MYANMAR GUILTY OF GENOCIDE', 4, 456);
  head.forEach((ln, i) => drawText(ln, x + 20, y + 46 + i * 34, 4, INK));
  const body = wrapText('THE WORLD COURT: MYANMAR COMMITTED GENOCIDE AGAINST THE ROHINGYA', 2, 456);
  body.forEach((ln, i) => drawText(ln, x + 20, y + 124 + i * 20, 2, INK));
  drawText('A FIRST AGAINST A STATE', x + 20, y + 124 + body.length * 20 + 8, 2, NAVY);
  // Scales of justice.
  const cx = 768;
  drawLine(cx, 612, cx, 676, NAVY, 4);
  drawLine(716, 620, 820, 620, NAVY, 4);
  fillCircle(cx, 608, 4, NAVY);
  drawLine(716, 620, 700, 648, NAVY, 3);
  drawLine(716, 620, 732, 648, NAVY, 3);
  fillTriangle(700, 648, 732, 648, 716, 664, GOLD);
  drawLine(820, 620, 804, 648, NAVY, 3);
  drawLine(820, 620, 836, 648, NAVY, 3);
  fillTriangle(804, 648, 836, 648, 820, 664, GOLD);
  fillRect(cx - 20, 676, 40, 6, NAVY);
}

function drawSummit() {
  const x = 8, y = 700, w = 496, h = 240;
  panel(x, y, w, h, PAPER, RED);
  drawText('SHENZHEN', x + 20, y + 20, 2, RED);
  const head = wrapText('TRUMP, XI, PUTIN MEET', 4, 456);
  head.forEach((ln, i) => drawText(ln, x + 20, y + 46 + i * 34, 4, INK));
  const body = wrapText('FIRST THREE-WAY SUMMIT ENDS WITH A FOUR-POINT DECLARATION TOWARD PEACE', 2, 456);
  body.forEach((ln, i) => drawText(ln, x + 20, y + 122 + i * 20, 2, INK));
  // Three nations.
  const bars = [
    [28, [200, 16, 46], 'US'],
    [108, [245, 179, 1], 'CN'],
    [188, [30, 79, 163], 'RU'],
  ];
  for (const b of bars) {
    fillRect(b[0], 866, 60, 58, b[1]);
    drawText(b[2], b[0] + 30 - Math.floor(textWidth(b[2], 2) / 2), 888, 2, WHITE);
  }
  // Globe.
  fillCircle(430, 895, 30, [30, 79, 163]);
  fillCircle(430, 895, 26, PAPER);
  drawLine(404, 895, 456, 895, [30, 79, 163], 2);
  drawLine(430, 869, 430, 921, [30, 79, 163], 2);
}

function drawIran() {
  const x = 520, y = 700, w = 496, h = 240;
  panel(x, y, w, h, DARKRED, ORANGE);
  drawText('THE GULF', x + 20, y + 20, 2, ORANGE);
  const head = wrapText('IRAN WIDENS ATTACKS', 4, 456);
  head.forEach((ln, i) => drawText(ln, x + 20, y + 46 + i * 34, 4, WHITE));
  const body = wrapText('TEHRAN FIRES ON A US BASE IN KUWAIT AND TARGETS IN BAHRAIN', 2, 456);
  body.forEach((ln, i) => drawText(ln, x + 20, y + 122 + i * 20, 2, WHITE));
  // Starburst.
  const cx = 768, cy = 886;
  for (let k = 0; k < 12; k++) {
    const a = (k * Math.PI) / 6;
    const len = k % 2 === 0 ? 48 : 34;
    drawLine(cx, cy, Math.round(cx + len * Math.cos(a)), Math.round(cy + len * Math.sin(a)), ORANGE, 3);
  }
  fillCircle(cx, cy, 10, YELLOW);
}

// ---------- Footer ----------
function drawFooter() {
  fillRect(0, 948, W, 76, INK);
  const tick = wrapText("ALSO: VAN GOGH SELLS FOR $190.4M, A RECORD FOR THE ARTIST | 'HUMAN' IS CAMBRIDGE'S WORD OF THE YEAR | MARKETS: DOW -2.2%, NASDAQ -2.3%", 2, 992);
  tick.forEach((ln, i) => drawText(ln, 16, 958 + i * 20, 2, WHITE));
  drawText('SOURCES: ROCKSTAR GAMES - REUTERS - WSJ - AP - UN NEWS - 19 NOV 2026', 16, 1006, 1, GREY);
}

// ---------- Main ----------
function main() {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
  mkdirSync(outDir, { recursive: true });
  fillRect(0, 0, W, H, INK);
  drawMasthead();
  drawHero();
  drawAnthropic();
  drawICJ();
  drawSummit();
  drawIran();
  drawFooter();
  const png = encodePNG(W, H, fb);
  writeFileSync(join(outDir, 'entry.png'), png);
}

main();
