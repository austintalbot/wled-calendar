import { useState } from "react";
import { Eye, Play, Plus, Search, Sliders, Trash2, UploadCloud } from "lucide-react";
import { api, ControllerProfile, EffectRecord } from "../api";
import { SegmentSimulator } from "../components/SegmentSimulator";
import { WledEffectEditorModal } from "../components/WledEffectEditorModal";
import { paletteToCssGradient } from "../utils/wledFxEngine";

interface Props {
  effects: EffectRecord[];
  profile: ControllerProfile | null;
  onRefresh: () => void;
}

export function EffectsPage({ effects, profile, onRefresh }: Props) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ effect: EffectRecord; isNew: boolean } | null>(null);
  const [previewEffect, setPreviewEffect] = useState<EffectRecord | null>(null);
  const [savingEffect, setSavingEffect] = useState<EffectRecord | null>(null);
  const [ctrlPresets, setCtrlPresets] = useState<any[]>([]);
  const [saveSlot, setSaveSlot] = useState<number>(1);
  const [saveName, setSaveName] = useState<string>("");
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
    if (editing?.effect.id === id) setEditing(null);
    onRefresh();
  };

  const openNewEffect = () => {
    setEditing({
      isNew: true,
      effect: {
        id: 0,
        name: "New Custom Effect",
        source_type: "manual",
        source_url: null,
        payload: {
          on: true,
          bri: 255,
          transition: 7,
          seg: [
            {
              fx: 0,
              pal: 0,
              sx: 128,
              ix: 128,
              c1: 128,
              c2: 128,
              c3: 16,
              col: [[255, 160, 0], [0, 0, 0], [0, 0, 0]],
            },
          ],
        },
        segment_mode: "mirror",
        tags: ["custom"],
        preview_colors: ["#ffa000"],
        created_at: "",
      },
    });
  };

  const openSaveToWled = async (eff: EffectRecord) => {
    setSavingEffect(eff);
    setSaveName(eff.name.slice(0, 32));
    try {
      const res = await api.getControllerPresets();
      setCtrlPresets(res.presets);
      const used = new Set(res.presets.map((p) => Number(p.key)));
      let nextFree = 1;
      while (used.has(nextFree) && nextFree < 250) nextFree++;
      setSaveSlot(nextFree);
    } catch {
      setCtrlPresets([]);
      setSaveSlot(1);
    }
  };

  const handleSaveToWled = async () => {
    if (!savingEffect) return;
    try {
      const res = await api.savePresetToController(savingEffect.id, saveSlot, saveName);
      setStatusMsg(`Saved "${res.name}" to WLED slot #${res.slot_id}!`);
      setSavingEffect(null);
    } catch (e: any) {
      setStatusMsg(`Error: ${e.message}`);
    }
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
        <div className="flex items-center gap-3">
          {statusMsg && <span className="text-xs text-sky-300">{statusMsg}</span>}
          <button
            onClick={openNewEffect}
            className="flex items-center gap-1.5 rounded-xl bg-sky-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
          >
            <Plus className="h-4 w-4" /> New Effect
          </button>
        </div>
      </div>

      {(previewEffect || filtered[0]) && (
        <div className="sticky top-[61px] z-30 -mx-2 px-2 py-2 bg-slate-950/95 backdrop-blur shadow-lg shadow-slate-950/60">
          <SegmentSimulator
            segments={profile?.segments || []}
            payload={(previewEffect || filtered[0]).payload}
            segmentMode={(previewEffect || filtered[0]).segment_mode}
            effectNames={profile?.effects || []}
            paletteNames={profile?.palettes || []}
            paletteColors={profile?.palette_colors}
            label={`Simulated Output: ${(previewEffect || filtered[0]).name}`}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((eff) => {
          const seg0 = eff.payload?.seg?.[0] || {};
          const fxId = Number(seg0.fx ?? 0);
          const palId = Number(seg0.pal ?? 0);
          const gradient = paletteToCssGradient(
            palId,
            seg0.col || [],
            profile?.palette_colors,
            eff.preview_colors
          );
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

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                <button
                  onClick={() => handleTest(eff.id)}
                  className="flex items-center gap-1 rounded-lg bg-sky-500/15 px-2.5 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/25"
                >
                  <Play className="h-3.5 w-3.5" /> Apply
                </button>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPreviewEffect(eff)}
                    className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-sky-300"
                    title="Simulate output"
                  >
                    <Eye className="h-3.5 w-3.5" /> Sim
                  </button>
                  <button
                    onClick={() => setEditing({ effect: eff, isNew: false })}
                    className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
                    title="Edit in WLED editor"
                  >
                    <Sliders className="h-3.5 w-3.5" /> Edit
                  </button>
                  <button
                    onClick={() => openSaveToWled(eff)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-emerald-300"
                    title="Save / update preset on WLED controller"
                  >
                    <UploadCloud className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(eff.id)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-rose-400"
                    title="Delete effect"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
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

      {/* WLED-Style Effect Editor Modal */}
      {editing && (
        <WledEffectEditorModal
          effect={editing.effect}
          isNew={editing.isNew}
          profile={profile}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setStatusMsg(`Saved "${saved.name}"`);
            setEditing(null);
            onRefresh();
          }}
        />
      )}
      {/* Save / Update Preset on WLED Controller Modal */}
      {savingEffect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <UploadCloud className="h-5 w-5 text-emerald-400" /> Save Preset to WLED
              </h3>
              <button onClick={() => setSavingEffect(null)} className="text-sm text-slate-400 hover:text-white">
                Close
              </button>
            </div>
            <p className="text-xs text-slate-400">
              Write <strong>{savingEffect.name}</strong> (all 3 segments) to a preset slot on your WLED controller.
            </p>
            <div className="space-y-3 text-sm">
              <div>
                <label className="text-xs text-slate-400">Preset Name on WLED (max 32 chars)</label>
                <input
                  maxLength={32}
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Controller Preset Slot (1–250)</label>
                <input
                  type="number"
                  min={1}
                  max={250}
                  value={saveSlot}
                  onChange={(e) => setSaveSlot(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                />
                {ctrlPresets.find((p) => Number(p.key) === saveSlot) && (
                  <p className="mt-1 text-xs text-amber-300">
                    Will overwrite existing slot #{saveSlot}: "{ctrlPresets.find((p) => Number(p.key) === saveSlot).name}"
                  </p>
                )}
              </div>
              {ctrlPresets.length > 0 && (
                <div className="max-h-32 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/60 p-2 space-y-1">
                  <div className="text-[10px] uppercase text-slate-500 px-1">Existing Controller Slots (click to overwrite)</div>
                  {ctrlPresets.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setSaveSlot(Number(p.key))}
                      className="w-full text-left rounded px-2 py-1 text-xs hover:bg-slate-800 flex justify-between"
                    >
                      <span className="text-slate-200">#{p.key} — {p.name}</span>
                      <span className="text-slate-500">select</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setSavingEffect(null)} className="rounded-lg border border-slate-700 px-4 py-2 text-sm">
                Cancel
              </button>
              <button
                onClick={handleSaveToWled}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400"
              >
                Save to Slot #{saveSlot}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
