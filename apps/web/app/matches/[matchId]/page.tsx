import { DataSection, MetaLine, StatusNotice } from "@dodo/ui";

import { DataState } from "../../../components/data-state";
import { MatchPlayerRow } from "../../../components/match-player-row";
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
  const enriched = match.data.detailStatus === "enriched";
  const completeLineup = enriched && radiant.length === 5 && dire.length === 5;
  const teamDetailLabel = completeLineup ? "完整阵容" : enriched ? "阵容详情" : "比赛摘要";

  return (
    <div className="page-shell match-page">
      <PageHeading
        eyebrow={`MATCH / ${match.data.id}`}
        lead={`${match.data.patch} · ${match.data.gameMode} · ${match.data.region ?? "未知地区"} · UTC ${formatUtc(match.data.startTime)}`}
        title={match.data.radiantWin ? "天辉胜利" : "夜魇胜利"}
      />

      {completeLineup ? (
        <StatusNotice
          detail="上游已返回双方完整阵容与可用的赛后字段；缺失的单项数据仍以破折号明确标记。"
          title="完整阵容已载入"
          tone="neutral"
        />
      ) : enriched ? (
        <StatusNotice
          detail="上游已返回增强字段，但当前响应没有包含双方各五名玩家，因此不会标记为完整阵容。"
          title="阵容详情不完整"
          tone="warning"
        />
      ) : (
        <StatusNotice
          detail="当前先保留已有比赛摘要与真实字段，不用占位数据拼出十人阵容。稍后重新读取可获取补全结果。"
          title="完整详情后台补全中"
          tone="neutral"
        />
      )}

      <section className="match-scoreboard" aria-label="比赛结果概览">
        <div className={match.data.radiantWin ? "match-side match-side--winner" : "match-side"}>
          <span>RADIANT</span>
          <strong><span>天辉</span><b>{match.data.radiantScore ?? "—"}</b></strong>
          <small>{match.data.radiantWin ? "↑ 胜利" : "↓ 失利"}</small>
        </div>
        <div className="match-clock">
          <span>比赛时长</span>
          <strong>{formatDuration(match.data.durationSeconds)}</strong>
          <small>{match.data.parseStatus === "parsed" ? "已解析" : match.data.parseStatus === "pending" ? "回放解析中" : "基础数据 · 未解析回放"}</small>
        </div>
        <div className={!match.data.radiantWin ? "match-side match-side--winner" : "match-side"}>
          <span>DIRE</span>
          <strong><span>夜魇</span><b>{match.data.direScore ?? "—"}</b></strong>
          <small>{!match.data.radiantWin ? "↑ 胜利" : "↓ 失利"}</small>
        </div>
      </section>

      <div className="match-teams">
        {[
          { label: "天辉", players: radiant, side: "radiant" },
          { label: "夜魇", players: dire, side: "dire" },
        ].map((team) => (
          <DataSection
            eyebrow={team.side.toUpperCase()}
            key={team.side}
            title={`${team.label}${teamDetailLabel}`}
          >
            <div
              className="participant-table"
              role="table"
              aria-label={`${team.label}${teamDetailLabel}`}
            >
              <div className="participant-table__head" role="row">
                <span role="columnheader">玩家 / 英雄</span>
                <span role="columnheader">K / D / A · 等级</span>
                <span role="columnheader">GPM / XPM</span>
                <span role="columnheader">补刀 / 反补</span>
                <span role="columnheader">英雄 / 塔伤</span>
                <span role="columnheader">最终装备</span>
              </div>
              {team.players.length > 0 ? team.players.map((player) => (
                <MatchPlayerRow
                  heroById={heroById}
                  itemById={itemById}
                  key={player.playerSlot}
                  player={player}
                />
              )) : (
                <div className="participant-table__empty" role="row">
                  <span role="cell">当前摘要未包含该阵营玩家。</span>
                </div>
              )}
            </div>
          </DataSection>
        ))}
      </div>

      <MetaLine sources={match.meta.sources} updatedAt={match.meta.updatedAt} />
      <p className="data-disclaimer">
        最终装备只表示赛后槽位；仅当上游提供真实交易事件时，时间线才展示购买或出售时间。
      </p>
    </div>
  );
}
