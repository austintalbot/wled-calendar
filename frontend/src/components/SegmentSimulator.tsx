import { useEffect, useMemo, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { SegmentSpec } from "../api";
import { applySegmentTransform, WledSegmentBuffer } from "../utils/wledFxEngine";

interface Props {
  segments: SegmentSpec[];
  payload: Record<string, any> | null;
  segmentMode?: "mirror" | "custom" | "normalized";
  effectNames?: string[];
  paletteNames?: string[];
  paletteColors?: Record<string, any[]>;
  compact?: boolean;
  label?: string;
  defaultLive?: boolean;
  allowLiveToggle?: boolean;
}

export function SegmentSimulator({
  segments,
  payload,
  segmentMode = "mirror",
  effectNames = [],
  paletteNames = [],
  paletteColors,
  compact = false,
  label,
  defaultLive = false,
  allowLiveToggle = true,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveFrameRef = useRef<Uint8Array | null>(null);
  const [useLive, setUseLive] = useState(defaultLive);
  const [liveConnected, setLiveConnected] = useState(false);
  const [liveFailed, setLiveFailed] = useState(false);

  const activeSegments = useMemo(
    () =>
      segments.length > 0
        ? segments
        : [{ id: 0, start: 0, stop: 1078, len: 1078, name: "All LEDs" }],
    [segments]
  );

  const refLen = useMemo(() => {
    const sortedLens = activeSegments.map((s) => s.len).sort((a, b) => a - b);
    return sortedLens[Math.floor(sortedLens.length / 2)] || 1;
  }, [activeSegments]);

  const totalLeds = activeSegments.reduce((sum, s) => sum + s.len, 0) || 1078;
  const rawSegs = Array.isArray(payload?.seg) ? payload.seg : [{}];
  const globalOn = payload?.on !== false;
  const globalBri = Number(payload?.bri ?? 255) / 255;

  // WebSocket live-view connection to FastAPI /api/controller/live-stream
  useEffect(() => {
    if (!useLive) {
      liveFrameRef.current = null;
      setLiveConnected(false);
      setLiveFailed(false);
      return;
    }

    setLiveFailed(false);
    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${wsProto}//${window.location.host}/api/controller/live-stream`);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      setLiveConnected(true);
      setLiveFailed(false);
    };
    ws.onclose = () => {
      setLiveConnected(false);
      setLiveFailed(true);
    };
    ws.onerror = () => {
      setLiveConnected(false);
      setLiveFailed(true);
    };
    ws.onmessage = (evt) => {
      if (evt.data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(evt.data);
        if (bytes.length > 4 && bytes[0] === 0x4c) {
          const headerLen = bytes[1] === 2 ? 4 : 2;
          liveFrameRef.current = bytes.slice(headerLen);
        }
      }
    };

    return () => {
      ws.close();
    };
  }, [useLive]);

  const canvasWidth = 1600;
  const padX = 10;
  const ledPitch = compact ? 13 : 18;
  const ledSize = compact ? 10 : 14;
  const rowPitch = compact ? 15 : 21;
  const segGap = compact ? 8 : 12;
  const cols = Math.max(1, Math.floor((canvasWidth - padX * 2) / ledPitch));

  const segmentLayout = useMemo(() => {
    let y = 8;
    return activeSegments.map((spec) => {
      const rows = Math.max(1, Math.ceil(spec.len / cols));
      const startY = y;
      y += rows * rowPitch + segGap;
      return { spec, rows, startY };
    });
  }, [activeSegments, cols, rowPitch, segGap]);

  const canvasHeight = Math.max(
    48,
    (segmentLayout[segmentLayout.length - 1]?.startY ?? 8) +
      (segmentLayout[segmentLayout.length - 1]?.rows ?? 1) * rowPitch +
      6
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const buffers = activeSegments.map((spec) => new WledSegmentBuffer(spec.len));
    const img = ctx.createImageData(canvasWidth, canvasHeight);
    const data = img.data;

    // Precompute circular radial falloff mask (ledSize x ledSize)
    const radius = ledSize / 2;
    const center = (ledSize - 1) / 2;
    const circleMask = new Float32Array(ledSize * ledSize);
    for (let py = 0; py < ledSize; py++) {
      for (let px = 0; px < ledSize; px++) {
        const dx = px - center;
        const dy = py - center;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= radius * 0.45) {
          circleMask[py * ledSize + px] = 1.0;
        } else if (dist <= radius) {
          circleMask[py * ledSize + px] = Math.max(0.35, 1 - ((dist - radius * 0.45) / (radius * 0.55)) * 0.65);
        } else {
          circleMask[py * ledSize + px] = -1;
        }
      }
    }

    let rafId = 0;
    const startMs = performance.now();
    let lastTickMs = 0;

    const render = (nowMs: number) => {
      if (document.hidden) {
        rafId = requestAnimationFrame(render);
        return;
      }

      const timeSec = (nowMs - startMs) / 1000;
      const liveBytes = useLive ? liveFrameRef.current : null;
      const liveLedCount = liveBytes ? Math.floor(liveBytes.length / 3) : 0;

      // Step WLED FX engine at ~42 FPS (24ms) matching controller fps: 43
      const shouldTick = !liveBytes && nowMs - lastTickMs >= 24;
      if (shouldTick) {
        lastTickMs = nowMs;
      }

      for (let i = 0; i < data.length; i += 4) {
        data[i] = 6;
        data[i + 1] = 9;
        data[i + 2] = 16;
        data[i + 3] = 255;
      }

      segmentLayout.forEach(({ spec, startY }, idx) => {
        const baseSeg =
          segmentMode === "custom" && rawSegs[idx] ? rawSegs[idx] : rawSegs[0] || {};
        const ratio = segmentMode === "normalized" && refLen > 0 ? spec.len / refLen : 1;
        const segPayload =
          segmentMode === "normalized"
            ? {
                ...baseSeg,
                sx: Math.max(1, Math.min(255, Math.round(Number(baseSeg.sx ?? 128) * ratio))),
                ix: Math.max(1, Math.min(255, Math.round(Number(baseSeg.ix ?? 128) * ratio))),
              }
            : baseSeg;
        const fxId = Number(segPayload.fx ?? 0);
        const palId = Number(segPayload.pal ?? 0);
        const fxName = effectNames[fxId] || `FX ${fxId}`;
        const palName = paletteNames[palId] || `Palette ${palId}`;
        const segBri = Number(segPayload.bri ?? 255) / 255;

        const buf = buffers[idx];
        const ledCount = buf.length;
        if (shouldTick) {
          if (globalOn) {
            buf.tick(timeSec, segPayload, fxName, palName, paletteColors);
          } else {
            buf.fill([0, 0, 0]);
          }
        }

        const scale = globalBri * segBri;
        for (let d = 0; d < ledCount; d++) {
          let r = 18;
          let g = 22;
          let b = 34;

          if (liveBytes && liveLedCount > 0) {
            const globalLed = spec.start + d;
            const streamIdx = Math.min(
              liveLedCount - 1,
              Math.floor((globalLed / Math.max(1, totalLeds)) * liveLedCount)
            );
            r = liveBytes[streamIdx * 3];
            g = liveBytes[streamIdx * 3 + 1];
            b = liveBytes[streamIdx * 3 + 2];
          } else if (globalOn) {
            const mappedIdx = applySegmentTransform(d, ledCount, segPayload);
            if (mappedIdx >= 0) {
              r = Math.round(buf.pixels[mappedIdx * 3] * scale);
              g = Math.round(buf.pixels[mappedIdx * 3 + 1] * scale);
              b = Math.round(buf.pixels[mappedIdx * 3 + 2] * scale);
            }
          }

          const coreR = Math.max(18, r);
          const coreG = Math.max(22, g);
          const coreB = Math.max(34, b);

          const col = d % cols;
          const row = Math.floor(d / cols);
          const x0 = padX + col * ledPitch;
          const y0 = startY + row * rowPitch;

          for (let py = 0; py < ledSize; py++) {
            const rowOffset = (y0 + py) * canvasWidth;
            for (let px = 0; px < ledSize; px++) {
              const m = circleMask[py * ledSize + px];
              if (m < 0) continue;
              const p = (rowOffset + x0 + px) * 4;
              data[p] = (coreR * m) | 0;
              data[p + 1] = (coreG * m) | 0;
              data[p + 2] = (coreB * m) | 0;
            }
          }
        }
      });

      ctx.putImageData(img, 0, 0);
      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [activeSegments, segmentLayout, canvasWidth, canvasHeight, cols, ledPitch, ledSize, rowPitch, refLen, payload, segmentMode, effectNames, paletteNames, paletteColors, compact, globalOn, globalBri, useLive, totalLeds]);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
        <span className="font-medium text-slate-300">
          {label || `Output (${activeSegments.length} segments · ${totalLeds} LEDs)`}
        </span>

        <div className="flex items-center gap-2">
          {allowLiveToggle && (
            <button
              type="button"
              onClick={() => setUseLive((v) => !v)}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold border transition ${
                useLive
                  ? liveConnected
                    ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                    : "border-amber-500/50 bg-amber-500/15 text-amber-300"
                  : "border-slate-700 bg-slate-900 text-slate-400 hover:text-white"
              }`}
              title="Toggle between live pixel stream from WLED controller and local WLED FX simulation"
            >
              <Radio className="h-3 w-3" />
              {useLive
                ? liveConnected
                  ? "LIVE WLED"
                  : liveFailed
                    ? "Live Disconnected (Click to Sim)"
                    : "Connecting WLED..."
                : "Simulated (Click for Live)"}
            </button>
          )}
          <span className="uppercase tracking-wider text-[10px] text-sky-400">{segmentMode}</span>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        width={canvasWidth}
        height={canvasHeight}
        className="w-full rounded-lg bg-black/95"
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
