"use client";

import type { HeroSummary, ItemSummary, MatchDetail } from "@dodo/contracts";
import { DataSection, StatusNotice } from "@dodo/ui";
import { useMemo, useState, type ReactNode } from "react";

import {
  advancedSectionPresentation,
  aggregatePlayerMetric,
  aggregateTeamTimelines,
  chartPolyline,
  comparisonWidth,
  type AdvancedSectionStatus,
} from "../lib/match-analysis";
import { formatGameTime } from "../lib/format";
import type { AbilitiesByHeroId } from "../lib/match-detail";
import { AssetImage } from "./asset-image";
import { MatchAnalyzer } from "./match-analyzer";
import { MatchEnrichmentStatus } from "./match-enrichment-status";
import { MatchPlayerRow } from "./match-player-row";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

type MatchPlayer = MatchDetail["players"][number];
type MetricField = "gpm" | "heroDamage" | "heroHealing" | "kills" | "netWorth" | "xpm";

const tabs = [
  { label: "概览", value: "overview" },
  { label: "发育", value: "development" },
  { label: "战斗", value: "combat" },
  { label: "目标", value: "objectives" },
  { label: "构筑", value: "build" },
] as const;

function formatMetric(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("zh-CN");
}

function PlayerSelector({
  heroById,
  onSelect,
  players,
  selectedSlot,
}: {
  heroById: Map<string, HeroSummary>;
  onSelect: (playerSlot: number) => void;
  players: MatchPlayer[];
  selectedSlot: number;
}) {
  return (
    <div aria-label="选择玩家" className="match-player-selector">
      {players.map((player) => {
        const hero = heroById.get(player.heroId);
        return (
          <button
            aria-pressed={player.playerSlot === selectedSlot}
            data-side={player.side}
            key={player.playerSlot}
            onClick={() => onSelect(player.playerSlot)}
            type="button"
          >
            {hero ? (
              <AssetImage alt="" className="match-player-selector__hero" kind="hero" name={hero.name} />
            ) : (
              <span aria-hidden="true" className="asset-fallback match-player-selector__hero">?</span>
            )}
            <span>
              <strong>{hero?.localizedName ?? `英雄 #${player.heroId}`}</strong>
              <small>{player.side === "radiant" ? "天辉" : "夜魇"}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function AnalysisState({
  children,
  completeEmptyDetail,
  count,
  excludedCount,
  label,
  status,
}: {
  children: ReactNode;
  completeEmptyDetail: string;
  count: number;
  excludedCount: number;
  label: string;
  status: AdvancedSectionStatus;
}) {
  const presentation = advancedSectionPresentation({
    completeEmptyDetail,
    count,
    excludedCount,
    label,
    status,
  });
  return (
    <div className={`match-analysis-state match-analysis-state--${presentation.tone}`}>
      {presentation.tone !== "complete" || !presentation.showData ? <p>{presentation.detail}</p> : null}
      {presentation.showData ? children : null}
    </div>
  );
}

function MiniLineChart({ label, points }: { label: string; points: string[] | null }) {
  return (
    <figure className="match-mini-chart">
      <figcaption>{label}</figcaption>
      {points ? (
        <svg aria-label={`${label}随游戏时间变化`} preserveAspectRatio="none" role="img" viewBox="0 0 100 40">
          {points.map((segment, index) => <polyline className="match-mini-chart__line" fill="none" key={index} points={segment} vectorEffect="non-scaling-stroke" />)}
        </svg>
      ) : <p>有效数值采样点不足以绘图。</p>}
    </figure>
  );
}

function MetricSummary({ entries }: { entries: Array<{ label: string; value: string }> }) {
  return (
    <dl className="match-metric-summary">
      {entries.map((entry) => <div key={entry.label}><dt>{entry.label}</dt><dd>{entry.value}</dd></div>)}
    </dl>
  );
}

function PlayerComparison({
  field,
  heroById,
  label,
  players,
}: {
  field: MetricField;
  heroById: Map<string, HeroSummary>;
  label: string;
  players: MatchPlayer[];
}) {
  const values = players.map((player) => player[field]);
  return (
    <section className="match-comparison" aria-label={`${label}同场比较`}>
      <header><h3>{label}</h3><small>按本场最高值归一化</small></header>
      <ol>
        {players.map((player) => {
          const value = player[field];
          const hero = heroById.get(player.heroId);
          return (
            <li key={player.playerSlot}>
              <span>{hero?.localizedName ?? `英雄 #${player.heroId}`}</span>
              <span aria-hidden="true" className="match-comparison__track"><i style={{ width: `${comparisonWidth(value, values)}%` }} /></span>
              <strong>{formatMetric(value)}</strong>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function OverviewPanel({
  heroById,
  itemById,
  match,
}: {
  heroById: Map<string, HeroSummary>;
  itemById: Map<string, ItemSummary>;
  match: MatchDetail;
}) {
  const radiant = match.players.filter((player) => player.side === "radiant");
  const dire = match.players.filter((player) => player.side === "dire");
  const completeLineup = match.detailStatus === "enriched" && radiant.length === 5 && dire.length === 5;
  return (
    <div className="match-tab-stack">
      <StatusNotice
        detail={completeLineup
          ? "双方完整阵容已载入；单项缺失仍以破折号标记。"
          : match.detailStatus === "enriched"
            ? "增强字段已载入，但双方阵容不足十人；不会补造缺失玩家。"
            : "当前仅有比赛摘要；保留真实字段并等待详情补全。"}
        title={completeLineup ? "完整阵容" : match.detailStatus === "enriched" ? "阵容部分可用" : "比赛摘要"}
        tone={completeLineup ? "neutral" : "warning"}
      />
      <div className="match-teams match-teams--compact">
        {[
          { label: "天辉", players: radiant, side: "radiant" },
          { label: "夜魇", players: dire, side: "dire" },
        ].map((team) => (
          <DataSection eyebrow={team.side.toUpperCase()} key={team.side} title={`${team.label}阵容`}>
            <div className="participant-table" role="table" aria-label={`${team.label}阵容`}>
              {team.players.length > 0 ? team.players.map((player) => (
                <MatchPlayerRow compact heroById={heroById} itemById={itemById} key={player.playerSlot} player={player} />
              )) : <div className="participant-table__empty" role="row"><span role="cell">当前响应未包含该阵营玩家。</span></div>}
            </div>
          </DataSection>
        ))}
      </div>
      <MatchEnrichmentStatus match={match} />
    </div>
  );
}

function DevelopmentPanel({ heroById, match, player }: { heroById: Map<string, HeroSummary>; match: MatchDetail; player: MatchPlayer }) {
  const timeline = match.analysis.playerTimelines.players.find((candidate) => candidate.playerSlot === player.playerSlot);
  const timelineSamples = timeline?.samples ?? [];
  const teamSamples = match.analysis.teamAdvantages.samples;
  const teamTotals = aggregateTeamTimelines(match);
  const teamTotalsStatus = match.analysis.playerTimelines.status === "unavailable"
    ? "unavailable"
    : match.analysis.playerTimelines.status === "partial" || teamTotals.excludedCount > 0
      ? "partial"
      : "complete";
  return (
    <div className="match-tab-stack">
      <DataSection eyebrow="FINAL DEVELOPMENT" title="最终发育指标">
        <MetricSummary entries={[
          { label: "等级", value: formatMetric(player.level) },
          { label: "净资产", value: formatMetric(player.netWorth) },
          { label: "GPM", value: formatMetric(player.gpm) },
          { label: "XPM", value: formatMetric(player.xpm) },
          { label: "补刀", value: formatMetric(player.lastHits) },
          { label: "反补", value: formatMetric(player.denies) },
        ]} />
        <p className="match-panel-note">以上为赛后最终值；下方曲线仅在上游提供真实采样时显示。</p>
      </DataSection>
      <div className="match-comparison-grid">
        <PlayerComparison field="netWorth" heroById={heroById} label="净资产" players={match.players} />
        <PlayerComparison field="gpm" heroById={heroById} label="GPM" players={match.players} />
        <PlayerComparison field="xpm" heroById={heroById} label="XPM" players={match.players} />
      </div>
      <DataSection eyebrow="PLAYER TIMELINE" title="玩家发育曲线">
        <AnalysisState
          completeEmptyDetail="完整响应中没有该玩家的发育采样。"
          count={timelineSamples.length}
          excludedCount={match.analysis.playerTimelines.excludedCount}
          label="玩家发育时间线"
          status={match.analysis.playerTimelines.status}
        >
          <div className="match-chart-grid">
            <MiniLineChart label="金币" points={chartPolyline(timelineSamples, (sample) => sample.gameTimeSeconds, (sample) => sample.gold)} />
            <MiniLineChart label="经验" points={chartPolyline(timelineSamples, (sample) => sample.gameTimeSeconds, (sample) => sample.xp)} />
          </div>
        </AnalysisState>
      </DataSection>
      <DataSection eyebrow="TEAM TOTALS" title="双方团队发育总量">
        <AnalysisState
          completeEmptyDetail="完整响应中没有可汇总的团队发育采样。"
          count={teamTotals.samples.length}
          excludedCount={match.analysis.playerTimelines.excludedCount + teamTotals.excludedCount}
          label="团队发育总量"
          status={teamTotalsStatus}
        >
          <p className="match-panel-note">同一时点必须同时具备双方各五名玩家的有效值才纳入，缺失值不会按 0 补齐。</p>
          <div className="match-chart-grid">
            <MiniLineChart label="天辉团队金币" points={chartPolyline(teamTotals.samples, (sample) => sample.gameTimeSeconds, (sample) => sample.radiantGold)} />
            <MiniLineChart label="夜魇团队金币" points={chartPolyline(teamTotals.samples, (sample) => sample.gameTimeSeconds, (sample) => sample.direGold)} />
            <MiniLineChart label="天辉团队经验" points={chartPolyline(teamTotals.samples, (sample) => sample.gameTimeSeconds, (sample) => sample.radiantXp)} />
            <MiniLineChart label="夜魇团队经验" points={chartPolyline(teamTotals.samples, (sample) => sample.gameTimeSeconds, (sample) => sample.direXp)} />
          </div>
        </AnalysisState>
      </DataSection>
      <DataSection eyebrow="TEAM ADVANTAGE" title="天辉团队优势">
        <AnalysisState
          completeEmptyDetail="完整响应中没有团队优势采样。"
          count={teamSamples.length}
          excludedCount={match.analysis.teamAdvantages.excludedCount}
          label="团队优势时间线"
          status={match.analysis.teamAdvantages.status}
        >
          <p className="match-panel-note">正值代表天辉领先，负值代表夜魇领先；横轴为上游推定的 60 秒采样。</p>
          <div className="match-chart-grid">
            <MiniLineChart label="天辉金币优势" points={chartPolyline(teamSamples, (sample) => sample.gameTimeSeconds, (sample) => sample.radiantGoldAdvantage)} />
            <MiniLineChart label="天辉经验优势" points={chartPolyline(teamSamples, (sample) => sample.gameTimeSeconds, (sample) => sample.radiantXpAdvantage)} />
          </div>
        </AnalysisState>
      </DataSection>
    </div>
  );
}

function CombatPanel({ heroById, match, player }: { heroById: Map<string, HeroSummary>; match: MatchDetail; player: MatchPlayer }) {
  const killEvents = match.analysis.kills.events;
  const damage = match.analysis.damage.players.find((candidate) => candidate.playerSlot === player.playerSlot);
  const heroBySlot = new Map(match.players.map((candidate) => [candidate.playerSlot, heroById.get(candidate.heroId)]));
  return (
    <div className="match-tab-stack">
      <DataSection eyebrow="FINAL COMBAT" title="最终战斗指标">
        <MetricSummary entries={[
          { label: "击杀", value: formatMetric(player.kills) },
          { label: "死亡", value: formatMetric(player.deaths) },
          { label: "助攻", value: formatMetric(player.assists) },
          { label: "英雄伤害", value: formatMetric(player.heroDamage) },
          { label: "英雄治疗", value: formatMetric(player.heroHealing) },
        ]} />
      </DataSection>
      <div className="match-comparison-grid">
        <PlayerComparison field="heroDamage" heroById={heroById} label="英雄伤害" players={match.players} />
        <PlayerComparison field="heroHealing" heroById={heroById} label="英雄治疗" players={match.players} />
        <PlayerComparison field="kills" heroById={heroById} label="击杀" players={match.players} />
      </div>
      <DataSection eyebrow="KILL EVENTS" title="击杀记录">
        <AnalysisState
          completeEmptyDetail="完整击杀事件响应确认本场没有击杀记录。"
          count={killEvents.length}
          excludedCount={match.analysis.kills.excludedCount}
          label="击杀事件"
          status={match.analysis.kills.status}
        >
          <ol className="match-event-list">
            {killEvents.map((event, index) => (
              <li key={`${event.gameTimeSeconds}-${event.killerPlayerSlot}-${index}`}>
                <time>{formatGameTime(event.gameTimeSeconds)}</time>
                <strong>{heroBySlot.get(event.killerPlayerSlot)?.localizedName ?? `玩家槽位 ${event.killerPlayerSlot}`}</strong>
                <span>击杀 {event.victimEntityName}</span>
              </li>
            ))}
          </ol>
        </AnalysisState>
      </DataSection>
      <DataSection eyebrow="DAMAGE BREAKDOWN" title="伤害明细">
        <AnalysisState
          completeEmptyDetail="完整响应中没有该玩家的伤害明细。"
          count={damage ? damage.dealtToEntities.length + damage.receivedFromEntities.length + damage.dealtBySources.length + damage.receivedBySources.length : 0}
          excludedCount={match.analysis.damage.excludedCount}
          label="伤害明细"
          status={match.analysis.damage.status}
        >
          {damage ? (
            <div className="match-breakdown-grid">
              {[
                { entries: damage.dealtToEntities, label: "对实体造成" },
                { entries: damage.receivedFromEntities, label: "从实体承受" },
                { entries: damage.dealtBySources, label: "按来源造成" },
                { entries: damage.receivedBySources, label: "按来源承受" },
              ].map((group) => (
                <section key={group.label}><h3>{group.label}</h3><dl>{group.entries.map((entry, index) => <div key={`${entry.entityName}-${index}`}><dt>{entry.entityName}</dt><dd>{entry.amount.toLocaleString("zh-CN")}</dd></div>)}</dl></section>
              ))}
            </div>
          ) : null}
        </AnalysisState>
      </DataSection>
    </div>
  );
}

function ObjectivesPanel({ heroById, match, player }: { heroById: Map<string, HeroSummary>; match: MatchDetail; player: MatchPlayer }) {
  const objectives = match.analysis.objectives.events;
  const fights = match.analysis.teamfights.fights;
  const heroBySlot = new Map(match.players.map((candidate) => [candidate.playerSlot, heroById.get(candidate.heroId)]));
  const radiantTowerDamage = aggregatePlayerMetric(match.players, "radiant", "towerDamage");
  const direTowerDamage = aggregatePlayerMetric(match.players, "dire", "towerDamage");
  const teamMetric = (metric: typeof radiantTowerDamage) => metric.value === null
    ? `—（${metric.observedCount}/${metric.eligibleCount}）`
    : metric.value.toLocaleString("zh-CN");
  return (
    <div className="match-tab-stack">
      <DataSection eyebrow="FINAL OBJECTIVE PRESSURE" title="防御塔伤害">
        <MetricSummary entries={[
          { label: "所选玩家", value: formatMetric(player.towerDamage) },
          { label: "天辉合计", value: teamMetric(radiantTowerDamage) },
          { label: "夜魇合计", value: teamMetric(direTowerDamage) },
        ]} />
        <p className="match-panel-note">团队合计仅在该阵营全部已载入玩家都有该字段时计算；括号表示已观测/应观测人数。</p>
      </DataSection>
      <DataSection eyebrow="OBJECTIVES" title="目标事件">
        <AnalysisState
          completeEmptyDetail="完整目标事件响应确认本场没有目标事件记录。"
          count={objectives.length}
          excludedCount={match.analysis.objectives.excludedCount}
          label="目标事件"
          status={match.analysis.objectives.status}
        >
          <ol className="match-event-list">
            {objectives.map((event, index) => (
              <li key={`${event.gameTimeSeconds}-${event.type}-${index}`}>
                <time>{formatGameTime(event.gameTimeSeconds)}</time>
                <strong>{event.type}</strong>
                <span>{[event.key, event.unit, event.team === "radiant" ? "天辉" : event.team === "dire" ? "夜魇" : null, event.playerSlot === null ? null : heroBySlot.get(event.playerSlot)?.localizedName ?? `槽位 ${event.playerSlot}`].filter(Boolean).join(" · ") || "无附加字段"}</span>
              </li>
            ))}
          </ol>
        </AnalysisState>
      </DataSection>
      <DataSection eyebrow="TEAMFIGHTS" title="团战记录">
        <AnalysisState
          completeEmptyDetail="完整团战响应确认本场没有团战记录。"
          count={fights.length}
          excludedCount={match.analysis.teamfights.excludedCount}
          label="团战记录"
          status={match.analysis.teamfights.status}
        >
          <ol className="match-teamfight-list">
            {fights.map((fight, index) => {
              const contribution = fight.players.find((candidate) => candidate.playerSlot === player.playerSlot);
              return (
                <li key={`${fight.startTimeSeconds}-${index}`}>
                  <header><span>团战 {String(index + 1).padStart(2, "0")}</span><time>{formatGameTime(fight.startTimeSeconds)}–{formatGameTime(fight.endTimeSeconds)}</time></header>
                  <dl>
                    <div><dt>死亡数</dt><dd>{fight.deathCount}</dd></div>
                    <div><dt>最后死亡</dt><dd>{fight.lastDeathTimeSeconds === null ? "—" : formatGameTime(fight.lastDeathTimeSeconds)}</dd></div>
                    <div><dt>所选玩家伤害</dt><dd>{contribution ? contribution.damage.toLocaleString("zh-CN") : "—"}</dd></div>
                    <div><dt>所选玩家治疗</dt><dd>{contribution ? contribution.healing.toLocaleString("zh-CN") : "—"}</dd></div>
                    <div><dt>买活</dt><dd>{contribution?.buybacks ?? "—"}</dd></div>
                    <div><dt>金钱变化</dt><dd>{contribution ? `${contribution.goldDelta > 0 ? "+" : ""}${contribution.goldDelta.toLocaleString("zh-CN")}` : "—"}</dd></div>
                    <div><dt>经验变化</dt><dd>{contribution ? `${contribution.xpDelta > 0 ? "+" : ""}${contribution.xpDelta.toLocaleString("zh-CN")}` : "—"}</dd></div>
                  </dl>
                </li>
              );
            })}
          </ol>
        </AnalysisState>
      </DataSection>
    </div>
  );
}

export function MatchDetailWorkbench({
  abilitiesByHeroId,
  heroes,
  items,
  match,
}: {
  abilitiesByHeroId: AbilitiesByHeroId;
  heroes: HeroSummary[];
  items: ItemSummary[];
  match: MatchDetail;
}) {
  const [selectedPlayerSlot, setSelectedPlayerSlot] = useState(match.players[0]?.playerSlot ?? 0);
  const heroById = useMemo(() => new Map(heroes.map((hero) => [hero.id, hero])), [heroes]);
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const player = match.players.find((candidate) => candidate.playerSlot === selectedPlayerSlot) ?? match.players[0];
  if (!player) return null;

  return (
    <Tabs className="match-workbench" defaultValue="overview">
      <div className="match-workbench__controls">
        <TabsList aria-label="比赛详情维度" className="match-workbench__tabs" variant="line">
          {tabs.map((tab) => <TabsTrigger key={tab.value} value={tab.value}>{tab.label}</TabsTrigger>)}
        </TabsList>
        <PlayerSelector heroById={heroById} onSelect={setSelectedPlayerSlot} players={match.players} selectedSlot={player.playerSlot} />
      </div>
      <TabsContent value="overview"><OverviewPanel heroById={heroById} itemById={itemById} match={match} /></TabsContent>
      <TabsContent value="development"><DevelopmentPanel heroById={heroById} match={match} player={player} /></TabsContent>
      <TabsContent value="combat"><CombatPanel heroById={heroById} match={match} player={player} /></TabsContent>
      <TabsContent value="objectives"><ObjectivesPanel heroById={heroById} match={match} player={player} /></TabsContent>
      <TabsContent value="build"><MatchAnalyzer abilitiesByHeroId={abilitiesByHeroId} heroes={heroes} items={items} players={match.players} selectedPlayerSlot={player.playerSlot} /></TabsContent>
    </Tabs>
  );
}
