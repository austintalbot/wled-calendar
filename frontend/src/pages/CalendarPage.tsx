import { useEffect, useState } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Play, Plus, Sparkles, Sun, Trash2, X } from "lucide-react";
import { api, ControllerProfile, DayScheduleSummary, EffectRecord, ScheduleRuleRecord } from "../api";
import { SegmentSimulator } from "../components/SegmentSimulator";

interface Props {
  effects: EffectRecord[];
  profile: ControllerProfile | null;
  onRefreshEffects: () => void;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CalendarPage({ effects, profile }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [days, setDays] = useState<DayScheduleSummary[]>([]);
  const [rules, setRules] = useState<ScheduleRuleRecord[]>([]);
  const [selectedDay, setSelectedDay] = useState<DayScheduleSummary | null>(null);
  const [selectedEffectId, setSelectedEffectId] = useState<number>(0);
  const [triggerType, setTriggerType] = useState<"sunset" | "sunrise" | "fixed_time">("sunset");
  const [triggerTime, setTriggerTime] = useState("18:00");
  const [offsetMinutes, setOffsetMinutes] = useState(0);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const loadMonth = async () => {
    const [mRes, rRes] = await Promise.all([api.getMonthSchedule(year, month), api.listRules()]);
    setDays(mRes.days);
    setRules(rRes.rules);
    if (selectedDay) {
      const updated = mRes.days.find((d) => d.date === selectedDay.date) || null;
      setSelectedDay(updated);
    }
  };

  useEffect(() => {
    loadMonth().catch(console.error);
  }, [year, month]);

  useEffect(() => {
    if (effects.length > 0 && selectedEffectId === 0) {
      setSelectedEffectId(effects[0].id);
    }
  }, [effects]);

  const prevMonth = () => {
    if (month === 1) {
      setYear((y) => y - 1);
      setMonth(12);
    } else {
      setMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (month === 12) {
      setYear((y) => y + 1);
      setMonth(1);
    } else {
      setMonth((m) => m + 1);
    }
  };

  const firstDayOffset = (() => {
    if (!days.length) return 0;
    const d = new Date(`${days[0].date}T00:00:00`);
    return (d.getDay() + 6) % 7; // Monday = 0
  })();

  const handleAssignDate = async () => {
    if (!selectedDay || !selectedEffectId) return;
    setBusy(true);
    try {
      await api.createRule({
        rule_type: "date",
        start_date: selectedDay.date,
        effect_id: selectedEffectId,
        trigger_type: triggerType,
        trigger_time: triggerType === "fixed_time" ? triggerTime : null,
        offset_minutes: offsetMinutes,
      });
      setBanner(`Scheduled effect for ${selectedDay.date}`);
      await loadMonth();
    } finally {
      setBusy(false);
    }
  };

  const handleApplyNow = async (effectId: number) => {
    setBusy(true);
    try {
      await api.applyEffectNow(effectId);
      setBanner("Applied effect to WLED controller!");
    } catch (e: any) {
      setBanner(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteRule = async (ruleId: number) => {
    setBusy(true);
    try {
      await api.deleteRule(ruleId);
      await loadMonth();
    } finally {
      setBusy(false);
    }
  };

  const monthLabel = new Date(year, month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <CalendarIcon className="h-6 w-6 text-sky-400" />
          <h2 className="text-xl font-semibold">{monthLabel}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="rounded-lg border border-slate-700 bg-slate-900 p-2 hover:bg-slate-800">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              setYear(now.getFullYear());
              setMonth(now.getMonth() + 1);
            }}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm hover:bg-slate-800"
          >
            Today
          </button>
          <button onClick={nextMonth} className="rounded-lg border border-slate-700 bg-slate-900 p-2 hover:bg-slate-800">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {banner && (
        <div className="flex items-center justify-between rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-200">
          <span>{banner}</span>
          <button onClick={() => setBanner(null)} className="text-sky-300 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="grid grid-cols-7 gap-2 text-center text-xs font-medium text-slate-400 mb-2">
            {WEEKDAYS.map((wd) => (
              <div key={wd} className="py-1">
                {wd}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: firstDayOffset }).map((_, idx) => (
              <div key={`empty-${idx}`} className="min-h-24 rounded-xl bg-slate-900/30" />
            ))}
            {days.map((day) => {
              const dayNum = Number(day.date.split("-")[2]);
              const isToday = day.date === todayIso;
              const isSelected = selectedDay?.date === day.date;
              const gradient =
                day.preview_colors.length >= 2
                  ? `linear-gradient(90deg, ${day.preview_colors.join(", ")})`
                  : day.preview_colors[0] || "transparent";

              return (
                <button
                  key={day.date}
                  onClick={() => setSelectedDay(day)}
                  className={`flex min-h-24 flex-col justify-between rounded-xl border p-2 text-left transition ${
                    isSelected
                      ? "border-sky-400 bg-slate-800/90 ring-1 ring-sky-400"
                      : isToday
                        ? "border-amber-400/60 bg-slate-900"
                        : "border-slate-800 bg-slate-900/70 hover:border-slate-700 hover:bg-slate-900"
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className={`text-xs font-semibold ${isToday ? "text-amber-300" : "text-slate-300"}`}>
                      {dayNum}
                    </span>
                    {day.timed_events.length > 0 && (
                      <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] text-violet-300">
                        +{day.timed_events.length} cal
                      </span>
                    )}
                  </div>

                  <div className="space-y-1 w-full">
                    {day.all_day_events.slice(0, 1).map((ev) => (
                      <div key={ev.id} className="truncate rounded bg-emerald-500/15 px-1 py-0.5 text-[10px] text-emerald-300">
                        {ev.summary}
                      </div>
                    ))}
                    {day.effect_name ? (
                      <>
                        <div className="h-1.5 w-full rounded-full" style={{ background: gradient }} />
                        <div className="truncate text-[11px] font-medium text-slate-200">{day.effect_name}</div>
                        <div className="flex items-center gap-1 text-[10px] text-slate-400">
                          <Sun className="h-2.5 w-2.5 text-amber-400" />
                          <span>{day.trigger_time_resolved}</span>
                        </div>
                      </>
                    ) : (
                      <div className="text-[10px] text-slate-500">No effect</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Day Inspector & Override Drawer */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
            {selectedDay ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold">{selectedDay.date}</h3>
                    <p className="text-xs text-slate-400">Sunset: {selectedDay.sunset_time}</p>
                  </div>
                  {selectedDay.effect_id && (
                    <button
                      disabled={busy}
                      onClick={() => handleApplyNow(selectedDay.effect_id!)}
                      className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-50"
                    >
                      <Play className="h-3.5 w-3.5" /> Apply Now
                    </button>
                  )}
                </div>

                {selectedDay.effect_name && (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                      <div className="text-xs text-slate-400">Active Baseline ({selectedDay.source})</div>
                      <div className="mt-1 flex items-center gap-2 font-medium text-slate-100">
                        <Sparkles className="h-4 w-4 text-sky-400" />
                        {selectedDay.effect_name}
                      </div>
                      <div className="mt-1 text-xs text-slate-400">Runs at {selectedDay.trigger_time_resolved}</div>
                    </div>
                    {(() => {
                      const eff = effects.find((e) => e.id === selectedDay.effect_id);
                      if (!eff) return null;
                      return (
                        <SegmentSimulator
                          segments={profile?.segments || []}
                          payload={eff.payload}
                          segmentMode={eff.segment_mode}
                          effectNames={profile?.effects || []}
                          paletteNames={profile?.palettes || []}
                          compact
                          label="Day Preview"
                        />
                      );
                    })()}
                  </div>
                )}

                {(selectedDay.all_day_events.length > 0 || selectedDay.timed_events.length > 0) && (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-slate-300">Google Calendar / ICS Events</div>
                    {[...selectedDay.all_day_events, ...selectedDay.timed_events].map((ev) => (
                      <div key={ev.id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5 text-xs">
                        <div className="font-medium text-slate-200">{ev.summary}</div>
                        <div className="mt-0.5 text-slate-400">
                          {ev.is_all_day ? "All day" : new Date(ev.start_dt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                          {ev.matched_effect_name ? ` → ${ev.matched_effect_name}` : " (unmatched)"}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="border-t border-slate-800 pt-4 space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Override This Date
                  </div>
                  {effects.length === 0 ? (
                    <p className="text-xs text-amber-300">Import or create an effect first in the Import Hub.</p>
                  ) : (
                    <>
                      <select
                        value={selectedEffectId}
                        onChange={(e) => setSelectedEffectId(Number(e.target.value))}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                      >
                        {effects.map((eff) => (
                          <option key={eff.id} value={eff.id}>
                            {eff.name}
                          </option>
                        ))}
                      </select>

                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={triggerType}
                          onChange={(e) => setTriggerType(e.target.value as any)}
                          className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs"
                        >
                          <option value="sunset">At Sunset</option>
                          <option value="sunrise">At Sunrise</option>
                          <option value="fixed_time">Fixed Time</option>
                        </select>
                        {triggerType === "fixed_time" ? (
                          <input
                            type="time"
                            value={triggerTime}
                            onChange={(e) => setTriggerTime(e.target.value)}
                            className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs"
                          />
                        ) : (
                          <input
                            type="number"
                            value={offsetMinutes}
                            onChange={(e) => setOffsetMinutes(Number(e.target.value))}
                            placeholder="Offset min"
                            className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs"
                          />
                        )}
                      </div>

                      <button
                        disabled={busy || !selectedEffectId}
                        onClick={handleAssignDate}
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
                      >
                        <Plus className="h-4 w-4" /> Save Date Override
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400">Select any day on the calendar to inspect or override its effect.</p>
            )}
          </div>

          {/* Active Rules List */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-200">Active Schedule Rules ({rules.length})</h3>
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {rules.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs">
                  <div>
                    <div className="font-medium text-slate-200">{r.effect_name}</div>
                    <div className="text-slate-400">
                      {r.rule_type} {r.start_date ? `(${r.start_date})` : ""} · {r.trigger_type}
                    </div>
                  </div>
                  <button onClick={() => handleDeleteRule(r.id)} className="text-slate-500 hover:text-rose-400">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {rules.length === 0 && <p className="text-xs text-slate-500">No rules yet. Add a default rule in Settings or click a date.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
