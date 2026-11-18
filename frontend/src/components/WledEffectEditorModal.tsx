import { useEffect, useRef, useState } from "react";
import { Layers, Play, Power, Search, Sparkles } from "lucide-react";
import { api, ControllerProfile, EffectRecord } from "../api";
import { paletteToCssGradient } from "../utils/wledFxEngine";
import { SegmentSimulator } from "./SegmentSimulator";

interface Props {
  effect: EffectRecord;
  isNew?: boolean;
  profile: ControllerProfile | null;
  onClose: () => void;
  onSaved: (saved: EffectRecord) => void;
}

function rgbToHex(rgb: unknown): string {
  if (!Array.isArray(rgb) || rgb.length < 3) return "#ffffff";
  const [r, g, b] = rgb.slice(0, 3).map((v) => Math.max(0, Math.min(255, Number(v) || 0)));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return [255, 255, 255];
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

interface FxMeta {
  sliders: { key: "sx" | "ix" | "c1" | "c2" | "c3"; label: string; defaultVal: number; enabled: boolean }[];
  colors: { label: string; enabled: boolean }[];
  usesPalette: boolean;
}

function parseFxMeta(raw: string | undefined, fxId: number): FxMeta {
  if (fxId === 0 || raw === "") {
    return {
      sliders: [
        { key: "sx", label: "Effect Speed", defaultVal: 128, enabled: false },
        { key: "ix", label: "Effect Intensity", defaultVal: 128, enabled: false },
      ],
      colors: [
        { label: "Color 1", enabled: true },
        { label: "Color 2", enabled: false },
        { label: "Color 3", enabled: false },
      ],
      usesPalette: false,
    };
  }
  if (!raw) {
    return {
      sliders: [
        { key: "sx", label: "Effect Speed", defaultVal: 128, enabled: true },
        { key: "ix", label: "Effect Intensity", defaultVal: 128, enabled: true },
        { key: "c1", label: "Custom 1", defaultVal: 128, enabled: true },
        { key: "c2", label: "Custom 2", defaultVal: 128, enabled: true },
        { key: "c3", label: "Custom 3", defaultVal: 16, enabled: true },
      ],
      colors: [
        { label: "C1", enabled: true },
        { label: "C2", enabled: true },
        { label: "C3", enabled: true },
      ],
      usesPalette: true,
    };
  }

  const [sliderPart = "", colorPart = "", palPart = ""] = raw.split(";");
  const sTokens = sliderPart.split(",");
  const defaults = [
    { key: "sx" as const, fallback: "Effect Speed", defaultVal: 128 },
    { key: "ix" as const, fallback: "Effect Intensity", defaultVal: 128 },
    { key: "c1" as const, fallback: "Custom 1", defaultVal: 128 },
    { key: "c2" as const, fallback: "Custom 2", defaultVal: 128 },
    { key: "c3" as const, fallback: "Custom 3", defaultVal: 16 },
  ];
  const sliders = defaults.map((d, idx) => {
    const tok = (sTokens[idx] || "").trim();
    return {
      key: d.key,
      label: tok === "!" ? d.fallback : tok || d.fallback,
      defaultVal: d.defaultVal,
      enabled: tok !== "",
    };
  });

  const cTokens = colorPart.split(",");
  const colors = [0, 1, 2].map((idx) => {
    const tok = (cTokens[idx] || "").trim();
    return {
      label: tok === "!" ? `C${idx + 1}` : tok || `C${idx + 1}`,
      enabled: tok !== "",
    };
  });

  return {
    sliders,
    colors,
    usesPalette: palPart.trim() !== "",
  };
}

export function WledEffectEditorModal({ effect, isNew = false, profile, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<EffectRecord>(() => structuredClone(effect));
  const [activeSegIdx, setActiveSegIdx] = useState(0);
  const [fxFilter, setFxFilter] = useState("");
  const [palFilter, setPalFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const activeFxRef = useRef<HTMLButtonElement | null>(null);
  const activePalRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeFxRef.current?.scrollIntoView({ block: "center" });
    activePalRef.current?.scrollIntoView({ block: "center" });
  }, [activeSegIdx, draft.segment_mode]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const segs: Record<string, any>[] = Array.isArray(draft.payload?.seg) && draft.payload.seg.length > 0
    ? draft.payload.seg
    : [{ fx: 0, pal: 0, sx: 128, ix: 128, c1: 128, c2: 128, c3: 16, col: [[255, 160, 0], [0, 0, 0], [0, 0, 0]] }];

  const currentSegIdx = draft.segment_mode === "custom" ? Math.min(activeSegIdx, segs.length - 1) : 0;
  const seg = segs[currentSegIdx] || {};
  const fxId = Number(seg.fx ?? 0);
  const fxMeta = parseFxMeta(profile?.fx_data?.[fxId], fxId);

  const updatePayload = (patch: Record<string, any>) => {
    setDraft((prev) => ({
      ...prev,
      payload: { ...prev.payload, ...patch },
    }));
  };

  const updateSeg = (patch: Record<string, any>) => {
    setDraft((prev) => {
      const nextSegs = [...(prev.payload?.seg || [{}])];
      nextSegs[currentSegIdx] = { ...nextSegs[currentSegIdx], ...patch };
      return { ...prev, payload: { ...prev.payload, seg: nextSegs } };
    });
  };

  const updateColorSlot = (slotIdx: number, hex: string) => {
    const cols = Array.isArray(seg.col) ? [...seg.col] : [[255, 255, 255], [0, 0, 0], [0, 0, 0]];
    while (cols.length < 3) cols.push([0, 0, 0]);
    cols[slotIdx] = hexToRgb(hex);
    updateSeg({ col: cols });
  };

  const handleLiveTest = async () => {
    setBusy(true);
    try {
      await api.applyPayloadNow(draft.payload, draft.segment_mode);
      setToast("Sent live preview to WLED controller!");
    } catch (e: any) {
      setToast(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    setBusy(true);
    try {
      const res = isNew
        ? await api.createEffect({
            name: draft.name,
            source_type: "manual",
            payload: draft.payload,
            segment_mode: draft.segment_mode,
            tags: draft.tags,
          })
        : await api.updateEffect(draft.id, {
            name: draft.name,
            source_type: draft.source_type,
            source_url: draft.source_url,
            payload: draft.payload,
            segment_mode: draft.segment_mode,
            tags: draft.tags,
          });
      onSaved(res.effect);
    } catch (e: any) {
      setToast(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const effectList = profile?.effects?.length
    ? profile.effects.map((name, id) => ({ id, name }))
    : Array.from({ length: 120 }, (_, id) => ({ id, name: `Effect #${id}` }));

  const paletteList = profile?.palettes?.length
    ? profile.palettes.map((name, id) => ({ id, name }))
    : Array.from({ length: 60 }, (_, id) => ({ id, name: `Palette #${id}` }));

  const filteredFx = effectList.filter(
    (item) => item.name.toLowerCase().includes(fxFilter.toLowerCase()) || String(item.id) === fxFilter.trim()
  );
  const filteredPal = paletteList.filter(
    (item) => item.name.toLowerCase().includes(palFilter.toLowerCase()) || String(item.id) === palFilter.trim()
  );

  const globalBri = Number(draft.payload?.bri ?? 255);
  const globalOn = draft.payload?.on !== false;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="WLED Effect Editor"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-5"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-6xl rounded-2xl border border-slate-700 bg-slate-900 p-5 space-y-4 max-h-[94vh] overflow-y-auto"
      >
        {/* Top Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-3 flex-1 min-w-[220px]">
            <Layers className="h-5 w-5 text-sky-400 shrink-0" />
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="w-full max-w-sm rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-base font-semibold"
              placeholder="Effect Name"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => updatePayload({ on: !globalOn })}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border ${
                globalOn
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                  : "border-slate-700 bg-slate-950 text-slate-400"
              }`}
            >
              <Power className="h-3.5 w-3.5" /> {globalOn ? "Power On" : "Power Off"}
            </button>

            <select
              value={draft.segment_mode}
              onChange={(e) => setDraft({ ...draft, segment_mode: e.target.value as "mirror" | "custom" | "normalized" })}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs"
            >
              <option value="mirror">Mirror All 3 Segments</option>
              <option value="normalized">Sync Speed / Density Across Strands</option>
              <option value="custom">Custom Per-Segment</option>
            </select>

            <button
              type="button"
              disabled={busy}
              onClick={handleLiveTest}
              className="flex items-center gap-1.5 rounded-lg bg-sky-500/20 border border-sky-500/40 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/30"
            >
              <Play className="h-3.5 w-3.5" /> Preview on WLED
            </button>

            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={handleSave}
              className="rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
            >
              {isNew ? "Create Effect" : "Save Changes"}
            </button>
          </div>
        </div>

        {toast && <div className="text-xs text-sky-300">{toast}</div>}

        {/* Live Simulated Output */}
        <SegmentSimulator
          segments={profile?.segments || []}
          payload={draft.payload}
          segmentMode={draft.segment_mode}
          effectNames={profile?.effects || []}
          paletteNames={profile?.palettes || []}
          paletteColors={profile?.palette_colors}
          compact
          label="WLED Live Editor Simulator"
        />

        {/* Segment Selector Tabs (in custom mode) */}
        {draft.segment_mode === "custom" && (
          <div className="flex flex-wrap gap-2">
            {(profile?.segments?.length ? profile.segments : segs.map((_, i) => ({ id: i, start: 0, stop: 0, len: 0 }))).map(
              (spec, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setActiveSegIdx(idx)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium border ${
                    currentSegIdx === idx
                      ? "border-sky-400 bg-sky-500/20 text-sky-200"
                      : "border-slate-800 bg-slate-950 text-slate-400 hover:text-white"
                  }`}
                >
                  Segment {idx + 1} {spec.len ? `(${spec.start}–${spec.stop} · ${spec.len} LEDs)` : ""}
                </button>
              )
            )}
          </div>
        )}

        {/* WLED 3-Column App Layout: Controls | Effects | Palettes */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Column 1: Colors & Sliders */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-4">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-300 font-medium">Master Brightness</span>
                <span className="text-sky-300 font-mono">{globalBri} ({Math.round((globalBri / 255) * 100)}%)</span>
              </div>
              <input
                type="range"
                min={1}
                max={255}
                value={globalBri}
                onChange={(e) => updatePayload({ bri: Number(e.target.value) })}
                className="w-full accent-sky-400"
              />
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-slate-300">Color Slots</div>
              <div className="grid grid-cols-3 gap-2">
                {[0, 1, 2].map((slotIdx) => {
                  const hex = rgbToHex(seg.col?.[slotIdx]);
                  const meta = fxMeta.colors[slotIdx];
                  return (
                    <label
                      key={slotIdx}
                      className={`flex flex-col items-center gap-1 rounded-lg border p-2 transition ${
                        meta.enabled
                          ? "border-slate-800 bg-slate-900 cursor-pointer"
                          : "border-slate-800/50 bg-slate-950 opacity-40 cursor-not-allowed"
                      }`}
                      title={meta.enabled ? meta.label : "Unused by this effect"}
                    >
                      <input
                        type="color"
                        disabled={!meta.enabled}
                        value={hex}
                        onChange={(e) => updateColorSlot(slotIdx, e.target.value)}
                        className="h-8 w-full cursor-pointer rounded bg-transparent border-0 disabled:cursor-not-allowed"
                      />
                      <span className="text-[10px] font-mono text-slate-300 truncate max-w-full">
                        {meta.enabled ? `${meta.label} ${hex}` : "Unused"}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {fxMeta.sliders
              .filter((s) => s.enabled)
              .map((slider) => {
                const val = Number(seg[slider.key] ?? slider.defaultVal);
                return (
                  <div key={slider.key}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="text-slate-300">{slider.label}</span>
                      <span className="text-slate-200 font-mono">{val}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={255}
                      value={val}
                      onChange={(e) => updateSeg({ [slider.key]: Number(e.target.value) })}
                      className="w-full accent-amber-400"
                    />
                  </div>
                );
              })}

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => updateSeg({ rev: !seg.rev })}
                className={`rounded-lg px-3 py-1 text-xs border ${
                  seg.rev ? "border-sky-400 bg-sky-500/20 text-sky-200" : "border-slate-700 bg-slate-900 text-slate-400"
                }`}
              >
                Reverse: {seg.rev ? "ON" : "OFF"}
              </button>
              <button
                type="button"
                onClick={() => updateSeg({ mi: !seg.mi })}
                className={`rounded-lg px-3 py-1 text-xs border ${
                  seg.mi ? "border-sky-400 bg-sky-500/20 text-sky-200" : "border-slate-700 bg-slate-900 text-slate-400"
                }`}
              >
                Mirror: {seg.mi ? "ON" : "OFF"}
              </button>
            </div>
          </div>

          {/* Column 2: Searchable Effects List (WLED Style) */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 flex flex-col h-[340px]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-sky-300 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" /> Effects ({effectList.length})
              </span>
              <span className="text-[11px] text-slate-400">Active: #{Number(seg.fx ?? 0)}</span>
            </div>
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
              <input
                value={fxFilter}
                onChange={(e) => setFxFilter(e.target.value)}
                placeholder="Filter effects..."
                className="w-full rounded-lg border border-slate-800 bg-slate-900 pl-8 pr-3 py-1.5 text-xs"
              />
            </div>
            <div className="flex-1 overflow-y-auto space-y-1 pr-1">
              {filteredFx.map((item) => {
                const selected = Number(seg.fx ?? 0) === item.id;
                return (
                  <button
                    key={item.id}
                    ref={selected ? activeFxRef : undefined}
                    type="button"
                    onClick={() => updateSeg({ fx: item.id })}
                    className={`w-full text-left rounded-lg px-2.5 py-1.5 text-xs flex items-center justify-between transition ${
                      selected
                        ? "bg-sky-500 text-slate-950 font-semibold"
                        : "text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    <span className="truncate">{item.name}</span>
                    <span className={`text-[10px] font-mono ${selected ? "text-slate-900" : "text-slate-500"}`}>
                      #{item.id}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Column 3: Searchable Palettes List (WLED Style) */}
          <div className={`rounded-xl border border-slate-800 bg-slate-950/70 p-4 flex flex-col h-[340px] ${fxMeta.usesPalette ? "" : "opacity-50"}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-amber-300">
                Color Palettes ({paletteList.length})
              </span>
              <span className="text-[11px] text-slate-400">
                {fxMeta.usesPalette ? `Active: #${Number(seg.pal ?? 0)}` : "Unused by FX"}
              </span>
            </div>
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
              <input
                value={palFilter}
                onChange={(e) => setPalFilter(e.target.value)}
                placeholder="Filter palettes..."
                className="w-full rounded-lg border border-slate-800 bg-slate-900 pl-8 pr-3 py-1.5 text-xs"
              />
            </div>
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {filteredPal.map((item) => {
                const selected = Number(seg.pal ?? 0) === item.id;
                const palGrad = paletteToCssGradient(item.id, seg.col || [], profile?.palette_colors);
                return (
                  <button
                    key={item.id}
                    ref={selected ? activePalRef : undefined}
                    type="button"
                    onClick={() => updateSeg({ pal: item.id })}
                    className={`w-full text-left rounded-lg px-2.5 py-1.5 text-xs space-y-1 transition ${
                      selected
                        ? "bg-amber-400 text-slate-950 font-semibold"
                        : "text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="truncate">{item.name}</span>
                      <span className={`text-[10px] font-mono ${selected ? "text-slate-900" : "text-slate-500"}`}>
                        #{item.id}
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full" style={{ background: palGrad }} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
