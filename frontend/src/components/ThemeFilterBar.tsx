export const THEME_FILTERS = [
  { key: "all", label: "All" },
  { key: "holiday", label: "Holiday" },
  { key: "newyear", label: "New Year's" },
  { key: "valentine", label: "Valentine's" },
  { key: "stpatrick", label: "St. Patrick's" },
  { key: "easter", label: "Easter" },
  { key: "july4", label: "4th of July" },
  { key: "halloween", label: "Halloween" },
  { key: "thanksgiving", label: "Thanksgiving" },
  { key: "christmas", label: "Christmas" },
  { key: "gaming", label: "Gaming" },
  { key: "party", label: "Party" },
  { key: "fireplace", label: "Fireplace" },
  { key: "rainbow", label: "Rainbow" },
  { key: "ambient", label: "Ambient" },
  { key: "nature", label: "Nature" },
  { key: "everyday", label: "Everyday" },
] as const;

const THEME_ALIASES: Record<string, string[]> = {
  newyear: ["newyear", "new year"],
  valentine: ["valentine"],
  stpatrick: ["stpatrick", "st. patrick", "patrick", "shamrock", "emerald"],
  easter: ["easter", "spring", "pastel"],
  july4: ["july4", "4th of july", "july 4", "independence", "patriotic"],
  halloween: ["halloween", "spooky", "pumpkin", "ghost"],
  thanksgiving: ["thanksgiving", "harvest", "autumn"],
  christmas: ["christmas", "xmas", "candy cane", "snowfall"],
};

export function matchesThemeFilter<T extends { name: string; tags?: string[] }>(item: T, theme: string): boolean {
  if (theme === "all") return true;
  const tags = (item.tags || []).map((t) => t.toLowerCase());
  const lowerName = item.name.toLowerCase();
  const needles = THEME_ALIASES[theme] || [theme];
  return needles.some((n) => tags.includes(n) || tags.some((t) => t.includes(n)) || lowerName.includes(n));
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
