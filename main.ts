// news-image-20261124 — "THE WORLD IN ONE DAY"
// Draws one front-page image summarising Tuesday 24 November 2026.
// Node 22, standard library only, no network. Deterministic: two runs
// write byte-identical PNGs. The PNG encoder and the 5x7 bitmap font
// are written here from scratch.

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------- palette
const PAPER: RGB = [246, 241, 231];
const INK: RGB = [26, 26, 26];
const NAVY: RGB = [22, 35, 63];
const NAVY2: RGB = [31, 52, 92];
const GOLD: RGB = [201, 162, 39];
const GOLD_BG: RGB = [232, 201, 106];
const RED: RGB = [179, 38, 30];
const BLUE: RGB = [31, 78, 121];
const TEAL: RGB = [14, 110, 105];
const ORANGE: RGB = [214, 106, 24];
const GREY: RGB = [110, 110, 104];
const LIGHT: RGB = [233, 227, 214];
const WHITE: RGB = [255, 255, 255];

type RGB = [number, number, number];

// ---------------------------------------------------------------- pixels
const px = new Uint8Array(W * H * 3);
function fillAll(c: RGB): void {
  for (let i = 0; i < W * H; i++) {
    px[i * 3] = c[0];
    px[i * 3 + 1] = c[1];
    px[i * 3 + 2] = c[2];
  }
}
function setPx(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = c[0];
  px[i + 1] = c[1];
  px[i + 2] = c[2];
}
function rect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(W, Math.ceil(x + w));
  const y1 = Math.min(H, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) setPx(xx, yy, c);
  }
}
function hline(x: number, y: number, w: number, c: RGB): void {
  rect(x, y, w, 1, c);
}
function vline(x: number, y: number, h: number, c: RGB): void {
  rect(x, y, 1, h, c);
}
function line(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    setPx(x, y, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}
function disc(cx: number, cy: number, r: number, c: RGB): void {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y <= r * r) setPx(cx + x, cy + y, c);
    }
  }
}
function ring(cx: number, cy: number, r: number, c: RGB): void {
  for (let a = 0; a < 360; a += 2) {
    const t = (a * Math.PI) / 180;
    setPx(Math.round(cx + r * Math.cos(t)), Math.round(cy + r * Math.sin(t)), c);
  }
}
// Filled polygon (scanline), points as [x, y] pairs.
function poly(pts: Array<[number, number]>, c: RGB): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of pts) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  for (let y = Math.ceil(minY); y <= Math.floor(maxY); y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) setPx(x, y, c);
    }
  }
}
// Spiky starburst centred at (cx, cy): outer radius ro, inner ri, n spikes.
function burst(cx: number, cy: number, ro: number, ri: number, n: number, c: RGB): void {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? ro : ri;
    const a = (i * Math.PI) / n - Math.PI / 2;
    pts.push([Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a))]);
  }
  poly(pts, c);
}

// ---------------------------------------------------------------- 5x7 font
// Each glyph: 7 rows, each a 5-bit number (bit 4 = leftmost column).
const FONT: Record<string, number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 21, 10],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  "0": [14, 17, 19, 21, 25, 17, 14],
  "1": [4, 12, 4, 4, 4, 4, 14],
  "2": [14, 17, 1, 6, 8, 16, 31],
  "3": [31, 2, 4, 2, 1, 17, 14],
  "4": [2, 6, 10, 18, 31, 2, 2],
  "5": [31, 16, 30, 1, 1, 17, 14],
  "6": [6, 8, 16, 30, 17, 17, 14],
  "7": [31, 1, 2, 4, 8, 8, 8],
  "8": [14, 17, 17, 14, 17, 17, 14],
  "9": [14, 17, 17, 15, 1, 2, 12],
  " ": [0, 0, 0, 0, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 12, 12],
  ",": [0, 0, 0, 0, 12, 4, 8],
  "-": [0, 0, 0, 14, 0, 0, 0],
  "'": [4, 4, 8, 0, 0, 0, 0],
  ":": [0, 12, 12, 0, 12, 12, 0],
  ";": [0, 12, 12, 0, 12, 4, 8],
  "!": [4, 4, 4, 4, 4, 0, 4],
  "?": [14, 17, 1, 6, 4, 0, 4],
  "(": [2, 4, 8, 8, 8, 4, 2],
  ")": [8, 4, 2, 2, 2, 4, 8],
  "%": [25, 26, 2, 4, 8, 19, 25],
  $: [4, 15, 20, 14, 5, 30, 4],
  "+": [0, 4, 4, 14, 4, 4, 0],
  "/": [1, 2, 2, 4, 8, 8, 16],
  "&": [12, 18, 20, 8, 21, 18, 13],
  "=": [0, 0, 31, 0, 31, 0, 0],
  '"': [10, 10, 0, 0, 0, 0, 0],
  "*": [0, 4, 21, 14, 21, 4, 0],
  "•": [0, 0, 12, 12, 12, 0, 0],
};

function glyphWidth(scale: number): number {
  return 6 * scale;
}
function textWidth(s: string, scale: number): number {
  return s.length * glyphWidth(scale) - scale;
}
function drawChar(ch: string, x: number, y: number, scale: number, c: RGB): void {
  const g = FONT[ch] ?? FONT[" "];
  for (let r = 0; r < 7; r++) {
    const row = g[r];
    for (let col = 0; col < 5; col++) {
      if (row & (1 << (4 - col))) {
        rect(x + col * scale, y + r * scale, scale, scale, c);
      }
    }
  }
}
function drawText(s: string, x: number, y: number, scale: number, c: RGB): void {
  s = s.toUpperCase(); // the bitmap font only carries A-Z, 0-9 and punctuation
  let cx = x;
  for (const ch of s) {
    drawChar(ch, cx, y, scale, c);
    cx += glyphWidth(scale);
  }
}
function drawTextCentered(s: string, cx: number, y: number, scale: number, c: RGB): void {
  drawText(s, Math.round(cx - textWidth(s, scale) / 2), y, scale, c);
}
// Greedy word wrap; returns lines of at most maxChars characters.
function wrap(s: string, maxChars: number): string[] {
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur === "") {
      cur = w;
    } else if (cur.length + 1 + w.length <= maxChars) {
      cur += " " + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}
function drawBlock(lines: string[], x: number, y: number, scale: number, c: RGB, lh: number): void {
  lines.forEach((ln, i) => drawText(ln, x, y + i * lh, scale, c));
}

// ---------------------------------------------------------------- content
// All stories verified against Tuesday 24 November 2026 (see fact file).
interface Lead {
  tag: string;
  tagColor: RGB;
  headline: string;
  sub: string;
  art: "gaza" | "zaporizhzhia" | "hormuz";
}
const LEADS: Lead[] = [
  {
    tag: "GAZA",
    tagColor: RED,
    headline: "ISRAELI STRIKES KILL HAMAS SECURITY CHIEF",
    sub: "Naeem Abu Nahel and six others dead, including two police officers.",
    art: "gaza",
  },
  {
    tag: "ZAPORIZHZHIA",
    tagColor: BLUE,
    headline: "RUSSIAN STRIKE HITS APARTMENT BLOCK",
    sub: "2 killed, 40 wounded, including four children.",
    art: "zaporizhzhia",
  },
  {
    tag: "STRAIT OF HORMUZ",
    tagColor: TEAL,
    headline: "IRANIAN TANKER HIT BY NAVAL MINE CATCHES FIRE",
    sub: "UK logs record Iranian attacks in the strait.",
    art: "hormuz",
  },
];

interface GridItem {
  tag: string;
  color: RGB;
  label: string;
}
const GRID: GridItem[] = [
  // War & diplomacy
  { tag: "WAR", color: RED, label: "UN seeks probe into Libya warship strike" },
  { tag: "WAR", color: RED, label: "Russia: Estonia moves verge of open war" },
  { tag: "WAR", color: RED, label: "Germany first to access Ukraine Delta system" },
  { tag: "WAR", color: RED, label: "NATO chief: alliance will defend in space" },
  { tag: "WAR", color: RED, label: "Fighting traps Ebola responders in DR Congo" },
  { tag: "WAR", color: RED, label: "Iraq PM: oil ministry to run Kurdish oilfields" },
  { tag: "WAR", color: RED, label: "UK sanctions Houthi movement, four officials" },
  { tag: "WAR", color: RED, label: "Somalia, Uganda step up anti-Al-Shabaab fight" },
  { tag: "WAR", color: RED, label: "Russian jets trigger South Korea air alert" },
  { tag: "WAR", color: RED, label: "IAEA names sanctioned Russian as deputy chief" },
  { tag: "WAR", color: RED, label: "Greece plans trade route to support Ukraine" },
  { tag: "WAR", color: RED, label: "Russia tightens citizen finance monitoring" },
  // Tech & business
  { tag: "TECH", color: BLUE, label: "Anthropic slides 10-13% after $567m loss" },
  { tag: "TECH", color: BLUE, label: "Nvidia slips over 4% after 31% Huang surge" },
  { tag: "TECH", color: BLUE, label: "Bitcoin near $60,200; ETFs post record outflows" },
  { tag: "TECH", color: BLUE, label: "Arm extends CEO Rene Haas tenure to 2033" },
  { tag: "TECH", color: BLUE, label: "Oregon, Virginia sue SpaceX over Grok images" },
  { tag: "TECH", color: BLUE, label: "US lawmakers alarm over FAA aircraft AI tool" },
  { tag: "TECH", color: BLUE, label: "S. Korea offers $375,000 for AI exam cheats" },
  { tag: "TECH", color: BLUE, label: "AI false death notices target Belgium" },
  { tag: "TECH", color: BLUE, label: "Indonesia stocks close +0.49% at 5,241.59" },
  { tag: "TECH", color: BLUE, label: "MSCI: no Indonesia downgrade decision yet" },
  { tag: "TECH", color: BLUE, label: "Indonesia charges former police chief: treason" },
  { tag: "TECH", color: BLUE, label: "Freeport Indonesia prices $750m notes" },
  // Science & world
  { tag: "WORLD", color: TEAL, label: "BepiColombo safe in Mercury orbit" },
  { tag: "WORLD", color: TEAL, label: "Bus-truck crash in UAE kills 11" },
  { tag: "WORLD", color: TEAL, label: "Indonesia factory fire: victims died fleeing" },
  { tag: "WORLD", color: TEAL, label: "Mexico to try El Chapo Isidro despite US request" },
  { tag: "WORLD", color: TEAL, label: "Chinese official jailed for life for espionage" },
  { tag: "WORLD", color: TEAL, label: "Australia: Pauline Hanson faces largest trial" },
];

interface Tl {
  time: string;
  text: string;
}
const TIMELINE: Tl[] = [
  { time: "02:05 UTC", text: "Jakarta stocks open +1.6%" },
  { time: "08:00 UTC", text: "Jakarta stocks close +0.49% at 5,241.59" },
  { time: "08:50 UTC", text: "BepiColombo orbit report published" },
  { time: "EVENING UTC", text: "Gaza strikes; Hormuz tanker fire reported" },
];

// ---------------------------------------------------------------- pictograms
function drawGaza(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [250, 232, 205]);
  // City skyline silhouettes along the bottom.
  const base = y + h;
  const heights = [46, 70, 54, 84, 62, 96, 58, 76, 50, 88, 64];
  const bw = Math.floor(w / heights.length);
  for (let i = 0; i < heights.length; i++) {
    rect(x + i * bw + 2, base - heights[i], bw - 4, heights[i], NAVY2);
  }
  // Explosion burst above the skyline.
  const cx = x + Math.floor(w * 0.52);
  const cy = y + 58;
  burst(cx, cy, 62, 30, 12, ORANGE);
  burst(cx, cy, 44, 22, 12, RED);
  burst(cx, cy, 26, 12, 10, GOLD);
  disc(cx, cy, 10, WHITE);
  // Smoke puffs.
  disc(x + 52, y + 34, 9, GREY);
  disc(x + 70, y + 26, 7, GREY);
  disc(x + w - 58, y + 40, 8, GREY);
}

function drawZaporizhzhia(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [222, 231, 238]);
  const bx = x + Math.floor(w / 2) - 52;
  const by = y + 26;
  const bw = 104;
  const bh = h - 40;
  // Apartment block.
  rect(bx, by, bw, bh, NAVY2);
  // Broken top corner: a dark wedge taken out, drawn as paper-coloured poly.
  poly(
    [
      [bx + bw, by],
      [bx + bw - 30, by],
      [bx + bw, by + 26],
    ],
    PAPER,
  );
  // Windows.
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 4; c++) {
      const wx = bx + 12 + c * 24;
      const wy = by + 34 + r * 20;
      rect(wx, wy, 13, 12, r === 1 && c === 2 ? GOLD : LIGHT);
    }
  }
  // Jagged crack down the facade.
  let px0 = bx + 58;
  let py0 = by + 8;
  for (let s = 0; s < 6; s++) {
    const nx = px0 + (s % 2 === 0 ? 12 : -12);
    const ny = py0 + 20;
    line(px0, py0, nx, ny, INK);
    line(px0 + 1, py0, nx + 1, ny, INK);
    px0 = nx;
    py0 = ny;
  }
  // Smoke above the roof.
  disc(bx + bw - 12, by - 8, 9, GREY);
  disc(bx + bw + 6, by - 16, 7, GREY);
}

function drawHormuz(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [203, 224, 233]);
  // Sea.
  const seaY = y + Math.floor(h * 0.62);
  rect(x, seaY, w, h - Math.floor(h * 0.62), [70, 120, 158]);
  for (let i = 0; i < 3; i++) {
    const wy = seaY + 14 + i * 16;
    for (let sx = x + 8; sx < x + w - 8; sx += 34) {
      line(sx, wy, sx + 16, wy - 4, WHITE);
      line(sx + 16, wy - 4, sx + 26, wy, WHITE);
    }
  }
  // Tanker hull.
  const hx = x + 34;
  const hy = seaY - 26;
  poly(
    [
      [hx, hy],
      [hx + w - 68, hy],
      [hx + w - 84, hy + 30],
      [hx + 14, hy + 30],
    ],
    NAVY,
  );
  // Deck containers.
  rect(hx + 26, hy - 22, 34, 22, RED);
  rect(hx + 66, hy - 22, 34, 22, GOLD);
  rect(hx + 106, hy - 22, 34, 22, TEAL);
  rect(hx + 146, hy - 22, 34, 22, ORANGE);
  // Bridge tower.
  rect(hx + w - 118, hy - 46, 26, 46, WHITE);
  rect(hx + w - 114, hy - 42, 18, 8, NAVY);
  // Flames above mid-ship.
  const fx = hx + 96;
  const fy = hy - 22;
  poly(
    [
      [fx - 16, fy],
      [fx, fy - 42],
      [fx + 16, fy],
    ],
    ORANGE,
  );
  poly(
    [
      [fx - 9, fy],
      [fx, fy - 26],
      [fx + 9, fy],
    ],
    GOLD,
  );
  poly(
    [
      [fx + 18, fy],
      [fx + 28, fy - 26],
      [fx + 38, fy],
    ],
    RED,
  );
  // Smoke.
  disc(fx + 8, fy - 52, 8, GREY);
  disc(fx + 22, fy - 62, 6, GREY);
}

// ---------------------------------------------------------------- layout
function draw(): void {
  fillAll(PAPER);

  // ---- masthead
  rect(0, 0, W, 118, NAVY);
  drawTextCentered("THE WORLD IN ONE DAY", W / 2, 26, 5, WHITE);
  drawTextCentered("TUESDAY 24 NOVEMBER 2026", W / 2, 82, 3, GOLD);
  rect(0, 118, W, 4, GOLD);

  // ---- date-check band
  rect(0, 122, W, 34, GOLD_BG);
  drawTextCentered(
    "EVERY STORY IN THIS IMAGE WAS CHECKED AGAINST 24 NOVEMBER 2026",
    W / 2,
    133,
    2,
    INK,
  );

  // ---- three leads
  const colW = 320;
  const colX = [24, 352, 680];
  const picY = 172;
  const picH = 148;
  LEADS.forEach((lead, i) => {
    const x = colX[i];
    if (lead.art === "gaza") drawGaza(x, picY, colW, picH);
    if (lead.art === "zaporizhzhia") drawZaporizhzhia(x, picY, colW, picH);
    if (lead.art === "hormuz") drawHormuz(x, picY, colW, picH);
    rect(x, picY + picH, colW, 3, lead.tagColor);
    // Tag.
    drawText(lead.tag, x, 340, 2, lead.tagColor);
    // Headline, scale 3: 17 chars per line at 320px.
    const headLines = wrap(lead.headline, 17);
    drawBlock(headLines, x, 366, 3, INK, 25);
    // Subline, scale 2: 26 chars per line.
    const subLines = wrap(lead.sub, 26);
    drawBlock(subLines, x, 366 + headLines.length * 25 + 8, 2, GREY, 17);
  });

  // ---- divider + section header
  hline(24, 500, W - 48, INK);
  drawText("AROUND THE WORLD", 24, 516, 2, INK);
  drawText("30 MORE STORIES FROM THE DAY", 24 + textWidth("AROUND THE WORLD", 2) + 24, 516, 2, GREY);

  // ---- grid: 3 columns x 10 rows
  const gridY = 548;
  const rowH = 38;
  const gridColX = [24, 352, 680];
  GRID.forEach((item, idx) => {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    const x = gridColX[col];
    const y = gridY + row * rowH;
    rect(x, y + 3, 10, 10, item.color);
    const labelLines = wrap(item.label, 25);
    drawBlock(labelLines, x + 18, y, 2, INK, 16);
  });

  // ---- timeline strip
  const tlY = 936;
  rect(0, tlY, W, H - tlY, NAVY);
  drawText("TIMELINE (UTC)", 24, tlY + 16, 2, GOLD);
  const tlColW = 236;
  const tlX = [24, 268, 512, 756];
  TIMELINE.forEach((t, i) => {
    const x = tlX[i];
    drawText(t.time, x, tlY + 40, 2, WHITE);
    const lines = wrap(t.text, 20);
    drawBlock(lines, x, tlY + 58, 2, LIGHT, 15);
  });
  void tlColW;
}

// ---------------------------------------------------------------- PNG encode
const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePNG(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  // Scanlines, filter byte 0 (None) each row.
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    raw.set(px.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- main
function main(): void {
  draw();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "entry.png");
  fs.writeFileSync(outPath, encodePNG());
}

main();
