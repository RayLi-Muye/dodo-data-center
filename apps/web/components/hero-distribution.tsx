import type { PlayerHeroStats } from "@dodo/contracts";
import Link from "next/link";

import { formatPercent, winRatePresentation } from "../lib/format";
import { AssetImage } from "./asset-image";

export function HeroDistribution({
  heroes,
  limit = 6,
}: {
  heroes: PlayerHeroStats[];
  limit?: number;
}) {
  const visible = heroes.slice(0, limit);
  if (visible.length === 0) return null;
  return (
    <ol className="hero-distribution">
      {visible.map((stats, index) => {
        const href = `/heroes/${encodeURIComponent(stats.hero.id)}`;
        const winRate = winRatePresentation(stats.winRate);
        return (
          <li key={stats.hero.id}>
            <span className="hero-distribution__rank">{String(index + 1).padStart(2, "0")}</span>
            <AssetImage alt={stats.hero.localizedName} className="hero-thumb" kind="hero" name={stats.hero.name} />
            <div className="hero-distribution__identity">
              <Link href={href}>{stats.hero.localizedName}</Link>
              <span>{stats.games} 场 · {formatPercent(stats.usageShare)} 使用</span>
            </div>
            <div className="hero-distribution__bar" aria-label={`使用占比 ${formatPercent(stats.usageShare)}`}>
              <span style={{ width: `${Math.max(2, stats.usageShare * 100)}%` }} />
            </div>
            <span className={`trend ${winRate.className}`}>
              {winRate.symbol ? <i aria-hidden="true">{winRate.symbol}</i> : null}
              {winRate.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
