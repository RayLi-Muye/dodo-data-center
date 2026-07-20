import { MetaLine } from "@dodo/ui";

import { DataState } from "../../../components/data-state";
import { MatchEnrichmentControl } from "../../../components/match-enrichment-control";
import { MatchDetailWorkbench } from "../../../components/match-detail-workbench";
import { PageHeading } from "../../../components/page-heading";
import { api, collectAllHeroes, collectAllItems, settle } from "../../../lib/api";
import { formatDuration, formatUtc, gameModeLabel, matchVersionLabel } from "../../../lib/format";

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
  const matchHeroIds = [...new Set(match.data.players.map((player) => player.heroId))];
  const heroDetailResults = await Promise.all(
    matchHeroIds.map(async (heroId) => [heroId, await settle(api.hero(heroId))] as const),
  );
  const abilitiesByHeroId = Object.fromEntries(
    heroDetailResults
      .filter((entry) => entry[1].ok)
      .map(([heroId, result]) => [heroId, result.ok ? result.value.data.abilities : []]),
  );
  return (
    <div className="page-shell match-page">
      <PageHeading
        eyebrow={`MATCH / ${match.data.id}`}
        lead={`${matchVersionLabel(match.data)} · ${gameModeLabel(match.data.gameMode)} · ${match.data.region ?? "未知地区"} · UTC ${formatUtc(match.data.startTime)}`}
        title={match.data.radiantWin ? "天辉胜利" : "夜魇胜利"}
      />

      <MatchEnrichmentControl matchId={match.data.id} />

      <section className="match-scoreboard" aria-label="比赛结果概览">
        <div className={match.data.radiantWin ? "match-side match-side--winner" : "match-side"}>
          <span>RADIANT</span>
          <strong><span>天辉</span><b>{match.data.radiantScore ?? "—"}</b></strong>
          <small>{match.data.radiantWin ? "↑ 胜利" : "↓ 失利"}</small>
        </div>
        <div className="match-clock">
          <span>比赛时长</span>
          <strong>{formatDuration(match.data.durationSeconds)}</strong>
          <small>{match.data.parseStatus === "parsed" ? "上游解析记录可用，不代表完整回放事件" : match.data.parseStatus === "pending" ? "上游解析处理中" : "仅基础比赛数据，未提供回放解析记录"}</small>
        </div>
        <div className={!match.data.radiantWin ? "match-side match-side--winner" : "match-side"}>
          <span>DIRE</span>
          <strong><span>夜魇</span><b>{match.data.direScore ?? "—"}</b></strong>
          <small>{!match.data.radiantWin ? "↑ 胜利" : "↓ 失利"}</small>
        </div>
      </section>

      <MatchDetailWorkbench
        abilitiesByHeroId={abilitiesByHeroId}
        heroes={heroesResult.ok ? heroesResult.value : []}
        items={itemsResult.ok ? itemsResult.value : []}
        match={match.data}
      />

      <MetaLine sources={match.meta.sources} updatedAt={match.meta.updatedAt} />
      <p className="data-disclaimer">
        最终装备只表示赛后槽位；仅当上游提供真实交易事件时，时间线才展示购买或出售时间。
      </p>
    </div>
  );
}
