import { formatPercent } from "../lib/format";

export function WinRateDonut({ games, winRate, wins }: { games: number; winRate: number | null; wins: number }) {
  const rate = winRate ?? 0;
  const percent = Math.max(0, Math.min(100, rate * 100));
  return (
    <figure className="win-donut" aria-label={`${games} 场比赛，${wins} 胜，胜率 ${formatPercent(winRate)}`}>
      <div
        className="win-donut__plot"
        style={{ background: `conic-gradient(var(--positive) ${percent}%, var(--negative-muted) ${percent}% 100%)` }}
      >
        <div>
          <strong>{formatPercent(winRate)}</strong>
          <span>胜率</span>
        </div>
      </div>
      <figcaption>
        <span><i className="legend-dot legend-dot--positive" aria-hidden="true" />胜利 {wins}</span>
        <span><i className="legend-dot legend-dot--negative" aria-hidden="true" />失利 {Math.max(games - wins, 0)}</span>
      </figcaption>
    </figure>
  );
}
