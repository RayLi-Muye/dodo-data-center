import { DataSection, MetaLine } from "@dodo/ui";
import Link from "next/link";

import { AssetImage } from "../../../components/asset-image";
import { DataState } from "../../../components/data-state";
import { PageHeading } from "../../../components/page-heading";
import { api, collectAllHeroes, collectAllItems, settle } from "../../../lib/api";
import { formatDuration, formatUtc } from "../../../lib/format";

export default async function MatchPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  const [matchResult, heroesResult, itemsResult] = await Promise.all([
    settle(api.match(matchId)),
    settle(collectAllHeroes()),
    settle(collectAllItems()),
  ]);

  if (!matchResult.ok) {
    return (
      <div className="page-shell">
        <PageHeading eyebrow={`MATCH / ${matchId}`} lead="单场公开比赛的阵容、结果与最终物品。" title="比赛详情" />
        <DataState error={matchResult.error} retryHref={`/matches/${encodeURIComponent(matchId)}`} />
      </div>
    );
  }

  const match = matchResult.value;
  const heroById = new Map(heroesResult.ok ? heroesResult.value.map((hero) => [hero.id, hero]) : []);
  const itemById = new Map(itemsResult.ok ? itemsResult.value.map((item) => [item.id, item]) : []);
  const radiant = match.data.players.filter((player) => player.side === "radiant");
  const dire = match.data.players.filter((player) => player.side === "dire");

  return (
    <div className="page-shell match-page">
      <PageHeading
        eyebrow={`MATCH / ${match.data.id}`}
        lead={`${match.data.patch} · ${match.data.gameMode} · ${match.data.region ?? "未知地区"} · UTC ${formatUtc(match.data.startTime)}`}
        title={match.data.radiantWin ? "天辉胜利" : "夜魇胜利"}
      />

      <section className="match-scoreboard" aria-label="比赛结果概览">
        <div className={match.data.radiantWin ? "match-side match-side--winner" : "match-side"}>
          <span>RADIANT</span>
          <strong>天辉</strong>
          <small>{match.data.radiantWin ? "↑ 胜利" : "↓ 失利"}</small>
        </div>
        <div className="match-clock">
          <span>比赛时长</span>
          <strong>{formatDuration(match.data.durationSeconds)}</strong>
          <small>{match.data.parseStatus === "parsed" ? "已解析" : match.data.parseStatus === "pending" ? "回放解析中" : "基础数据 · 未解析回放"}</small>
        </div>
        <div className={!match.data.radiantWin ? "match-side match-side--winner" : "match-side"}>
          <span>DIRE</span>
          <strong>夜魇</strong>
          <small>{!match.data.radiantWin ? "↑ 胜利" : "↓ 失利"}</small>
        </div>
      </section>

      <div className="match-teams">
        {[
          { label: "天辉阵容", players: radiant, side: "radiant" },
          { label: "夜魇阵容", players: dire, side: "dire" },
        ].map((team) => (
          <DataSection eyebrow={team.side.toUpperCase()} key={team.side} title={team.label}>
            <div className="participant-table" role="table" aria-label={team.label}>
              <div className="participant-table__head" role="row">
                <span role="columnheader">玩家 / 英雄</span>
                <span role="columnheader">K / D / A</span>
                <span role="columnheader">GPM / XPM</span>
                <span role="columnheader">补刀 / 伤害</span>
                <span role="columnheader">最终物品</span>
              </div>
              {team.players.map((player) => {
                const hero = heroById.get(player.heroId);
                return (
                  <div className="participant-table__row" key={player.playerSlot} role="row">
                    <span className="participant-identity" data-label="玩家 / 英雄" role="cell">
                      {hero ? <AssetImage alt={hero.localizedName} className="hero-thumb" kind="hero" name={hero.name} /> : <span aria-label={`英雄 ${player.heroId} 图片不可用`} className="asset-fallback asset-fallback--hero hero-thumb" role="img">?</span>}
                      <span>
                        {player.accountId ? <Link href={`/players/${encodeURIComponent(player.accountId)}`}>{player.accountId}</Link> : <strong>匿名玩家</strong>}
                        <small>{hero ? <Link href={`/heroes/${encodeURIComponent(hero.id)}`}>{hero.localizedName}</Link> : `英雄 #${player.heroId}`}</small>
                      </span>
                    </span>
                    <span className="participant-kda" data-label="K / D / A" role="cell"><b>{player.kills}</b><i>/</i><b>{player.deaths}</b><i>/</i><b>{player.assists}</b></span>
                    <span data-label="GPM / XPM" role="cell">{player.gpm ?? "—"} <i>/</i> {player.xpm ?? "—"}</span>
                    <span data-label="补刀 / 伤害" role="cell">{player.lastHits ?? "—"} <i>/</i> {player.heroDamage?.toLocaleString("zh-CN") ?? "—"}</span>
                    <span className="item-rack" data-label="最终物品" role="cell">
                      {player.finalItemIds.length > 0 ? player.finalItemIds.map((itemId, index) => {
                        const item = itemById.get(itemId);
                        return item ? (
                          <Link href={`/items/${encodeURIComponent(item.id)}`} key={`${item.id}-${index}`} title={item.localizedName}>
                            <AssetImage alt={item.localizedName} className="item-thumb" kind="item" name={item.name} />
                          </Link>
                        ) : <span aria-label={`物品 ${itemId} 图片不可用`} className="asset-fallback asset-fallback--item item-thumb" key={`${itemId}-${index}`} role="img">#{itemId}</span>;
                      }) : <small>无最终物品</small>}
                    </span>
                  </div>
                );
              })}
            </div>
          </DataSection>
        ))}
      </div>

      <MetaLine sources={match.meta.sources} updatedAt={match.meta.updatedAt} />
      <p className="data-disclaimer">最终物品不代表购买顺序或购买时间；这些 replay 派生能力不属于当前 MVP。</p>
    </div>
  );
}
