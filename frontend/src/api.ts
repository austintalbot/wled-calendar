export interface SegmentSpec {
  id: number;
  start: number;
  stop: number;
  len: number;
  pin?: number | null;
  name: string;
}

export interface ControllerProfile {
  host: string;
  name: string;
  version: string;
  led_count: number;
  fx_count: number;
  pal_count: number;
  latitude: number;
  longitude: number;
  timezone: string;
  segments: SegmentSpec[];
  effects: string[];
  fx_data?: string[];
  palettes: string[];
  palette_colors?: Record<string, any[]>;
  last_synced_at: string | null;
}

export interface ControllerStatus {
  online: boolean;
  error: string | null;
  profile: ControllerProfile;
  live_state: Record<string, any> | null;
  live_info: Record<string, any> | null;
}

export interface EffectRecord {
  id: number;
  name: string;
  source_type: string;
  source_url: string | null;
  payload: Record<string, any>;
  segment_mode: "mirror" | "custom" | "normalized";
  tags: string[];
  preview_colors: string[];
  created_at: string;
}

export interface CalendarEventRecord {
  id: number;
  feed_id: number;
  uid: string;
  summary: string;
  description: string;
  start_dt: string;
  end_dt: string;
  is_all_day: boolean;
  matched_effect_id: number | null;
  matched_effect_name: string | null;
  match_source: string | null;
}

export interface DayScheduleSummary {
  date: string;
  effect_id: number | null;
  effect_name: string | null;
  preview_colors: string[];
  source: string | null;
  trigger_type: "fixed_time" | "sunset" | "sunrise" | null;
  trigger_time_resolved: string | null;
  sunset_time: string | null;
  timed_events: CalendarEventRecord[];
  all_day_events: CalendarEventRecord[];
}

export interface ScheduleRuleRecord {
  id: number;
  rule_type: "date" | "date_range" | "day_of_week" | "holiday" | "default";
  start_date: string | null;
  end_date: string | null;
  days_of_week: number[];
  holiday_name: string | null;
  effect_id: number;
  effect_name: string | null;
  trigger_type: "fixed_time" | "sunset" | "sunrise";
  trigger_time: string | null;
  offset_minutes: number;
  brightness_override: number | null;
  priority: number;
  enabled: boolean;
  created_at: string;
}

export interface FeedRecord {
  id: number;
  name: string;
  feed_type: "google_calendar" | "holiday_ics";
  url: string;
  sync_interval_minutes: number;
  auto_map_keywords: Record<string, number>;
  enabled: boolean;
  last_synced_at: string | null;
  created_at: string;
}

export interface ExecutionLog {
  id: number;
  scheduled_for: string;
  executed_at: string;
  effect_id: number | null;
  effect_name: string;
  trigger_source: string;
  status: string;
  error_message: string | null;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getControllerStatus: () => request<ControllerStatus>("/api/controller/status"),
  syncController: () => request<{ profile: ControllerProfile }>("/api/controller/sync", { method: "POST" }),
  getControllerPresets: () => request<{ presets: any[] }>("/api/controller/presets"),
  savePresetToController: (effectId: number, slotId: number, name?: string) =>
    request<{ ok: boolean; slot_id: number; name: string }>("/api/controller/presets/save", {
      method: "POST",
      body: JSON.stringify({ effect_id: effectId, slot_id: slotId, name }),
    }),
  deleteControllerPreset: (slotId: number) =>
    request<{ ok: boolean; deleted_slot: number }>(`/api/controller/presets/${slotId}`, {
      method: "DELETE",
    }),
  updateControllerSettings: (data: Partial<ControllerProfile>) =>
    request<{ profile: ControllerProfile }>("/api/controller/settings", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  applyEffectNow: (effectId: number, brightnessOverride?: number) =>
    request<{ ok: boolean }>("/api/controller/apply", {
      method: "POST",
      body: JSON.stringify({ effect_id: effectId, brightness_override: brightnessOverride }),
    }),
  applyPayloadNow: (
    payload: Record<string, any>,
    segmentMode: "mirror" | "custom" | "normalized" = "mirror",
    brightnessOverride?: number
  ) =>
    request<{ ok: boolean }>("/api/controller/apply", {
      method: "POST",
      body: JSON.stringify({ payload, segment_mode: segmentMode, brightness_override: brightnessOverride }),
    }),

  listEffects: () => request<{ effects: EffectRecord[] }>("/api/effects"),
  createEffect: (data: Partial<EffectRecord>) =>
    request<{ effect: EffectRecord }>("/api/effects", { method: "POST", body: JSON.stringify(data) }),
  updateEffect: (id: number, data: Partial<EffectRecord>) =>
    request<{ effect: EffectRecord }>(`/api/effects/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteEffect: (id: number) => request<{ deleted: boolean }>(`/api/effects/${id}`, { method: "DELETE" }),

  previewUrlImport: (url: string) =>
    request<{ raw_url: string; presets: any[] }>("/api/effects/import/url", {
      method: "POST",
      body: JSON.stringify({ url, import_all: false }),
    }),
  commitUrlImport: (url: string, selectedKeys: string[]) =>
    request<{ imported: EffectRecord[]; skipped?: number }>("/api/effects/import/url", {
      method: "POST",
      body: JSON.stringify({ url, selected_keys: selectedKeys }),
    }),
  importJson: (name: string, rawJson: string, segmentMode: "mirror" | "custom" | "normalized") =>
    request<{ imported: EffectRecord[] }>("/api/effects/import/json", {
      method: "POST",
      body: JSON.stringify({ name, raw_json: rawJson, segment_mode: segmentMode }),
    }),
  listCurated: () => request<{ curated: any[] }>("/api/effects/curated"),
  importCurated: (slugs: string[]) =>
    request<{ imported: EffectRecord[]; skipped?: number }>("/api/effects/import/curated", {
      method: "POST",
      body: JSON.stringify({ slugs }),
    }),

  getMonthSchedule: (year: number, month: number) =>
    request<{ year: number; month: number; days: DayScheduleSummary[] }>(
      `/api/schedule/month?year=${year}&month=${month}`
    ),
  listRules: () => request<{ rules: ScheduleRuleRecord[] }>("/api/schedule/rules"),
  createRule: (data: Partial<ScheduleRuleRecord>) =>
    request<{ rule: ScheduleRuleRecord }>("/api/schedule/rules", { method: "POST", body: JSON.stringify(data) }),
  updateRule: (id: number, data: Partial<ScheduleRuleRecord>) =>
    request<{ rule: ScheduleRuleRecord }>(`/api/schedule/rules/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteRule: (id: number) => request<{ deleted: boolean }>(`/api/schedule/rules/${id}`, { method: "DELETE" }),
  listLogs: () => request<{ logs: ExecutionLog[] }>("/api/schedule/logs"),

  listFeeds: () => request<{ feeds: FeedRecord[] }>("/api/feeds"),
  createFeed: (data: Partial<FeedRecord>) =>
    request<{ feed: FeedRecord }>("/api/feeds", { method: "POST", body: JSON.stringify(data) }),
  deleteFeed: (id: number) => request<{ deleted: boolean }>(`/api/feeds/${id}`, { method: "DELETE" }),
  syncFeed: (id: number) =>
    request<{ synced_events: number; matched_events: number }>(`/api/feeds/${id}/sync`, { method: "POST" }),
};
