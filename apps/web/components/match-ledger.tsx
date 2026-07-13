import type { HeroSummary, ItemSummary, MatchSummary } from "@dodo/contracts";
import { OutcomeBadge } from "@dodo/ui";
import Link from "next/link";

import { formatDuration, formatUtc, gameModeLabel, matchVersionLabel } from "../lib/format";
import { AssetImage } from "./asset-image";

export function MatchLedger({
  heroes,
  items,
  matches,
}: {
  heroes: Map<string, HeroSummary>;
  items: Map<string, ItemSummary>;
  matches: MatchSummary[];
}) {
  return (
    <section className="match-ledger" aria-label="最近公开比赛">
      <div className="match-ledger__head" aria-hidden="true">
        <span>结果</span>
        <span>英雄 / 比赛</span>
        <span>K / D / A</span>
        <span>最终物品</span>
        <span>UTC 时间</span>
      </div>
      {matches.map((match) => {
        const hero = heroes.get(match.player.heroId);
        return (
          <Link className="match-ledger__row" href={`/matches/${encodeURIComponent(match.id)}`} key={match.id}>
            <span data-label="结果"><OutcomeBadge win={match.player.isWin} /></span>
            <span className="match-ledger__hero" data-label="英雄 / 比赛">
              {hero ? <AssetImage alt={hero.localizedName} className="hero-thumb" kind="hero" name={hero.name} /> : <span aria-label={`英雄 ${match.player.heroId} 图片不可用`} className="asset-fallback asset-fallback--hero hero-thumb" role="img">?</span>}
              <span>
                <strong>{hero?.localizedName ?? `英雄 #${match.player.heroId}`}</strong>
                <small>{gameModeLabel(match.gameMode)} · {matchVersionLabel(match)} · {formatDuration(match.durationSeconds)}</small>
              </span>
            </span>
            <span className="match-ledger__kda" data-label="K / D / A">
              <b>{match.player.kills}</b><i>/</i><b>{match.player.deaths}</b><i>/</i><b>{match.player.assists}</b>
            </span>
            <span className="item-rack" data-label="最终物品">
              {match.player.finalItemIds.length > 0 ? match.player.finalItemIds.map((itemId, index) => {
                const item = items.get(itemId);
                return item ? <AssetImage alt={item.localizedName} className="item-thumb" key={`${itemId}-${index}`} kind="item" name={item.name} /> : <span aria-label={`物品 ${itemId} 图片不可用`} className="asset-fallback asset-fallback--item item-thumb" key={`${itemId}-${index}`} role="img">#{itemId}</span>;
              }) : <small>无最终物品</small>}
            </span>
            <span className="match-ledger__time" data-label="UTC 时间">{formatUtc(match.startTime)}</span>
          </Link>
        );
      })}
    </section>
  );
}
