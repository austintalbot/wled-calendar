import { useEffect, useMemo, useState } from "react";
import { CalendarPlus, Check, Code, Cpu, Download, Eye, Globe, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { api, ControllerProfile, FeedRecord } from "../api";
import { SegmentSimulator } from "../components/SegmentSimulator";
import { matchesThemeFilter, ThemeFilterBar } from "../components/ThemeFilterBar";

interface Props {
  profile: ControllerProfile | null;
  onImported: () => void;
}

type PreviewTarget = {
  name: string;
  payload: Record<string, any>;
  segmentMode: "mirror" | "custom" | "normalized";
};

function parsePreviewFromJson(raw: string): Record<string, any> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object") return null;
    if ("seg" in parsed || "fx" in parsed) return parsed;
    for (const [k, v] of Object.entries(parsed)) {
      if (k !== "0" && v && typeof v === "object" && ("seg" in v || "fx" in v)) {
        return v as Record<string, any>;
      }
    }
  } catch {
    // ignore incomplete JSON while typing
  }
  return null;
}

type TabKey = "curated" | "url" | "json" | "controller" | "feeds";

export function ImportPage({ profile, onImported }: Props) {
  const [tab, setTab] = useState<TabKey>("curated");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Curated state
  const [curated, setCurated] = useState<any[]>([]);
  const [curatedFilter, setCuratedFilter] = useState<string>("all");
  // URL import state
  const [urlInput, setUrlInput] = useState("");
  const [urlPresets, setUrlPresets] = useState<any[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  // JSON import state
  const [jsonName, setJsonName] = useState("My Imported Preset");
  const [rawJson, setRawJson] = useState("");
  const [jsonSegMode, setJsonSegMode] = useState<"mirror" | "custom" | "normalized">("mirror");
  // Controller presets state
  const [ctrlPresets, setCtrlPresets] = useState<any[]>([]);
  // Feeds state
  const [feeds, setFeeds] = useState<FeedRecord[]>([]);
  const [feedName, setFeedName] = useState("My Google Calendar");
  const [feedType, setFeedType] = useState<"google_calendar" | "holiday_ics">("google_calendar");
  const [feedUrl, setFeedUrl] = useState("");
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);

  const jsonPreviewPayload = useMemo(() => parsePreviewFromJson(rawJson), [rawJson]);

  useEffect(() => {
    api
      .listCurated()
      .then((r) => {
        setCurated(r.curated);
        if (r.curated.length > 0) {
          setPreviewTarget({
            name: r.curated[0].name,
            payload: r.curated[0].payload,
            segmentMode: "mirror",
          });
        }
      })
      .catch(console.error);
    api.listFeeds().then((r) => setFeeds(r.feeds)).catch(console.error);
  }, []);

  const handleImportCurated = async (slugs: string[]) => {
    setBusy(true);
    try {
      const res = await api.importCurated(slugs);
      const skippedNote = res.skipped ? ` (${res.skipped} already in library)` : "";
      setMessage(`Imported ${res.imported.length} curated preset(s) into your library.${skippedNote}`);
      onImported();
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handlePreviewUrl = async () => {
    if (!urlInput.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.previewUrlImport(urlInput);
      setUrlPresets(res.presets);
      setSelectedKeys(res.presets.map((p) => p.key));
      if (res.presets.length > 0) {
        setPreviewTarget({
          name: res.presets[0].name,
          payload: res.presets[0].payload,
          segmentMode: "mirror",
        });
      }
      setMessage(`Found ${res.presets.length} preset(s) from ${res.raw_url}`);
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleCommitUrl = async () => {
    if (!selectedKeys.length) return;
    setBusy(true);
    try {
      const res = await api.commitUrlImport(urlInput, selectedKeys);
      const skippedNote = res.skipped ? ` (${res.skipped} already in library)` : "";
      setMessage(`Imported ${res.imported.length} preset(s) from URL.${skippedNote}`);
      setUrlPresets([]);
      onImported();
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleImportJson = async () => {
    if (!rawJson.trim()) return;
    setBusy(true);
    try {
      const res = await api.importJson(jsonName, rawJson, jsonSegMode);
      setMessage(`Imported ${res.imported.length} preset(s) from JSON.`);
      setRawJson("");
      onImported();
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleFetchCtrlPresets = async () => {
    setBusy(true);
    try {
      const res = await api.getControllerPresets();
      setCtrlPresets(res.presets);
      if (res.presets.length > 0) {
        setPreviewTarget({
          name: res.presets[0].name,
          payload: res.presets[0].payload,
          segmentMode: "custom",
        });
      }
      setMessage(`Loaded ${res.presets.length} preset(s) from WLED controller.`);
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleImportCtrlPreset = async (preset: any) => {
    setBusy(true);
    try {
      await api.createEffect({
        name: preset.name,
        source_type: "wled_preset",
        payload: preset.payload,
        segment_mode: "custom",
        tags: ["controller-preset"],
        preview_colors: preset.preview_colors,
      });
      setMessage(`Imported "${preset.name}" from controller.`);
      onImported();
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleAddFeed = async () => {
    if (!feedUrl.trim()) return;
    setBusy(true);
    try {
      const created = await api.createFeed({
        name: feedName,
        feed_type: feedType,
        url: feedUrl,
      });
      const syncRes = await api.syncFeed(created.feed.id);
      setFeedUrl("");
      const updated = await api.listFeeds();
      setFeeds(updated.feeds);
      setMessage(`Added & synced "${created.feed.name}": ${syncRes.synced_events} events (${syncRes.matched_events} matched).`);
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleSyncFeed = async (id: number) => {
    setBusy(true);
    try {
      const res = await api.syncFeed(id);
      const updated = await api.listFeeds();
      setFeeds(updated.feeds);
      setMessage(`Synced ${res.synced_events} events (${res.matched_events} matched to effects).`);
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const tabs: { key: TabKey; label: string; icon: any }[] = [
    { key: "curated", label: "Curated Library", icon: Sparkles },
    { key: "url", label: "URL / Gist / Pastebin", icon: Globe },
    { key: "json", label: "Paste JSON", icon: Code },
    { key: "controller", label: "Controller Presets", icon: Cpu },
    { key: "feeds", label: "Google Calendar / ICS", icon: CalendarPlus },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-3">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ${
                active ? "bg-sky-500 text-slate-950" : "bg-slate-900 text-slate-300 hover:bg-slate-800"
              }`}
            >
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {message && (
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-sm text-sky-200">
          {message}
        </div>
      )}

      {tab !== "feeds" &&
        (() => {
          const activePreview =
            tab === "json" && jsonPreviewPayload
              ? { name: jsonName || "JSON Preview", payload: jsonPreviewPayload, segmentMode: jsonSegMode }
              : previewTarget;
          if (!activePreview) return null;
          return (
            <div className="sticky top-[61px] z-30 -mx-2 px-2 py-2 bg-slate-950/95 backdrop-blur shadow-lg shadow-slate-950/60">
              <SegmentSimulator
                segments={profile?.segments || []}
                payload={activePreview.payload}
                segmentMode={activePreview.segmentMode}
                effectNames={profile?.effects || []}
                paletteNames={profile?.palettes || []}
                paletteColors={profile?.palette_colors}
                label={`Pre-Import Simulation: ${activePreview.name}`}
                allowLiveToggle={false}
              />
            </div>
          );
        })()}

      {tab === "curated" && (() => {
        const filteredCurated = curated.filter((c) => matchesThemeFilter(c, curatedFilter));
        return (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-400">
              Pre-configured seasonal, holiday, and everyday effects adapted to your WLED controller segments.
            </p>
            <button
              disabled={busy || filteredCurated.length === 0}
              onClick={() => handleImportCurated(filteredCurated.map((c) => c.slug))}
              className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              {curatedFilter === "all" ? `Import All (${filteredCurated.length})` : `Import ${curatedFilter} (${filteredCurated.length})`}
            </button>
          </div>
          <ThemeFilterBar value={curatedFilter} onChange={setCuratedFilter} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredCurated.map((item) => {
              const grad =
                item.preview_colors.length >= 2
                  ? `linear-gradient(90deg, ${item.preview_colors.join(", ")})`
                  : item.preview_colors[0];
              return (
                <div key={item.slug} className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 flex flex-col justify-between space-y-3">
                  <div>
                    <div className="h-2 w-full rounded-full mb-3" style={{ background: grad }} />
                    <h3 className="font-semibold text-slate-100">{item.name}</h3>
                    <p className="mt-1 text-xs text-slate-400">{item.description}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setPreviewTarget({
                          name: item.name,
                          payload: item.payload,
                          segmentMode: "mirror",
                        })
                      }
                      className="flex items-center justify-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-sky-300 transition"
                      title="Simulate before importing"
                    >
                      <Eye className="h-3.5 w-3.5" /> Sim
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => handleImportCurated([item.slug])}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-slate-800 py-2 text-xs font-medium text-slate-200 hover:bg-sky-500 hover:text-slate-950 transition"
                    >
                      <Download className="h-3.5 w-3.5" /> Add to Library
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        );
      })()}

      {tab === "url" && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 space-y-4 max-w-3xl">
          <div>
            <h3 className="font-semibold">Import from Internet URL</h3>
            <p className="text-xs text-slate-400 mt-1">
              Supports raw WLED JSON URLs, GitHub file URLs, GitHub Gists, and Pastebin links. Automatically maps to your controller segments.
            </p>
          </div>
          <div className="flex gap-2">
            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://gist.github.com/... or https://pastebin.com/..."
              className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            />
            <button
              disabled={busy}
              onClick={handlePreviewUrl}
              className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400"
            >
              Fetch & Preview
            </button>
          </div>

          {urlPresets.length > 0 && (
            <div className="space-y-3 pt-2">
              <div className="space-y-2">
                {urlPresets.map((p) => {
                  const checked = selectedKeys.includes(p.key);
                  return (
                    <label key={p.key} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm cursor-pointer">
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setSelectedKeys((prev) =>
                              e.target.checked ? [...prev, p.key] : prev.filter((k) => k !== p.key)
                            )
                          }
                        />
                        {p.name}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewTarget({
                              name: p.name,
                              payload: p.payload,
                              segmentMode: "mirror",
                            })
                          }
                          className="flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 hover:text-sky-300"
                        >
                          <Eye className="h-3 w-3" /> Sim
                        </button>
                        <span className="text-xs text-slate-400">key: {p.key}</span>
                      </div>
                    </label>
                  );
                })}
              </div>
              <button
                disabled={busy || !selectedKeys.length}
                onClick={handleCommitUrl}
                className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400"
              >
                <Check className="h-4 w-4" /> Import Selected ({selectedKeys.length})
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "json" && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 space-y-4 max-w-3xl">
          <h3 className="font-semibold">Paste WLED Preset JSON</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              value={jsonName}
              onChange={(e) => setJsonName(e.target.value)}
              placeholder="Preset Name"
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            />
            <select
              value={jsonSegMode}
              onChange={(e) => setJsonSegMode(e.target.value as any)}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            >
              <option value="mirror">Mirror across all segments</option>
              <option value="normalized">Sync speed / density across strands</option>
              <option value="custom">Preserve segment definitions</option>
            </select>
          </div>
          <textarea
            rows={8}
            value={rawJson}
            onChange={(e) => setRawJson(e.target.value)}
            placeholder='{"on":true,"bri":255,"seg":[{"fx":22,"pal":21,"col":[[255,100,0]]}]}'
            className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs"
          />
          <button
            disabled={busy}
            onClick={handleImportJson}
            className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400"
          >
            Import JSON
          </button>
        </div>
      )}

      {tab === "controller" && (
        <div className="space-y-4">
          <button
            disabled={busy}
            onClick={handleFetchCtrlPresets}
            className="flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400"
          >
            <RefreshCw className="h-4 w-4" /> Load Presets from WLED Controller
          </button>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {ctrlPresets.map((p) => (
              <div key={p.key} className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium text-slate-100">{p.name}</div>
                  <div className="text-xs text-slate-400">Slot #{p.key}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewTarget({
                        name: p.name,
                        payload: p.payload,
                        segmentMode: "custom",
                      })
                    }
                    className="flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700 hover:text-sky-300"
                    title="Simulate before importing"
                  >
                    <Eye className="h-3.5 w-3.5" /> Sim
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => handleImportCtrlPreset(p)}
                    className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs hover:bg-sky-500 hover:text-slate-950"
                  >
                    Import
                  </button>
                  <button
                    disabled={busy}
                    onClick={async () => {
                      if (!window.confirm(`Permanently delete preset #${p.key} ("${p.name}") from your WLED controller?`)) {
                        return;
                      }
                      setBusy(true);
                      try {
                        await api.deleteControllerPreset(Number(p.key));
                        setCtrlPresets((prev) => prev.filter((x) => x.key !== p.key));
                        setMessage(`Deleted preset slot #${p.key} from WLED controller.`);
                      } catch (e: any) {
                        setMessage(`Error: ${e.message}`);
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="rounded-lg bg-slate-800 p-1.5 text-rose-400 hover:bg-slate-700"
                    aria-label={`Delete preset slot ${p.key} from WLED controller`}
                    title="Delete from WLED controller"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "feeds" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 space-y-4">
            <div>
              <h3 className="font-semibold">Connect Google Calendar or ICS Feed</h3>
              <p className="text-xs text-slate-400 mt-1">
                In Google Calendar → Settings → Integrate calendar, copy your <strong>Secret address in iCal format</strong>.
                Use <code className="text-sky-300">[wled: Effect Name]</code> in event titles/descriptions or rely on automatic holiday keyword matching.
              </p>
            </div>
            <input
              value={feedName}
              onChange={(e) => setFeedName(e.target.value)}
              placeholder="Calendar Name"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            />
            <select
              value={feedType}
              onChange={(e) => setFeedType(e.target.value as any)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            >
              <option value="google_calendar">Google Calendar (Secret iCal URL)</option>
              <option value="holiday_ics">Holiday ICS Feed</option>
            </select>
            <input
              value={feedUrl}
              onChange={(e) => setFeedUrl(e.target.value)}
              placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            />
            <button
              disabled={busy}
              onClick={handleAddFeed}
              className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400"
            >
              Add & Sync Calendar
            </button>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 space-y-3">
            <h3 className="font-semibold">Connected Feeds ({feeds.length})</h3>
            {feeds.map((f) => (
              <div key={f.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-sm text-slate-100 truncate">{f.name}</div>
                  <div className="text-xs text-slate-400 truncate">
                    {f.feed_type} · Last synced: {f.last_synced_at ? new Date(f.last_synced_at).toLocaleString() : "Never"}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleSyncFeed(f.id)}
                    className="rounded-lg bg-slate-800 p-2 text-sky-300 hover:bg-slate-700"
                    title="Sync now"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                  <button
                    onClick={async () => {
                      if (!window.confirm(`Remove calendar feed "${f.name}"?`)) return;
                      try {
                        await api.deleteFeed(f.id);
                        setFeeds((prev) => prev.filter((x) => x.id !== f.id));
                      } catch (e: any) {
                        setMessage(`Error: ${e.message}`);
                      }
                    }}
                    className="rounded-lg bg-slate-800 p-2 text-rose-400 hover:bg-slate-700"
                    aria-label={`Remove feed ${f.name}`}
                    title="Remove feed"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
            {feeds.length === 0 && <p className="text-xs text-slate-500">No calendars connected yet.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
