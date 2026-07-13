export const formatCount = (value: number): string => value.toLocaleString("zh-CN");

export const formatPercent = (value: number | null, digits = 1): string =>
  value === null
    ? "—"
    : new Intl.NumberFormat("zh-CN", {
        style: "percent",
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      }).format(value);

export const formatDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
};

export const formatGameTime = (seconds: number): string => {
  const absolute = Math.abs(seconds);
  const minutes = Math.floor(absolute / 60);
  const remainder = absolute % 60;
  return `${seconds < 0 ? "−" : ""}${minutes}:${String(remainder).padStart(2, "0")}`;
};

export const formatUtc = (timestamp: string): string =>
  new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  }).format(new Date(timestamp));

const gameModeLabels: Record<string, string> = {
  "1": "全英雄选择",
  "2": "队长模式",
  "3": "随机征召",
  "4": "单一征召",
  "5": "全英雄随机",
  "12": "生疏模式",
  "16": "队长征召",
  "18": "技能征召",
  "20": "全英雄随机死亡竞赛",
  "22": "天梯全英雄选择",
  "23": "加速模式",
};

export const gameModeLabel = (gameMode: string): string =>
  gameModeLabels[gameMode] ?? gameMode;

export const encyclopediaVersionLabel = (officialVersion: string | null): string =>
  officialVersion ?? "版本待确认";

export const matchVersionLabel = ({
  officialVersion,
  officialVersionSource,
  openDotaPatchId,
}: {
  officialVersion: string | null;
  officialVersionSource: "start_time_inferred" | "unavailable";
  openDotaPatchId: string | null;
}): string => {
  if (officialVersion !== null) {
    return officialVersionSource === "start_time_inferred"
      ? `${officialVersion} · 按时间推定`
      : officialVersion;
  }
  return openDotaPatchId !== null ? `OpenDota Patch #${openDotaPatchId}` : "版本待确认";
};

export const windowLabel = (window: string): string => {
  const labels: Record<string, string> = {
    all_imported: "全部已导入",
    last_100: "最近 100 场",
    last_20: "最近 20 场",
    last_50: "最近 50 场",
  };
  return labels[window] ?? window;
};

export type WinRatePresentation = {
  className: "trend--down" | "trend--neutral" | "trend--up";
  label: string;
  symbol: "" | "↑" | "↓";
};

export const winRatePresentation = (winRate: number | null): WinRatePresentation => {
  if (winRate === null) return { className: "trend--neutral", label: "—", symbol: "" };
  return winRate >= 0.5
    ? { className: "trend--up", label: formatPercent(winRate), symbol: "↑" }
    : { className: "trend--down", label: formatPercent(winRate), symbol: "↓" };
};
