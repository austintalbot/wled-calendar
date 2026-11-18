import { useEffect, useState } from "react";
import { Calendar, Download, Layers, Settings, Wifi, WifiOff } from "lucide-react";
import { api, ControllerStatus, EffectRecord } from "./api";
import { CalendarPage } from "./pages/CalendarPage";
import { EffectsPage } from "./pages/EffectsPage";
import { ImportPage } from "./pages/ImportPage";
import { SettingsPage } from "./pages/SettingsPage";

type Page = "calendar" | "effects" | "import" | "settings";

export default function App() {
  const [page, setPage] = useState<Page>("calendar");
  const [status, setStatus] = useState<ControllerStatus | null>(null);
  const [effects, setEffects] = useState<EffectRecord[]>([]);

  const loadController = () => api.getControllerStatus().then(setStatus).catch(console.error);
  const loadEffects = () => api.listEffects().then((r) => setEffects(r.effects)).catch(console.error);

  useEffect(() => {
    loadController();
    loadEffects();
  }, []);

  const navItems: { key: Page; label: string; icon: any }[] = [
    { key: "calendar", label: "Calendar", icon: Calendar },
    { key: "effects", label: `Effects (${effects.length})`, icon: Layers },
    { key: "import", label: "Import Hub", icon: Download },
    { key: "settings", label: "Controller & Logs", icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-sky-400 via-violet-500 to-amber-400" />
            <div>
              <h1 className="text-base font-bold tracking-tight">WLED Calendar</h1>
              <p className="text-[11px] text-slate-400">Daily Effect Scheduler & Importer</p>
            </div>
          </div>

          <nav className="flex flex-wrap items-center gap-1.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = page === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => setPage(item.key)}
                  className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition ${
                    active ? "bg-sky-500 text-slate-950" : "text-slate-300 hover:bg-slate-900"
                  }`}
                >
                  <Icon className="h-4 w-4" /> {item.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs">
            {status?.online ? (
              <>
                <Wifi className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-emerald-300 font-medium">{status.profile.host}</span>
                <span className="text-slate-500">·</span>
                <span className="text-slate-300">{status.profile.led_count} LEDs</span>
              </>
            ) : (
              <>
                <WifiOff className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-slate-300">{status?.profile.host || "192.168.68.200"}</span>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {page === "calendar" && (
          <CalendarPage effects={effects} profile={status?.profile || null} onRefreshEffects={loadEffects} />
        )}
        {page === "effects" && (
          <EffectsPage effects={effects} profile={status?.profile || null} onRefresh={loadEffects} />
        )}
        {page === "import" && <ImportPage onImported={loadEffects} />}
        {page === "settings" && (
          <SettingsPage
            profile={status?.profile || null}
            liveState={status?.live_state || null}
            effects={effects}
            onRefreshController={loadController}
          />
        )}
      </main>
    </div>
  );
}
