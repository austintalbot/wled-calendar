import { useEffect, useState } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Clock, Play, Plus, Sparkles, Sun, Sunrise, Sunset, Trash2, X } from "lucide-react";
import { api, ControllerProfile, DayScheduleSummary, EffectRecord, ScheduleRuleRecord } from "../api";
import { SegmentSimulator } from "../components/SegmentSimulator";

interface Props {
  effects: EffectRecord[];
  profile: ControllerProfile | null;
  onRefreshEffects: () => void;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatRuleTrigger(r: ScheduleRuleRecord): string {
  if (r.trigger_type === "fixed_time" && r.trigger_time) {
    const [hh, mm] = r.trigger_time.split(":").map(Number);
    const period = hh >= 12 ? "PM" : "AM";
    const h12 = hh % 12 || 12;
    return `${h12}:${String(mm).padStart(2, "0")} ${period}`;
  }
  const base = r.trigger_type === "sunrise" ? "Sunrise" : "Sunset";
  if (!r.offset_minutes) return base;
  return `${base} ${r.offset_minutes > 0 ? `+${r.offset_minutes}` : r.offset_minutes}m`;
}

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
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [newRuleType, setNewRuleType] = useState<"date_range" | "day_of_week" | "holiday" | "default">("date_range");
  const [ruleStartDate, setRuleStartDate] = useState("");
  const [ruleEndDate, setRuleEndDate] = useState("");
  const [ruleDaysOfWeek, setRuleDaysOfWeek] = useState<number[]>([4, 5]);
  const [ruleHolidayName, setRuleHolidayName] = useState("");
  const [ruleEffectId, setRuleEffectId] = useState<number>(0);
  const [ruleTriggerType, setRuleTriggerType] = useState<"sunset" | "sunrise" | "fixed_time">("sunset");
  const [ruleTriggerTime, setRuleTriggerTime] = useState("18:00");
  const [ruleOffsetMinutes, setRuleOffsetMinutes] = useState(0);

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
    if (effects.length > 0) {
      if (selectedEffectId === 0) setSelectedEffectId(effects[0].id);
      if (ruleEffectId === 0) setRuleEffectId(effects[0].id);
    }
  }, [effects]);

  useEffect(() => {
    if (!showRuleModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowRuleModal(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showRuleModal]);

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
    } catch (e: any) {
      setBanner(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleCreateAdvancedRule = async () => {
    if (!ruleEffectId) return;
    if (newRuleType === "date_range" && (!ruleStartDate || !ruleEndDate)) {
      setBanner("Error: Please select both start and end dates.");
      return;
    }
    if (newRuleType === "day_of_week" && ruleDaysOfWeek.length === 0) {
      setBanner("Error: Select at least one day of the week.");
      return;
    }
    if (newRuleType === "holiday" && !ruleHolidayName.trim()) {
      setBanner("Error: Enter a holiday name to match.");
      return;
    }
    setBusy(true);
    try {
      await api.createRule({
        rule_type: newRuleType,
        start_date: newRuleType === "date_range" ? ruleStartDate : null,
        end_date: newRuleType === "date_range" ? ruleEndDate : null,
        days_of_week: newRuleType === "day_of_week" ? ruleDaysOfWeek : [],
        holiday_name: newRuleType === "holiday" ? ruleHolidayName.trim() : null,
        effect_id: ruleEffectId,
        trigger_type: ruleTriggerType,
        trigger_time: ruleTriggerType === "fixed_time" ? ruleTriggerTime : null,
        offset_minutes: ruleOffsetMinutes,
      });
      setShowRuleModal(false);
      setBanner(`Saved ${newRuleType.replace("_", " ")} rule.`);
      await loadMonth();
    } catch (e: any) {
      setBanner(`Error: ${e.message}`);
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
    if (!window.confirm("Delete this schedule rule?")) return;
    setBusy(true);
    try {
      await api.deleteRule(ruleId);
      await loadMonth();
    } catch (e: any) {
      setBanner(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const monthLabel = new Date(year, month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  const todayIso = (() => {
    if (profile?.timezone) {
      try {
        return new Intl.DateTimeFormat("en-CA", { timeZone: profile.timezone }).format(now);
      } catch {
        // fallback to browser local date
      }
    }
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  })();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <CalendarIcon className="h-6 w-6 text-sky-400" />
          <h2 className="text-xl font-semibold">{monthLabel}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={prevMonth}
            aria-label="Previous month"
            title="Previous month"
            className="rounded-lg border border-slate-700 bg-slate-900 p-2 hover:bg-slate-800"
          >
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
          <button
            onClick={nextMonth}
            aria-label="Next month"
            title="Next month"
            className="rounded-lg border border-slate-700 bg-slate-900 p-2 hover:bg-slate-800"
          >
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
              <div key={`empty-${idx}`} className="min-h-[78px] rounded-xl bg-slate-900/30" />
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
                  className={`flex min-h-[78px] flex-col justify-between rounded-xl border p-1.5 text-left transition ${
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
                        <div className="truncate text-[11px] font-medium text-slate-100">{day.effect_name}</div>
                        <div
                          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold w-fit ${
                            day.trigger_type === "fixed_time"
                              ? "bg-sky-500/15 text-sky-300"
                              : day.trigger_type === "sunrise"
                                ? "bg-indigo-500/15 text-indigo-300"
                                : "bg-amber-500/15 text-amber-300"
                          }`}
                        >
                          {day.trigger_type === "fixed_time" ? (
                            <Clock className="h-3 w-3 shrink-0" />
                          ) : day.trigger_type === "sunrise" ? (
                            <Sunrise className="h-3 w-3 shrink-0" />
                          ) : (
                            <Sunset className="h-3 w-3 shrink-0" />
                          )}
                          <span>{day.trigger_time_resolved}</span>
                        </div>
                      </>
                    ) : (
                      <div className="space-y-0.5">
                        <div className="text-[10px] text-slate-500">No effect</div>
                        {day.sunset_time && (
                          <div className="flex items-center gap-1 text-[10px] text-slate-600">
                            <Sunset className="h-2.5 w-2.5" />
                            <span>{day.sunset_time}</span>
                          </div>
                        )}
                      </div>
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
                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2">
                      <div className="text-xs text-slate-400">Active Baseline ({selectedDay.source})</div>
                      <div className="flex items-center gap-2 font-medium text-slate-100">
                        <Sparkles className="h-4 w-4 text-sky-400" />
                        {selectedDay.effect_name}
                      </div>
                      <div className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-300">
                        {selectedDay.trigger_type === "fixed_time" ? (
                          <Clock className="h-3.5 w-3.5 text-sky-300" />
                        ) : selectedDay.trigger_type === "sunrise" ? (
                          <Sunrise className="h-3.5 w-3.5 text-indigo-300" />
                        ) : (
                          <Sunset className="h-3.5 w-3.5 text-amber-300" />
                        )}
                        <span>
                          Turns on at {selectedDay.trigger_time_resolved}{" "}
                          <span className="font-normal opacity-80">
                            ({selectedDay.trigger_type === "fixed_time"
                              ? "Fixed Time"
                              : selectedDay.trigger_type === "sunrise"
                                ? "Sunrise"
                                : "Sunset"})
                          </span>
                        </span>
                      </div>
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
                          paletteColors={profile?.palette_colors}
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
                        <div>
                          <label className="text-[10px] text-slate-400">When</label>
                          <select
                            value={triggerType}
                            onChange={(e) => setTriggerType(e.target.value as any)}
                            className="mt-0.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs"
                          >
                            <option value="sunset">At Sunset</option>
                            <option value="sunrise">At Sunrise</option>
                            <option value="fixed_time">Fixed Time</option>
                          </select>
                        </div>
                        {triggerType === "fixed_time" ? (
                          <div>
                            <label className="text-[10px] text-slate-400">Time</label>
                            <input
                              type="time"
                              value={triggerTime}
                              onChange={(e) => setTriggerTime(e.target.value)}
                              className="mt-0.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs"
                            />
                          </div>
                        ) : (
                          <div>
                            <label className="text-[10px] text-slate-400">Offset (min)</label>
                            <input
                              type="number"
                              value={offsetMinutes}
                              onChange={(e) => setOffsetMinutes(Number(e.target.value))}
                              placeholder="0"
                              className="mt-0.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs"
                            />
                          </div>
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
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-200">Active Schedule Rules ({rules.length})</h3>
              <button
                type="button"
                disabled={effects.length === 0}
                onClick={() => setShowRuleModal(true)}
                className="flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-medium text-sky-300 hover:bg-slate-700 disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" /> New Rule
              </button>
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {rules.map((r, idx) => {
                const isShadowed =
                  r.rule_type === "date" &&
                  rules.slice(0, idx).some((higher) => higher.rule_type === "date" && higher.start_date === r.start_date);
                return (
                  <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-slate-100 truncate">{r.effect_name}</span>
                        {isShadowed ? (
                          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
                            Overridden
                          </span>
                        ) : (
                          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-slate-400">
                        {r.rule_type === "date" && r.start_date
                          ? r.start_date
                          : r.rule_type === "date_range"
                            ? `${r.start_date} → ${r.end_date}`
                            : r.rule_type === "day_of_week"
                              ? r.days_of_week.map((d) => WEEKDAYS[d] ?? d).join(", ")
                              : r.rule_type === "holiday"
                                ? `Holiday: ${r.holiday_name}`
                                : r.rule_type === "default"
                                  ? "Daily Default"
                                  : r.rule_type}{" "}
                        · <span className="text-sky-300 font-medium">{formatRuleTrigger(r)}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteRule(r.id)}
                      aria-label={`Delete rule for ${r.effect_name}`}
                      title="Delete rule"
                      className="text-slate-500 hover:text-rose-400 shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
              {rules.length === 0 && <p className="text-xs text-slate-500">No rules yet. Add a rule or click a date.</p>}
            </div>
          </div>
        </div>
      </div>

      {showRuleModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Create Schedule Rule"
          onClick={() => setShowRuleModal(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Create Schedule Rule</h3>
              <button
                type="button"
                onClick={() => setShowRuleModal(false)}
                aria-label="Close modal"
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <label className="text-xs text-slate-400">Rule Type</label>
                <select
                  value={newRuleType}
                  onChange={(e) => setNewRuleType(e.target.value as any)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                >
                  <option value="date_range">Date Range (e.g. Holiday Season)</option>
                  <option value="day_of_week">Days of Week (e.g. Weekends)</option>
                  <option value="holiday">Holiday Name Match (from ICS)</option>
                  <option value="default">Daily Default</option>
                </select>
              </div>

              {newRuleType === "date_range" && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-slate-400">Start Date</label>
                    <input
                      type="date"
                      value={ruleStartDate}
                      onChange={(e) => setRuleStartDate(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400">End Date</label>
                    <input
                      type="date"
                      value={ruleEndDate}
                      onChange={(e) => setRuleEndDate(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs"
                    />
                  </div>
                </div>
              )}

              {newRuleType === "day_of_week" && (
                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">Active Days</label>
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAYS.map((wd, idx) => {
                      const active = ruleDaysOfWeek.includes(idx);
                      return (
                        <button
                          key={wd}
                          type="button"
                          onClick={() =>
                            setRuleDaysOfWeek((prev) =>
                              prev.includes(idx) ? prev.filter((d) => d !== idx) : [...prev, idx].sort()
                            )
                          }
                          className={`rounded-lg px-2.5 py-1 text-xs font-medium border ${
                            active
                              ? "border-sky-400 bg-sky-500/20 text-sky-200"
                              : "border-slate-700 bg-slate-950 text-slate-400"
                          }`}
                        >
                          {wd}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {newRuleType === "holiday" && (
                <div>
                  <label className="text-xs text-slate-400">Holiday Name (substring match)</label>
                  <input
                    value={ruleHolidayName}
                    onChange={(e) => setRuleHolidayName(e.target.value)}
                    placeholder="e.g. Thanksgiving"
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>
              )}

              <div>
                <label className="text-xs text-slate-400">Effect</label>
                <select
                  value={ruleEffectId}
                  onChange={(e) => setRuleEffectId(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                >
                  {effects.map((eff) => (
                    <option key={eff.id} value={eff.id}>
                      {eff.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-400">When</label>
                  <select
                    value={ruleTriggerType}
                    onChange={(e) => setRuleTriggerType(e.target.value as any)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs"
                  >
                    <option value="sunset">At Sunset</option>
                    <option value="sunrise">At Sunrise</option>
                    <option value="fixed_time">Fixed Time</option>
                  </select>
                </div>
                {ruleTriggerType === "fixed_time" ? (
                  <div>
                    <label className="text-xs text-slate-400">Time</label>
                    <input
                      type="time"
                      value={ruleTriggerTime}
                      onChange={(e) => setRuleTriggerTime(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="text-xs text-slate-400">Offset (min)</label>
                    <input
                      type="number"
                      value={ruleOffsetMinutes}
                      onChange={(e) => setRuleOffsetMinutes(Number(e.target.value))}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowRuleModal(false)}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleCreateAdvancedRule}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                Save Rule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
