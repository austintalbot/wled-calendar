export const THEME_FILTERS = [
  { key: "all", label: "All" },
  { key: "holiday", label: "Holiday" },
  { key: "christmas", label: "Christmas" },
  { key: "halloween", label: "Halloween" },
  { key: "gaming", label: "Gaming" },
  { key: "party", label: "Party" },
  { key: "fireplace", label: "Fireplace" },
  { key: "rainbow", label: "Rainbow" },
  { key: "ambient", label: "Ambient" },
  { key: "nature", label: "Nature" },
  { key: "everyday", label: "Everyday" },
] as const;

export function matchesThemeFilter<T extends { name: string; tags?: string[] }>(item: T, theme: string): boolean {
  if (theme === "all") return true;
  const tags = (item.tags || []).map((t) => t.toLowerCase());
  return tags.includes(theme) || item.name.toLowerCase().includes(theme);
}

interface Props {
  value: string;
  onChange: (theme: string) => void;
  compact?: boolean;
}

export function ThemeFilterBar({ value, onChange, compact = false }: Props) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {THEME_FILTERS.map((cat) => (
        <button
          key={cat.key}
          type="button"
          onClick={() => onChange(cat.key)}
          className={`rounded-lg font-medium transition ${
            compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"
          } ${
            value === cat.key
              ? "bg-sky-500 text-slate-950"
              : "bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-slate-800"
          }`}
        >
          {cat.label}
        </button>
      ))}
    </div>
  );
}
