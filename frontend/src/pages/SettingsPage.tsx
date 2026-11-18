import { useEffect, useState } from "react";
import { Cpu, RefreshCw, Save, ScrollText } from "lucide-react";
import { api, ControllerProfile, EffectRecord, ExecutionLog } from "../api";
import { SegmentSimulator } from "../components/SegmentSimulator";

interface Props {
  profile: ControllerProfile | null;
  liveState: Record<string, any> | null;
  effects: EffectRecord[];
  onRefreshController: () => void;
}

export function SettingsPage({ profile, liveState, effects, onRefreshController }: Props) {
  const [host, setHost] = useState(profile?.host || "192.168.68.200");
  const [lat, setLat] = useState(profile?.latitude ?? 43.45);
  const [lon, setLon] = useState(profile?.longitude ?? -112.03);
  const [tz, setTz] = useState(profile?.timezone || "America/Boise");
  const [defaultEffectId, setDefaultEffectId] = useState<number>(effects[0]?.id || 0);
  const [defaultTrigger, setDefaultTrigger] = useState<"sunset" | "fixed_time">("sunset");
  const [defaultTime, setDefaultTime] = useState("18:00");
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setHost(profile.host);
      setLat(profile.latitude);
      setLon(profile.longitude);
      setTz(profile.timezone);
    }
  }, [profile]);

  useEffect(() => {
    if (effects.length && defaultEffectId === 0) {
      setDefaultEffectId(effects[0].id);
    }
  }, [effects]);

  useEffect(() => {
    api.listLogs().then((r) => setLogs(r.logs)).catch(console.error);
  }, []);

  const handleSaveSettings = async () => {
    await api.updateControllerSettings({ host, latitude: lat, longitude: lon, timezone: tz });
    setMsg("Saved controller & location settings.");
    onRefreshController();
  };

  const handleSync = async () => {
    try {
      await api.syncController();
      setMsg("Synced hardware segments, effects, and palettes from WLED!");
      onRefreshController();
    } catch (e: any) {
      setMsg(`Sync failed: ${e.message}`);
    }
  };

  const handleSetDefaultRule = async () => {
    if (!defaultEffectId) return;
    await api.createRule({
      rule_type: "default",
      effect_id: defaultEffectId,
      trigger_type: defaultTrigger,
      trigger_time: defaultTrigger === "fixed_time" ? defaultTime : null,
    });
    setMsg("Updated daily fallback rule!");
  };

  return (
    <div className="space-y-6">
      {msg && (
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-200">{msg}</div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2">
              <Cpu className="h-5 w-5 text-sky-400" /> WLED Controller Settings
            </h3>
            <button
              onClick={handleSync}
              className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs hover:bg-slate-700"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Sync Hardware
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <label className="text-xs text-slate-400">Controller IP / Host</label>
              <input value={host} onChange={(e) => setHost(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-slate-400">Timezone</label>
              <input value={tz} onChange={(e) => setTz(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-slate-400">Latitude (Sunset/Sunrise)</label>
              <input type="number" step="0.01" value={lat} onChange={(e) => setLat(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-slate-400">Longitude (Sunset/Sunrise)</label>
              <input type="number" step="0.01" value={lon} onChange={(e) => setLon(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
            </div>
          </div>

          <button
            onClick={handleSaveSettings}
            className="flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400"
          >
            <Save className="h-4 w-4" /> Save Settings
          </button>

          {profile && (
            <div className="border-t border-slate-800 pt-4 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Detected Segments ({profile.led_count} Total LEDs · WLED {profile.version})
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {profile.segments.map((s) => (
                  <div key={s.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5 text-xs">
                    <div className="font-semibold text-sky-300">Seg {s.id + 1}</div>
                    <div className="text-slate-300">{s.start} – {s.stop} ({s.len} LEDs)</div>
                    {s.pin !== null && s.pin !== undefined && <div className="text-slate-500">GPIO {s.pin}</div>}
                  </div>
                ))}
              </div>
              {liveState && (
                <SegmentSimulator
                  segments={profile.segments}
                  payload={liveState}
                  segmentMode="custom"
                  effectNames={profile.effects}
                  paletteNames={profile.palettes}
                  compact
                  label="Live Controller Output (192.168.68.200)"
                />
              )}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 space-y-4">
            <h3 className="font-semibold">Daily Fallback Rule</h3>
            <p className="text-xs text-slate-400">
              Runs every day unless overridden by a specific date, holiday, or Google Calendar event.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <select
                value={defaultEffectId}
                onChange={(e) => setDefaultEffectId(Number(e.target.value))}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              >
                {effects.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <select
                  value={defaultTrigger}
                  onChange={(e) => setDefaultTrigger(e.target.value as any)}
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm"
                >
                  <option value="sunset">At Sunset</option>
                  <option value="fixed_time">Fixed Time</option>
                </select>
                {defaultTrigger === "fixed_time" && (
                  <input
                    type="time"
                    value={defaultTime}
                    onChange={(e) => setDefaultTime(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm"
                  />
                )}
              </div>
            </div>
            <button
              disabled={!defaultEffectId}
              onClick={handleSetDefaultRule}
              className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              Set Daily Default
            </button>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 space-y-3">
            <h3 className="font-semibold flex items-center gap-2">
              <ScrollText className="h-4 w-4 text-sky-400" /> Recent Execution Logs
            </h3>
            <div className="max-h-64 overflow-y-auto space-y-2">
              {logs.map((l) => (
                <div key={l.id} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs flex items-center justify-between">
                  <div>
                    <div className="font-medium text-slate-200">{l.effect_name}</div>
                    <div className="text-slate-400">
                      {l.trigger_source} · {new Date(l.executed_at).toLocaleString()}
                    </div>
                    {l.error_message && <div className="text-rose-400">{l.error_message}</div>}
                  </div>
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
                      l.status === "success" ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"
                    }`}
                  >
                    {l.status}
                  </span>
                </div>
              ))}
              {logs.length === 0 && <p className="text-xs text-slate-500">No executions logged yet.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
