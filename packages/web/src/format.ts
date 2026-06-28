export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec)) return "–";
  const neg = sec < 0;
  const s = Math.round(Math.abs(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${neg ? "-" : ""}${m}:${String(r).padStart(2, "0")}`;
}

export function formatClock(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec) || sec < 0) return "–";
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// AbleJam color name -> CSS hex (Tailwind 500-ish).
export const COLOR_HEX: Record<string, string> = {
  gray: "#6b7280", red: "#ef4444", orange: "#f97316", amber: "#f59e0b",
  yellow: "#eab308", lime: "#84cc16", green: "#22c55e", emerald: "#10b981",
  teal: "#14b8a6", cyan: "#06b6d4", sky: "#0ea5e9", blue: "#3b82f6",
  indigo: "#6366f1", violet: "#8b5cf6", purple: "#a855f7", fuchsia: "#d946ef",
  pink: "#ec4899", rose: "#f43f5e",
};

export function colorOf(name: string | null | undefined): string | null {
  return name ? COLOR_HEX[name] ?? null : null;
}
