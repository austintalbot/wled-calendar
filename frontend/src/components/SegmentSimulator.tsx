import { useEffect, useRef } from "react";
import { SegmentSpec } from "../api";

interface Props {
  segments: SegmentSpec[];
  payload: Record<string, any> | null;
  segmentMode?: "mirror" | "custom";
  effectNames?: string[];
  paletteNames?: string[];
  compact?: boolean;
  label?: string;
}

type Rgb = [number, number, number];

const PALETTE_GRADIENTS: Record<string, Rgb[]> = {
  party: [[255, 0, 128], [0, 200, 255], [255, 210, 0]],
  cloud: [[190, 225, 255], [255, 255, 255], [100, 160, 230]],
  lava: [[255, 20, 0], [255, 130, 0], [60, 0, 0]],
  ocean: [[0, 60, 180], [0, 190, 255], [0, 255, 190]],
  forest: [[0, 110, 25], [30, 210, 60], [180, 240, 80]],
  rainbow: [[255, 0, 0], [0, 255, 90], [40, 80, 255]],
  sunset: [[255, 60, 20], [255, 150, 30], [160, 20, 120]],
  autumn: [[255, 80, 0], [200, 25, 0], [255, 195, 25]],
  pastel: [[210, 160, 255], [140, 255, 210], [255, 185, 210]],
  fire: [[180, 15, 0], [255, 110, 0], [255, 220, 90]],
  icefire: [[0, 160, 255], [255, 255, 255], [255, 90, 0]],
  aurora: [[0, 255, 140], [40, 120, 255], [170, 40, 255]],
  "red & blue": [[255, 0, 0], [255, 255, 255], [0, 50, 255]],
  "orange & teal": [[255, 110, 0], [0, 210, 190], [255, 180, 40]],
};

function resolvePaletteColors(palName: string): Rgb[] | null {
  const lower = palName.toLowerCase();
  for (const [key, colors] of Object.entries(PALETTE_GRADIENTS)) {
    if (lower.includes(key)) return colors;
  }
  return null;
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

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const hn = ((h % 1) + 1) % 1;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    const tn = ((t % 1) + 1) % 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };
  return [
    Math.round(hue2rgb(hn + 1 / 3) * 255),
    Math.round(hue2rgb(hn) * 255),
    Math.round(hue2rgb(hn - 1 / 3) * 255),
  ];
}

function sampleSegmentPixel(
  ledIdx: number,
  ledCount: number,
  timeSec: number,
  seg: Record<string, any>,
  fxName: string,
  palName: string
): Rgb {
  if (seg.on === false) return [12, 16, 24];

  const palColors = resolvePaletteColors(palName);
  const cols = Array.isArray(seg.col) ? seg.col : [];
  const c1 = palColors ? palColors[0] : toRgb(cols[0], [56, 189, 248]);
  const c2 = palColors ? palColors[1] : toRgb(cols[1], [0, 0, 0]);
  const c3 = palColors ? palColors[2] : toRgb(cols[2], [245, 158, 11]);
  const secondary: Rgb = c2[0] + c2[1] + c2[2] > 0 ? c2 : c3;

  const sx = Number(seg.sx ?? 128) / 128;
  const ix = Number(seg.ix ?? 128) / 255;
  const bri = Number(seg.bri ?? 255) / 255;
  const fxId = Number(seg.fx ?? 0);
  const name = fxName.toLowerCase();

  let pos = ledCount > 1 ? ledIdx / (ledCount - 1) : 0;
  if (seg.rev) pos = 1 - pos;
  if (seg.mi) pos = Math.abs(pos * 2 - 1);

  const t = timeSec * (0.4 + sx * 1.4);
  let rgb: Rgb = c1;

  if (fxId === 0 || name === "solid") {
    rgb = c1;
  } else if (name.includes("blink") || name.includes("strobe")) {
    const on = Math.sin(t * 5) > 0;
    rgb = on ? c1 : secondary;
  } else if (name.includes("breathe") || name.includes("heartbeat")) {
    const wave = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * 2.2));
    rgb = lerpRgb([0, 0, 0], lerpRgb(c1, secondary, 0.5 + 0.5 * Math.sin(t * 0.7)), wave);
  } else if (name.includes("rainbow")) {
    rgb = hslToRgb(pos * (1 + ix) - t * 0.25, 0.95, 0.52);
  } else if (name.includes("chase") || name.includes("running") || name.includes("scan") || name.includes("theater")) {
    const band = ((pos * (4 + ix * 8) - t * 1.8) % 1 + 1) % 1;
    rgb = band < 0.35 ? c1 : band < 0.7 ? secondary : [15, 20, 30];
  } else if (name.includes("twinkle") || name.includes("sparkle") || name.includes("firework")) {
    const hash = Math.sin(ledIdx * 12.9898 + Math.floor(t * 4) * 78.233) * 43758.5453;
    const frac = hash - Math.floor(hash);
    if (frac > 0.92 - ix * 0.15) {
      rgb = frac > 0.97 ? [255, 250, 235] : c1;
    } else {
      rgb = lerpRgb([8, 12, 20], secondary, 0.25);
    }
  } else if (name.includes("fire")) {
    const flicker = 0.5 + 0.5 * Math.sin(ledIdx * 0.7 + t * 6) * Math.cos(ledIdx * 0.3 - t * 4);
    rgb = lerpRgb([180, 25, 0], [255, 185, 25], flicker * (0.6 + ix * 0.4));
  } else {
    // Smooth flowing wave between primary, secondary, and tertiary colors
    const w1 = 0.5 + 0.5 * Math.sin(pos * (3 + ix * 5) - t * 1.3);
    const w2 = 0.5 + 0.5 * Math.cos(pos * 2 + t * 0.8);
    rgb = lerpRgb(lerpRgb(c1, secondary, w1), c3, w2 * 0.45);
  }

  return [
    Math.round(rgb[0] * bri),
    Math.round(rgb[1] * bri),
    Math.round(rgb[2] * bri),
  ];
}

export function SegmentSimulator({
  segments,
  payload,
  segmentMode = "mirror",
  effectNames = [],
  paletteNames = [],
  compact = false,
  label,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const activeSegments =
    segments.length > 0
      ? segments
      : [{ id: 0, start: 0, stop: 1078, len: 1078, name: "All LEDs" }];

  const totalLeds = activeSegments.reduce((sum, s) => sum + s.len, 0) || 1078;
  const rawSegs = Array.isArray(payload?.seg) ? payload.seg : [{}];
  const globalOn = payload?.on !== false;
  const globalBri = Number(payload?.bri ?? 255) / 255;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    const startMs = performance.now();

    const render = (nowMs: number) => {
      const timeSec = (nowMs - startMs) / 1000;
      const width = canvas.width;
      const height = canvas.height;
      const rowHeight = height / activeSegments.length;

      ctx.clearRect(0, 0, width, height);

      activeSegments.forEach((spec, idx) => {
        const segPayload =
          segmentMode === "custom" && rawSegs[idx] ? rawSegs[idx] : rawSegs[0] || {};
        const fxId = Number(segPayload.fx ?? 0);
        const palId = Number(segPayload.pal ?? 0);
        const fxName = effectNames[fxId] || `FX ${fxId}`;
        const palName = paletteNames[palId] || `Palette ${palId}`;

        // Proportional width based on segment LED count vs max segment or total LEDs
        const maxLen = Math.max(...activeSegments.map((s) => s.len), 1);
        const barWidth = Math.max(40, (spec.len / maxLen) * (width - 8));
        const dots = Math.min(140, Math.max(24, Math.round((spec.len / maxLen) * 120)));
        const dotStep = barWidth / dots;
        const yCenter = idx * rowHeight + rowHeight / 2;
        const radius = compact ? 2.5 : 3.5;

        // Subtle track background
        ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
        ctx.fillRect(4, yCenter - radius - 2, barWidth, (radius + 2) * 2);

        for (let d = 0; d < dots; d++) {
          const virtualLed = Math.round((d / Math.max(1, dots - 1)) * (spec.len - 1));
          const [r, g, b] = globalOn
            ? sampleSegmentPixel(virtualLed, spec.len, timeSec, segPayload, fxName, palName)
            : [15, 20, 30];

          const rr = Math.round(r * globalBri);
          const gg = Math.round(g * globalBri);
          const bb = Math.round(b * globalBri);

          ctx.fillStyle = `rgb(${rr}, ${gg}, ${bb})`;
          ctx.beginPath();
          ctx.arc(4 + d * dotStep + dotStep / 2, yCenter, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [activeSegments, payload, segmentMode, effectNames, paletteNames, compact, globalOn, globalBri]);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-3 space-y-2">
      <div className="flex items-center justify-between text-[11px] text-slate-400">
        <span className="font-medium text-slate-300">
          {label || `Simulated Output (${activeSegments.length} segments · ${totalLeds} LEDs)`}
        </span>
        <span className="uppercase tracking-wider text-[10px] text-sky-400">{segmentMode}</span>
      </div>

      <canvas
        ref={canvasRef}
        width={640}
        height={activeSegments.length * (compact ? 22 : 28)}
        className="w-full rounded-lg bg-slate-950"
      />

      <div className="flex flex-wrap gap-2 text-[10px] text-slate-400">
        {activeSegments.map((s, idx) => {
          const segPayload = segmentMode === "custom" && rawSegs[idx] ? rawSegs[idx] : rawSegs[0] || {};
          const fxId = Number(segPayload.fx ?? 0);
          const palId = Number(segPayload.pal ?? 0);
          const fxName = effectNames[fxId] || `FX #${fxId}`;
          const palName = paletteNames[palId] || `Pal #${palId}`;
          return (
            <span key={s.id} className="rounded-md bg-slate-900 px-2 py-1 border border-slate-800 flex items-center gap-1.5">
              <span className="text-slate-400">Seg {s.id + 1} ({s.len}):</span>
              <span className="font-medium text-sky-300">{fxName}</span>
              <span className="text-slate-600">·</span>
              <span className="font-medium text-amber-300">{palName}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
