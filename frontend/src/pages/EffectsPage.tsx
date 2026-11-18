import { useState } from "react";
import { Eye, Layers, Play, Search, Sliders, Trash2 } from "lucide-react";
import { api, ControllerProfile, EffectRecord } from "../api";
import { SegmentSimulator } from "../components/SegmentSimulator";

interface Props {
  effects: EffectRecord[];
  profile: ControllerProfile | null;
  onRefresh: () => void;
}

export function EffectsPage({ effects, profile, onRefresh }: Props) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<EffectRecord | null>(null);
  const [previewEffect, setPreviewEffect] = useState<EffectRecord | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const filtered = effects.filter(
    (e) =>
      e.name.toLowerCase().includes(query.toLowerCase()) ||
      e.tags.some((t) => t.toLowerCase().includes(query.toLowerCase()))
  );

  const handleTest = async (id: number) => {
    try {
      await api.applyEffectNow(id);
      setStatusMsg("Sent effect to WLED controller!");
    } catch (e: any) {
      setStatusMsg(`Error: ${e.message}`);
    }
  };

  const handleDelete = async (id: number) => {
    await api.deleteEffect(id);
    if (editing?.id === id) setEditing(null);
    onRefresh();
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    await api.updateEffect(editing.id, {
      name: editing.name,
      source_type: editing.source_type,
      source_url: editing.source_url,
      payload: editing.payload,
      segment_mode: editing.segment_mode,
      tags: editing.tags,
    });
    setStatusMsg(`Saved "${editing.name}"`);
    setEditing(null);
    onRefresh();
  };

  const updateSegField = (segIdx: number, field: string, value: number) => {
    if (!editing) return;
    const segs = [...(editing.payload.seg || [])];
    segs[segIdx] = { ...segs[segIdx], [field]: value };
    setEditing({ ...editing, payload: { ...editing.payload, seg: segs } });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search effects or tags..."
            className="w-full rounded-xl border border-slate-800 bg-slate-900 pl-9 pr-4 py-2 text-sm focus:border-sky-500 focus:outline-none"
          />
        </div>
        {statusMsg && <span className="text-xs text-sky-300">{statusMsg}</span>}
      </div>

      {(previewEffect || filtered[0]) && (
        <div className="sticky top-[61px] z-30 -mx-2 px-2 py-2 bg-slate-950/95 backdrop-blur shadow-lg shadow-slate-950/60">
          <SegmentSimulator
            segments={profile?.segments || []}
            payload={(previewEffect || filtered[0]).payload}
            segmentMode={(previewEffect || filtered[0]).segment_mode}
            effectNames={profile?.effects || []}
            paletteNames={profile?.palettes || []}
            label={`Simulated Output: ${(previewEffect || filtered[0]).name}`}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((eff) => {
          const gradient =
            eff.preview_colors.length >= 2
              ? `linear-gradient(90deg, ${eff.preview_colors.join(", ")})`
              : eff.preview_colors[0] || "#38bdf8";
          const seg0 = eff.payload?.seg?.[0] || {};
          const fxId = Number(seg0.fx ?? 0);
          const palId = Number(seg0.pal ?? 0);
          const fxName = profile?.effects?.[fxId] || `FX #${fxId}`;
          const palName = profile?.palettes?.[palId] || `Palette #${palId}`;

          return (
            <div key={eff.id} className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/80 p-4 space-y-3">
              <div>
                <div className="h-2 w-full rounded-full mb-3" style={{ background: gradient }} />
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-slate-100">{eff.name}</h3>
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] uppercase text-slate-400">
                    {eff.segment_mode}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-sky-300">
                    Effect: <strong>{fxName}</strong> <span className="opacity-60">#{fxId}</span>
                  </span>
                  <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-300">
                    Palette: <strong>{palName}</strong> <span className="opacity-60">#{palId}</span>
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {eff.tags.map((t) => (
                    <span key={t} className="rounded-md bg-slate-800/80 px-1.5 py-0.5 text-[10px] text-slate-300">
                      #{t}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                <button
                  onClick={() => handleTest(eff.id)}
                  className="flex items-center gap-1.5 rounded-lg bg-sky-500/15 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/25"
                >
                  <Play className="h-3.5 w-3.5" /> Test on WLED
                </button>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setPreviewEffect(eff)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-sky-300"
                    title="Simulate output"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setEditing(structuredClone(eff))}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                    title="Edit segments"
                  >
                    <Sliders className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(eff.id)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-rose-400"
                    title="Delete effect"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-800 p-10 text-center text-sm text-slate-400">
          No effects found. Head to the <strong>Import Hub</strong> to import curated, URL, or WLED controller presets.
        </div>
      )}

      {/* Segment / Effect Editor Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Layers className="h-5 w-5 text-sky-400" /> Edit "{editing.name}"
              </h3>
              <button onClick={() => setEditing(null)} className="text-sm text-slate-400 hover:text-white">
                Close
              </button>
            </div>

            <SegmentSimulator
              segments={profile?.segments || []}
              payload={editing.payload}
              segmentMode={editing.segment_mode}
              effectNames={profile?.effects || []}
              paletteNames={profile?.palettes || []}
              compact
              label="Live Editor Preview"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400">Effect Name</label>
                <input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Segment Mode</label>
                <select
                  value={editing.segment_mode}
                  onChange={(e) => setEditing({ ...editing, segment_mode: e.target.value as "mirror" | "custom" })}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                >
                  <option value="mirror">Mirror Segment 0 across all 3 strips</option>
                  <option value="custom">Custom per-segment settings</option>
                </select>
              </div>
            </div>

            <div className="space-y-3">
              {(editing.payload.seg || []).slice(0, editing.segment_mode === "mirror" ? 1 : 3).map((seg: any, idx: number) => {
                const spec = profile?.segments[idx];
                return (
                  <div key={idx} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2">
                    <div className="text-xs font-medium text-sky-300">
                      {editing.segment_mode === "mirror"
                        ? "All 3 Segments (Mirrored · 1078 LEDs)"
                        : `Segment ${idx + 1} (${spec ? `${spec.start}–${spec.stop}, ${spec.len} LEDs` : ""})`}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <div>
                        <label className="text-slate-400">Effect (FX)</label>
                        {profile?.effects?.length ? (
                          <select
                            value={seg.fx ?? 0}
                            onChange={(e) => updateSegField(idx, "fx", Number(e.target.value))}
                            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5"
                          >
                            {profile.effects.map((name, id) => (
                              <option key={id} value={id}>
                                #{id} — {name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="number"
                            value={seg.fx ?? 0}
                            onChange={(e) => updateSegField(idx, "fx", Number(e.target.value))}
                            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1"
                          />
                        )}
                      </div>
                      <div>
                        <label className="text-slate-400">Palette</label>
                        {profile?.palettes?.length ? (
                          <select
                            value={seg.pal ?? 0}
                            onChange={(e) => updateSegField(idx, "pal", Number(e.target.value))}
                            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5"
                          >
                            {profile.palettes.map((name, id) => (
                              <option key={id} value={id}>
                                #{id} — {name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="number"
                            value={seg.pal ?? 0}
                            onChange={(e) => updateSegField(idx, "pal", Number(e.target.value))}
                            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1"
                          />
                        )}
                      </div>
                      <div>
                        <label className="text-slate-400">Speed (sx: {seg.sx ?? 128})</label>
                        <input
                          type="number"
                          min={0}
                          max={255}
                          value={seg.sx ?? 128}
                          onChange={(e) => updateSegField(idx, "sx", Number(e.target.value))}
                          className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1"
                        />
                      </div>
                      <div>
                        <label className="text-slate-400">Intensity (ix: {seg.ix ?? 128})</label>
                        <input
                          type="number"
                          min={0}
                          max={255}
                          value={seg.ix ?? 128}
                          onChange={(e) => updateSegField(idx, "ix", Number(e.target.value))}
                          className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditing(null)} className="rounded-lg border border-slate-700 px-4 py-2 text-sm">
                Cancel
              </button>
              <button onClick={handleSaveEdit} className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400">
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
