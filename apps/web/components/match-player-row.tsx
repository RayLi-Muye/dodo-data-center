import type { HeroSummary, ItemSummary, MatchDetail } from "@dodo/contracts";
import Link from "next/link";

import { AssetImage } from "./asset-image";

function ItemAsset({
  itemById,
  itemId,
  slot,
}: {
  itemById: Map<string, ItemSummary>;
  itemId: string;
  slot: string;
}) {
  const item = itemById.get(itemId);
  return item ? (
    <Link href={`/items/${encodeURIComponent(item.id)}`} title={`${slot}：${item.localizedName}`}>
      <AssetImage alt={item.localizedName} className="item-thumb" kind="item" name={item.name} />
    </Link>
  ) : (
    <span
      aria-label={`${slot}物品 ${itemId} 图片不可用`}
      className="asset-fallback asset-fallback--item item-thumb"
      role="img"
    >
      #{itemId}
    </span>
  );
}

function ItemGroup({
  emptyLabel,
  itemById,
  itemIds,
  label,
}: {
  emptyLabel: string;
  itemById: Map<string, ItemSummary>;
  itemIds: string[];
  label: string;
}) {
  return (
    <div className="participant-items__group">
      <small>{label}</small>
      <span className="item-rack">
        {itemIds.length > 0
          ? itemIds.map((itemId, index) => (
            <ItemAsset itemById={itemById} itemId={itemId} key={`${label}-${itemId}-${index}`} slot={label} />
          ))
          : <em>{emptyLabel}</em>}
      </span>
    </div>
  );
}

export function MatchPlayerRow({
  compact = false,
  heroById,
  itemById,
  player,
}: {
  compact?: boolean;
  heroById: Map<string, HeroSummary>;
  itemById: Map<string, ItemSummary>;
  player: MatchDetail["players"][number];
}) {
  const hero = heroById.get(player.heroId);

  return (
    <div className={compact ? "participant-table__row participant-table__row--compact" : "participant-table__row"} role="row">
      <span className="participant-identity" data-label="玩家 / 英雄" role="cell">
        {hero ? (
          <AssetImage alt={hero.localizedName} className="hero-thumb" kind="hero" name={hero.name} />
        ) : (
          <span
            aria-label={`英雄 ${player.heroId} 图片不可用`}
            className="asset-fallback asset-fallback--hero hero-thumb"
            role="img"
          >
            ?
          </span>
        )}
        <span>
          {player.accountId ? (
            <Link href={`/players/${encodeURIComponent(player.accountId)}`}>{player.accountId}</Link>
          ) : <strong>匿名玩家</strong>}
          <small>
            {hero ? (
              <Link href={`/heroes/${encodeURIComponent(hero.id)}`}>{hero.localizedName}</Link>
            ) : `英雄 #${player.heroId}`}
          </small>
        </span>
      </span>

      <span className="participant-kda" data-label="K / D / A · 等级" role="cell">
        <b>{player.kills}</b><i>/</i><b>{player.deaths}</b><i>/</i><b>{player.assists}</b>
        <small>Lv. {player.level ?? "—"}</small>
      </span>
      {compact ? null : <span data-label="GPM / XPM" role="cell">
        {player.gpm ?? "—"} <i>/</i> {player.xpm ?? "—"}
      </span>}
      {compact ? null : <span data-label="补刀 / 反补" role="cell">
        {player.lastHits ?? "—"} <i>/</i> {player.denies ?? "—"}
      </span>}
      {compact ? null : <span data-label="英雄 / 防御塔伤害" role="cell">
        {player.heroDamage?.toLocaleString("zh-CN") ?? "—"}
        <i>/</i>
        {player.towerDamage?.toLocaleString("zh-CN") ?? "—"}
      </span>}

      <div className="participant-items" data-label="最终装备" role="cell">
        <ItemGroup emptyLabel="无装备记录" itemById={itemById} itemIds={player.finalItemIds} label="装备" />
        {compact ? null : <ItemGroup emptyLabel="无背包记录" itemById={itemById} itemIds={player.backpackItemIds} label="背包" />}
        {compact ? null : <ItemGroup
          emptyLabel="无中立物品记录"
          itemById={itemById}
          itemIds={player.neutralItemId ? [player.neutralItemId] : []}
          label="中立物品"
        />}
        {compact ? null : <ItemGroup
          emptyLabel="无中立附魔记录"
          itemById={itemById}
          itemIds={player.neutralItemEnhancementId ? [player.neutralItemEnhancementId] : []}
          label="中立附魔"
        />}
      </div>
    </div>
  );
}
