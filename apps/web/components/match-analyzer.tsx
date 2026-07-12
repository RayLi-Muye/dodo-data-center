"use client";

import type { HeroSummary, ItemSummary, MatchDetail } from "@dodo/contracts";
import Link from "next/link";
import { useState } from "react";

import {
  abilityUpgradeContext,
  itemTimelineNotice,
  resolveHeroAbility,
  type AbilitiesByHeroId,
} from "../lib/match-detail";
import { formatGameTime } from "../lib/format";
import { AssetImage } from "./asset-image";

type MatchPlayer = MatchDetail["players"][number];
type AnalyzerView = "abilities" | "items";

function PlayerPortrait({ hero }: { hero: HeroSummary | undefined }) {
  return hero ? (
    <AssetImage alt="" className="match-analyzer__hero-thumb" kind="hero" name={hero.name} />
  ) : (
    <span aria-hidden="true" className="asset-fallback match-analyzer__hero-thumb">?</span>
  );
}

export function MatchAnalyzer({
  abilitiesByHeroId,
  heroes,
  items,
  players,
}: {
  abilitiesByHeroId: AbilitiesByHeroId;
  heroes: HeroSummary[];
  items: ItemSummary[];
  players: MatchPlayer[];
}) {
  const [selectedSlot, setSelectedSlot] = useState(players[0]?.playerSlot ?? 0);
  const [view, setView] = useState<AnalyzerView>("abilities");
  const heroById = new Map(heroes.map((hero) => [hero.id, hero]));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const player = players.find((candidate) => candidate.playerSlot === selectedSlot) ?? players[0];

  if (!player) return null;

  const hero = heroById.get(player.heroId);
  const abilityBuild = [...player.abilityBuild].sort((left, right) => left.sequence - right.sequence);
  const itemTimeline = player.itemTimelineStatus === "unavailable"
    ? []
    : [...player.itemTimeline].sort((left, right) => left.gameTimeSeconds - right.gameTimeSeconds);
  const timelineNotice = itemTimelineNotice(player.itemTimelineStatus, itemTimeline.length);
  const panelId = `match-analyzer-${view}`;

  return (
    <section className="match-analyzer" aria-labelledby="match-analyzer-title">
      <header className="match-analyzer__heading">
        <span>PLAYER ANALYZER</span>
        <h2 id="match-analyzer-title">单场玩家分析</h2>
        <p>选择一名玩家，查看上游实际记录的加点顺序与物品交易。</p>
      </header>

      <div className="match-analyzer__players" aria-label="选择分析玩家">
        {players.map((candidate) => {
          const candidateHero = heroById.get(candidate.heroId);
          const selected = candidate.playerSlot === player.playerSlot;
          return (
            <button
              aria-pressed={selected}
              className={selected ? "match-analyzer__player is-selected" : "match-analyzer__player"}
              data-side={candidate.side}
              key={candidate.playerSlot}
              onClick={() => setSelectedSlot(candidate.playerSlot)}
              type="button"
            >
              <PlayerPortrait hero={candidateHero} />
              <span>
                <strong>{candidateHero?.localizedName ?? `英雄 #${candidate.heroId}`}</strong>
                <small>{candidate.side === "radiant" ? "天辉" : "夜魇"} · {candidate.accountId ?? "匿名玩家"}</small>
              </span>
            </button>
          );
        })}
      </div>

      <div className="match-analyzer__toolbar">
        <div className="match-analyzer__selected">
          <PlayerPortrait hero={hero} />
          <span>
            <small>{player.side === "radiant" ? "天辉" : "夜魇"} · 玩家</small>
            <strong>{hero?.localizedName ?? `英雄 #${player.heroId}`}</strong>
          </span>
        </div>
        <div className="match-analyzer__views" role="tablist" aria-label="选择分析维度">
          <button
            aria-controls="match-analyzer-abilities"
            aria-selected={view === "abilities"}
            id="match-analyzer-abilities-tab"
            onClick={() => setView("abilities")}
            role="tab"
            type="button"
          >
            技能加点
          </button>
          <button
            aria-controls="match-analyzer-items"
            aria-selected={view === "items"}
            id="match-analyzer-items-tab"
            onClick={() => setView("items")}
            role="tab"
            type="button"
          >
            物品时间线
          </button>
        </div>
      </div>

      <div
        aria-labelledby={`match-analyzer-${view}-tab`}
        className="match-analyzer__panel"
        id={panelId}
        role="tabpanel"
      >
        {view === "abilities" ? (
          player.abilityBuildStatus === "unavailable" ? (
            <p className="match-analyzer__notice">上游未提供技能加点顺序。</p>
          ) : abilityBuild.length === 0 ? (
            <p className="match-analyzer__notice">没有可展示的真实技能加点记录。</p>
          ) : (
            <ol className="match-analyzer__ability-list">
              {abilityBuild.map((event) => {
                const ability = resolveHeroAbility(abilitiesByHeroId, player.heroId, event.abilityId);
                return (
                  <li key={`${event.sequence}-${event.abilityId}`}>
                    <span aria-label={`第 ${event.sequence} 次加点`}>{String(event.sequence).padStart(2, "0")}</span>
                    {ability ? (
                      <AssetImage alt={`${ability.localizedName} 技能图标`} className="ability-thumb" kind="ability" name={ability.name} />
                    ) : (
                      <span aria-label={`技能 ${event.abilityId} 图标不可用`} className="asset-fallback asset-fallback--ability ability-thumb" role="img">?</span>
                    )}
                    <span>
                      <strong>{ability?.localizedName ?? `技能 #${event.abilityId}`}</strong>
                      <small>{abilityUpgradeContext(event, player.abilityBuildStatus)}</small>
                    </span>
                  </li>
                );
              })}
            </ol>
          )
        ) : (
          <>
            {timelineNotice ? <p className="match-analyzer__notice">{timelineNotice}</p> : null}
            {itemTimeline.length > 0 ? (
              <ol className="match-analyzer__item-list">
                {itemTimeline.map((event, index) => {
                  const item = itemById.get(event.itemId);
                  return (
                    <li className={`is-${event.action}`} key={`${event.gameTimeSeconds}-${event.itemId}-${index}`}>
                      <time>{formatGameTime(event.gameTimeSeconds)}</time>
                      {item ? (
                        <Link href={`/items/${encodeURIComponent(item.id)}`}>
                          <AssetImage alt="" className="item-thumb" kind="item" name={item.name} />
                          <span>{item.localizedName}</span>
                        </Link>
                      ) : (
                        <span className="match-analyzer__unknown-item">物品 #{event.itemId}</span>
                      )}
                      <strong>{event.action === "purchase" ? "+ 购买" : "− 出售"}</strong>
                      {event.charges !== null ? <small>{event.charges} 次充能</small> : null}
                    </li>
                  );
                })}
              </ol>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
