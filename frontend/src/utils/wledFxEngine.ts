/**
 * Stateful WLED-inspired FX engine modeled on WLED's FX.cpp / FX_fcn.cpp:
 * - FastLED-style 8-bit math (sin8, triwave8, beat8, beatsin8, fadeToBlackBy)
 * - Multi-stop WLED palette interpolation (pal 0..5 from seg.col + named palettes)
 * - Persistent per-segment RGB pixel buffers for trails, fades, sparkles, fire, meteor, etc.
 * - Segment transforms: grouping (grp), spacing (spc), offset (of), reverse (rev), mirror (mi)
 */

export type Rgb = [number, number, number];

// 256-entry FastLED-style sine lookup (0..255)
const SIN8 = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  SIN8[i] = Math.round((Math.sin((i / 256) * Math.PI * 2) * 0.5 + 0.5) * 255);
}

export function sin8(x: number): number {
  return SIN8[(x | 0) & 255];
}

export function cos8(x: number): number {
  return SIN8[((x | 0) + 64) & 255];
}

export function triwave8(x: number): number {
  const v = (x | 0) & 255;
  return v < 128 ? v * 2 : (255 - v) * 2;
}

export function beat8(bpm: number, timeSec: number): number {
  return ((timeSec * (bpm / 60) * 256) | 0) & 255;
}

export function beatsin8(bpm: number, low: number, high: number, timeSec: number, phase = 0): number {
  const s = sin8(beat8(bpm, timeSec) + phase);
  return Math.round(low + (s / 255) * (high - low));
}

function toRgb(raw: unknown, fallback: Rgb): Rgb {
  if (Array.isArray(raw) && raw.length >= 3) {
    return [
      Math.max(0, Math.min(255, Number(raw[0]) || 0)),
      Math.max(0, Math.min(255, Number(raw[1]) || 0)),
      Math.max(0, Math.min(255, Number(raw[2]) || 0)),
    ];
  }
  return fallback;
}

function hsvToRgb(h: number, s: number, v: number): Rgb {
  const hn = (((h % 256) + 256) % 256) / 256;
  const sn = s / 255;
  const vn = v / 255;
  const i = Math.floor(hn * 6);
  const f = hn * 6 - i;
  const p = vn * (1 - sn);
  const q = vn * (1 - f * sn);
  const t = vn * (1 - (1 - f) * sn);
  let r = 0, g = 0, b = 0;
  switch (i % 6) {
    case 0: r = vn; g = t; b = p; break;
    case 1: r = q; g = vn; b = p; break;
    case 2: r = p; g = vn; b = t; break;
    case 3: r = p; g = q; b = vn; break;
    case 4: r = t; g = p; b = vn; break;
    case 5: r = vn; g = p; b = q; break;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// Multi-stop WLED palette definitions (matching FastLED / WLED palettes.h)
const NAMED_PALETTES: Record<string, Rgb[]> = {
  party: [[85, 0, 171], [171, 0, 85], [255, 85, 0], [171, 171, 0], [0, 255, 0], [0, 171, 85], [0, 0, 255]],
  cloud: [[100, 160, 230], [180, 215, 250], [255, 255, 255], [140, 190, 240], [70, 130, 200]],
  lava: [[0, 0, 0], [120, 0, 0], [220, 30, 0], [255, 130, 0], [255, 230, 80]],
  ocean: [[0, 10, 60], [0, 50, 160], [0, 140, 220], [0, 230, 200], [160, 255, 255]],
  forest: [[0, 40, 0], [0, 110, 20], [30, 190, 40], [120, 230, 60], [200, 255, 100]],
  rainbow: [[255, 0, 0], [255, 160, 0], [255, 255, 0], [0, 255, 0], [0, 200, 255], [40, 0, 255], [180, 0, 255]],
  "sunset 2": [[40, 0, 80], [160, 10, 90], [255, 65, 10], [255, 165, 30], [255, 220, 100]],
  sunset: [[60, 0, 90], [190, 15, 70], [255, 80, 0], [255, 190, 50]],
  rivendell: [[20, 70, 45], [55, 135, 80], [130, 195, 120], [200, 230, 170], [80, 170, 155]],
  breeze: [[30, 110, 190], [90, 195, 255], [200, 245, 255], [60, 170, 220]],
  "red & blue": [[255, 0, 0], [255, 40, 40], [255, 255, 255], [40, 80, 255], [0, 0, 255]],
  yellowout: [[255, 255, 0], [255, 180, 0], [255, 255, 150]],
  pastel: [[220, 160, 255], [160, 230, 255], [150, 255, 210], [255, 230, 160], [255, 175, 205]],
  beach: [[0, 140, 210], [0, 220, 210], [255, 220, 130], [255, 150, 80]],
  vintage: [[255, 190, 110], [210, 130, 70], [140, 200, 170], [90, 130, 150]],
  sherbet: [[255, 100, 160], [255, 170, 110], [255, 230, 110], [130, 240, 185]],
  hult: [[0, 220, 180], [0, 140, 255], [180, 50, 255], [255, 210, 0]],
  autumn: [[140, 15, 0], [220, 50, 0], [255, 120, 0], [255, 200, 25]],
  fire: [[20, 0, 0], [160, 15, 0], [255, 95, 0], [255, 200, 40], [255, 255, 200]],
  icefire: [[0, 80, 255], [100, 210, 255], [255, 255, 255], [255, 140, 20], [200, 30, 0]],
  cyane: [[0, 60, 160], [0, 180, 255], [150, 255, 255]],
  "light pink": [[255, 100, 165], [255, 175, 215], [255, 230, 240]],
  magenta: [[120, 0, 180], [255, 0, 160], [255, 120, 210]],
  yelblu: [[255, 230, 0], [255, 255, 160], [40, 120, 255], [0, 40, 180]],
  "orange & teal": [[255, 95, 0], [255, 180, 40], [0, 210, 190], [0, 110, 130]],
  tiamat: [[0, 255, 200], [40, 120, 255], [170, 40, 255], [255, 60, 130]],
  "april night": [[15, 25, 90], [50, 100, 220], [160, 200, 255], [240, 248, 255]],
};

function resolvePalxStops(
  palId: number,
  segCols: unknown[],
  paletteColors?: Record<string, any[]>
): Array<{ pos: number; rgb: Rgb }> | null {
  const raw = paletteColors?.[String(palId)];
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const c1 = toRgb(segCols[0], [255, 160, 0]);
  const c2 = toRgb(segCols[1], [0, 0, 0]);
  const c3 = toRgb(segCols[2], [0, 0, 0]);

  const stops: Array<{ pos: number; rgb: Rgb }> = [];
  raw.forEach((entry, i) => {
    if (Array.isArray(entry) && entry.length >= 4) {
      stops.push({
        pos: Math.max(0, Math.min(255, Number(entry[0]) || 0)),
        rgb: [
          Math.max(0, Math.min(255, Number(entry[1]) || 0)),
          Math.max(0, Math.min(255, Number(entry[2]) || 0)),
          Math.max(0, Math.min(255, Number(entry[3]) || 0)),
        ],
      });
    } else if (typeof entry === "string") {
      const pos = raw.length > 1 ? Math.round((i / (raw.length - 1)) * 255) : 0;
      const rgb: Rgb =
        entry === "c1" ? c1 : entry === "c2" ? c2 : entry === "c3" ? c3 : hsvToRgb(i * 64, 255, 255);
      stops.push({ pos, rgb });
    }
  });
  return stops.length > 0 ? stops : null;
}

export function paletteToCssGradient(
  palId: number,
  segCols: unknown[] = [],
  paletteColors?: Record<string, any[]>,
  fallbackColors: string[] = ["#38bdf8", "#818cf8"]
): string {
  const stops = resolvePalxStops(palId, segCols, paletteColors);
  if (!stops || stops.length === 0) {
    return fallbackColors.length >= 2
      ? `linear-gradient(90deg, ${fallbackColors.join(", ")})`
      : fallbackColors[0] || "#38bdf8";
  }
  if (stops.length === 1) {
    const [r, g, b] = stops[0].rgb;
    return `rgb(${r}, ${g}, ${b})`;
  }
  const cssStops = stops.map((s) => {
    const pct = Math.round((s.pos / 255) * 100);
    return `rgb(${s.rgb[0]}, ${s.rgb[1]}, ${s.rgb[2]}) ${pct}%`;
  });
  return `linear-gradient(90deg, ${cssStops.join(", ")})`;
}

export function colorFromPalette(
  palName: string,
  palId: number,
  index: number,
  segCols: unknown[],
  bri = 255,
  paletteColors?: Record<string, any[]>
): Rgb {
  const palxStops = resolvePalxStops(palId, segCols, paletteColors);
  const idx255 = (index | 0) & 255;
  const scale = bri / 255;

  if (palxStops) {
    if (palxStops.length === 1) {
      return [
        Math.round(palxStops[0].rgb[0] * scale),
        Math.round(palxStops[0].rgb[1] * scale),
        Math.round(palxStops[0].rgb[2] * scale),
      ];
    }
    let left = palxStops[0];
    let right = palxStops[palxStops.length - 1];
    for (let i = 0; i < palxStops.length - 1; i++) {
      if (idx255 >= palxStops[i].pos && idx255 <= palxStops[i + 1].pos) {
        left = palxStops[i];
        right = palxStops[i + 1];
        break;
      }
    }
    if (idx255 >= right.pos) {
      left = palxStops[palxStops.length - 1];
      right = palxStops[palxStops.length - 1];
    }
    const span = Math.max(1, right.pos - left.pos);
    const frac = Math.max(0, Math.min(1, (idx255 - left.pos) / span));
    return [
      Math.round((left.rgb[0] + (right.rgb[0] - left.rgb[0]) * frac) * scale),
      Math.round((left.rgb[1] + (right.rgb[1] - left.rgb[1]) * frac) * scale),
      Math.round((left.rgb[2] + (right.rgb[2] - left.rgb[2]) * frac) * scale),
    ];
  }

  const c0 = toRgb(segCols[0], [255, 160, 0]);
  const c1 = toRgb(segCols[1], [0, 0, 0]);
  const c2 = toRgb(segCols[2], [0, 0, 0]);
  const idx = idx255 / 255;

  let stops: Rgb[] | null = null;
  const lower = palName.toLowerCase();

  if (palId <= 5 || lower === "default" || lower.startsWith("* color")) {
    const hasC1 = c1[0] + c1[1] + c1[2] > 0;
    const hasC2 = c2[0] + c2[1] + c2[2] > 0;
    if (palId === 2) {
      stops = [c0, c0];
    } else if (palId === 3) {
      stops = [c0, hasC1 ? c1 : [0, 0, 0]];
    } else {
      stops = [c0, hasC1 ? c1 : c0, hasC2 ? c2 : (hasC1 ? c1 : c0)];
    }
  } else {
    for (const [k, s] of Object.entries(NAMED_PALETTES)) {
      if (lower.includes(k)) {
        stops = s;
        break;
      }
    }
  }

  if (!stops) {
    stops = [c0, c1[0] + c1[1] + c1[2] > 0 ? c1 : [0, 120, 255], c2[0] + c2[1] + c2[2] > 0 ? c2 : c0];
  }

  const scaled = idx * (stops.length - 1);
  const i0 = Math.floor(scaled);
  const i1 = Math.min(stops.length - 1, i0 + 1);
  const frac = scaled - i0;

  return [
    Math.round((stops[i0][0] + (stops[i1][0] - stops[i0][0]) * frac) * scale),
    Math.round((stops[i0][1] + (stops[i1][1] - stops[i0][1]) * frac) * scale),
    Math.round((stops[i0][2] + (stops[i1][2] - stops[i0][2]) * frac) * scale),
  ];
}

export class WledSegmentBuffer {
  readonly length: number;
  readonly pixels: Uint8ClampedArray;
  private step = 0;
  private aux0 = 0;

  constructor(length: number) {
    this.length = Math.max(1, length);
    this.pixels = new Uint8ClampedArray(this.length * 3);
  }

  fadeToBlackBy(amount: number): void {
    const keep = Math.max(0, 1 - amount / 255);
    for (let i = 0; i < this.pixels.length; i++) {
      this.pixels[i] = (this.pixels[i] * keep) | 0;
    }
  }

  fill(rgb: Rgb): void {
    for (let i = 0; i < this.length; i++) {
      this.pixels[i * 3] = rgb[0];
      this.pixels[i * 3 + 1] = rgb[1];
      this.pixels[i * 3 + 2] = rgb[2];
    }
  }

  setPixel(i: number, rgb: Rgb): void {
    if (i < 0 || i >= this.length) return;
    this.pixels[i * 3] = rgb[0];
    this.pixels[i * 3 + 1] = rgb[1];
    this.pixels[i * 3 + 2] = rgb[2];
  }

  addPixel(i: number, rgb: Rgb): void {
    if (i < 0 || i >= this.length) return;
    this.pixels[i * 3] = Math.min(255, this.pixels[i * 3] + rgb[0]);
    this.pixels[i * 3 + 1] = Math.min(255, this.pixels[i * 3 + 1] + rgb[1]);
    this.pixels[i * 3 + 2] = Math.min(255, this.pixels[i * 3 + 2] + rgb[2]);
  }

  tick(
    timeSec: number,
    seg: Record<string, any>,
    fxName: string,
    palName: string,
    paletteColors?: Record<string, any[]>
  ): void {
    if (seg.on === false) {
      this.fill([0, 0, 0]);
      return;
    }

    const fxId = Number(seg.fx ?? 0);
    const palId = Number(seg.pal ?? 0);
    const sx = Number(seg.sx ?? 128);
    const ix = Number(seg.ix ?? 128);
    const cols = Array.isArray(seg.col) ? seg.col : [];
    const c1 = toRgb(cols[0], [255, 160, 0]);
    const c2 = toRgb(cols[1], [0, 0, 0]);
    const bpm = 12 + (sx / 255) * 90;
    const name = fxName.toLowerCase();
    const len = this.length;

    this.step++;

    // 0: Solid
    if (fxId === 0 || name === "solid") {
      this.fill(c1);
      return;
    }

    // 1: Blink / Strobe
    if (name.includes("blink") || name.includes("strobe")) {
      const on = beat8(bpm * 1.5, timeSec) < 128;
      const useRainbow = name.includes("rainbow");
      const fg = useRainbow ? hsvToRgb(beat8(20, timeSec), 255, 255) : c1;
      this.fill(on ? fg : c2);
      return;
    }

    // 2: Breathe / Heartbeat
    if (name.includes("breathe") || name.includes("heartbeat")) {
      const b = beatsin8(bpm * 0.6, 15, 255, timeSec);
      for (let i = 0; i < len; i++) {
        const palIdx = palId === 0 ? 0 : Math.round((i / Math.max(1, len - 1)) * 255);
        this.setPixel(i, colorFromPalette(palName, palId, palIdx, cols, b, paletteColors));
      }
      return;
    }

    // 9: Rainbow
    if (name === "rainbow" || name === "rainbow runner") {
      const offset = beat8(bpm * 0.8, timeSec);
      const delta = 1 + Math.round((ix / 255) * 6);
      for (let i = 0; i < len; i++) {
        this.setPixel(i, hsvToRgb(offset + i * delta, 255, 255));
      }
      return;
    }

    // 10-11, 40-41: Scan / Scanner / Lighthouse / Sinelon
    if (name.includes("scan") || name.includes("lighthouse") || name.includes("sinelon")) {
      this.fadeToBlackBy(Math.max(12, 95 - Math.round((ix / 255) * 80)));
      const pos = Math.round((beatsin8(bpm, 0, 255, timeSec) / 255) * (len - 1));
      const col = colorFromPalette(palName, palId, beat8(15, timeSec), cols, 255, paletteColors);
      this.setPixel(pos, col);
      if (name.includes("dual")) {
        this.setPixel(len - 1 - pos, col);
      }
      return;
    }

    // 13-14: Theater / Theater Rainbow / Chase / Running
    if (name.includes("theater") || name.includes("chase") || name.includes("running") || name.includes("candy")) {
      const shift = Math.floor(timeSec * (2 + (sx / 255) * 20));
      const spacing = name.includes("theater") ? 3 : Math.max(2, 8 - Math.round((ix / 255) * 5));
      for (let i = 0; i < len; i++) {
        const active = (i + shift) % spacing === 0;
        if (active) {
          const palIdx = name.includes("rainbow")
            ? (i * 5 + shift * 4) & 255
            : Math.round((i / Math.max(1, len - 1)) * 255);
          this.setPixel(i, colorFromPalette(palName, palId, palIdx, cols, 255, paletteColors));
        } else {
          this.setPixel(i, c2);
        }
      }
      return;
    }

    // 17-22, 80-81: Twinkle / Sparkle / Twinklefox / Fireworks
    if (
      name.includes("twinkle") ||
      name.includes("sparkle") ||
      name.includes("firework") ||
      name.includes("popcorn")
    ) {
      const fadeRate = name.includes("twinklefox") ? 18 : 28 + Math.round((1 - ix / 255) * 35);
      this.fadeToBlackBy(fadeRate);
      if (name.includes("sparkle+") || name.includes("twinkle")) {
        // Gentle background glow in secondary color
        for (let i = 0; i < len; i++) {
          if (this.pixels[i * 3] + this.pixels[i * 3 + 1] + this.pixels[i * 3 + 2] < 12) {
            this.setPixel(i, [c2[0] >> 3, c2[1] >> 3, c2[2] >> 3]);
          }
        }
      }
      const spawns = Math.max(1, Math.round((ix / 255) * (len * 0.08)));
      if (this.step % Math.max(1, Math.round(4 - (sx / 255) * 3)) === 0) {
        for (let s = 0; s < spawns; s++) {
          const idx = Math.floor(Math.random() * len);
          const col = colorFromPalette(palName, palId, Math.floor(Math.random() * 256), cols, 255, paletteColors);
          this.setPixel(idx, col);
        }
      }
      return;
    }

    // 66: Fire 2012 / Fire Flicker
    if (name.includes("fire")) {
      this.fadeToBlackBy(35);
      for (let i = 0; i < len; i++) {
        const heat = Math.min(255, Math.max(0, sin8(i * 19 + this.step * 7) * 0.55 + Math.random() * (90 + ix * 0.45)));
        this.setPixel(i, colorFromPalette("fire", 35, heat, cols));
      }
      return;
    }

    // 76: Meteor / Comet
    if (name.includes("meteor") || name.includes("comet")) {
      this.fadeToBlackBy(Math.max(15, 70 - Math.round((ix / 255) * 50)));
      this.aux0 = (this.aux0 + Math.max(1, Math.round((sx / 255) * 3))) % len;
      const col = colorFromPalette(palName, palId, (this.aux0 * 4) & 255, cols, 255, paletteColors);
      this.setPixel(this.aux0, col);
      return;
    }

    // 67 / 75 / 38: Colorwaves / Lake / Aurora / Palette / Gradient / Default WLED Palette Wave
    const phase = beat8(bpm * 0.7, timeSec);
    const freq = 1 + Math.round((ix / 255) * 5);
    for (let i = 0; i < len; i++) {
      const wave = sin8(i * freq + phase);
      const palIdx = (wave + ((i * 255) / len) * 0.5) & 255;
      this.setPixel(i, colorFromPalette(palName, palId, palIdx, cols, 255, paletteColors));
    }
  }
}

export function applySegmentTransform(
  logicalIdx: number,
  totalLogical: number,
  seg: Record<string, any>
): number {
  const grp = Math.max(1, Number(seg.grp ?? 1));
  const spc = Math.max(0, Number(seg.spc ?? 0));
  const of = Number(seg.of ?? 0);
  let i = logicalIdx;
  if (seg.rev) i = totalLogical - 1 - i;
  if (seg.mi) {
    const half = Math.floor(totalLogical / 2);
    i = i < half ? i : totalLogical - 1 - i;
  }
  const stride = grp + spc;
  if (stride > 1 && i % stride >= grp) {
    return -1; // spaced-off pixel
  }
  return ((i + of) % totalLogical + totalLogical) % totalLogical;
}
