"use client";

import type { HeroSummary, ItemSummary, MatchDetail } from "@dodo/contracts";
import Link from "next/link";
import { useState } from "react";

import {
  abilityBuildNotice,
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
  selectedPlayerSlot,
}: {
  abilitiesByHeroId: AbilitiesByHeroId;
  heroes: HeroSummary[];
  items: ItemSummary[];
  players: MatchPlayer[];
  selectedPlayerSlot: number;
}) {
  const [view, setView] = useState<AnalyzerView>("abilities");
  const heroById = new Map(heroes.map((hero) => [hero.id, hero]));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const player = players.find((candidate) => candidate.playerSlot === selectedPlayerSlot) ?? players[0];

  if (!player) return null;

  const hero = heroById.get(player.heroId);
  const abilityBuild = [...player.abilityBuild].sort((left, right) => left.sequence - right.sequence);
  const abilityNotice = abilityBuildNotice(player.abilityBuildStatus, abilityBuild.length);
  const itemTimeline = player.itemTimelineStatus === "unavailable"
    ? []
    : [...player.itemTimeline].sort((left, right) => left.gameTimeSeconds - right.gameTimeSeconds);
  const timelineNotice = itemTimelineNotice(player.itemTimelineStatus, itemTimeline.length);
  const panelId = `match-analyzer-${view}`;

  return (
    <section className="match-analyzer" aria-labelledby="match-analyzer-title">
      <header className="match-analyzer__heading">
        <div className="match-analyzer__selected">
          <PlayerPortrait hero={hero} />
          <span>
            <small>PLAYER BUILD / {player.side === "radiant" ? "天辉" : "夜魇"}</small>
            <h2 id="match-analyzer-title">{hero?.localizedName ?? `英雄 #${player.heroId}`}的出装与加点</h2>
          </span>
        </div>
        <p>仅展示上游实际返回的最终槽位、加点顺序与物品交易。</p>
      </header>

      <div className="match-build-loadout" aria-label="最终物品">
        {[
          { ids: player.finalItemIds, label: "装备" },
          { ids: player.backpackItemIds, label: "背包" },
          { ids: player.neutralItemId ? [player.neutralItemId] : [], label: "中立物品" },
          { ids: player.neutralItemEnhancementId ? [player.neutralItemEnhancementId] : [], label: "中立附魔" },
        ].map((group) => (
          <div key={group.label}>
            <small>{group.label}</small>
            <span className="item-rack">
              {group.ids.length === 0 ? <em>无记录</em> : group.ids.map((itemId, index) => {
                const item = itemById.get(itemId);
                return item ? (
                  <Link href={`/items/${encodeURIComponent(item.id)}`} key={`${itemId}-${index}`} title={item.localizedName}>
                    <AssetImage alt={item.localizedName} className="item-thumb" kind="item" name={item.name} />
                  </Link>
                ) : <span className="asset-fallback asset-fallback--item item-thumb" key={`${itemId}-${index}`}>#{itemId}</span>;
              })}
            </span>
          </div>
        ))}
      </div>

      <div className="match-analyzer__toolbar">
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
          <>
            {abilityNotice ? <p className="match-analyzer__notice">{abilityNotice}</p> : null}
            {abilityBuild.length > 0 ? (
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
            ) : null}
          </>
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
