import type { ItemSummary } from "@dodo/contracts";
import { MetaLine } from "@dodo/ui";
import Link from "next/link";

import { AssetImage } from "../../components/asset-image";
import { DataState, EmptyState } from "../../components/data-state";
import { PageHeading } from "../../components/page-heading";
import { QualityNotice } from "../../components/quality-notice";
import { collectAllItemsWithMeta, settle } from "../../lib/api";

export default async function ItemsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = await searchParams;
  const result = await settle(collectAllItemsWithMeta(query.q));
  const currentQuery = new URLSearchParams({ ...(query.q ? { q: query.q } : {}) }).toString();
  const currentHref = currentQuery ? `/items?${currentQuery}` : "/items";
  return (
    <div className="page-shell encyclopedia-page">
      <PageHeading eyebrow="ENCYCLOPEDIA / ITEMS" lead="浏览当前版本物品目录、价格与效果；已移除物品和配方图纸不进入目录。" title="物品百科" />
      <form className="catalog-search" method="get" role="search">
        <label htmlFor="item-search">搜索物品</label>
        <div>
          <input autoComplete="off" defaultValue={query.q ?? ""} id="item-search" inputMode="search" name="q" placeholder="输入物品中文名或内部名称…" spellCheck={false} type="search" />
          <button type="submit">筛选物品</button>
        </div>
      </form>
      {!result.ok ? <DataState error={result.error} retryHref={currentHref} /> : (() => {
        const currentItems = result.value.items.filter((item) => item.kind !== "recipe");
        const groups = groupCurrentItems(currentItems);
        return (
        <section className="catalog-workbench item-shop">
          <header className="catalog-workbench__header">
            <div><span>CURRENT ITEM SHOP</span><h2>{query.q ? `“${query.q}” 的物品结果` : "当前物品目录"}</h2></div>
            <MetaLine sources={result.value.meta.sources} updatedAt={result.value.meta.updatedAt} />
          </header>
          <QualityNotice label="物品百科" quality={result.value.meta.quality} showComplete />
          {currentItems.length === 0 ? (
            <EmptyState detail="尝试缩短关键词，或清空搜索查看当前快照中的全部物品。" title="没有匹配物品" />
          ) : (
            <div className="item-shop__groups">
              {groups.map((group) => (
                <section className="item-shop-group" key={group.key}>
                  <header><div><span>SHOP CATEGORY</span><h3>{group.label}</h3></div><strong>{group.items.length}</strong></header>
                  <div className="item-shop-grid">
                    {group.items.map((item) => (
                      <Link className="item-shop-tile" href={`/items/${encodeURIComponent(item.id)}`} key={item.id}>
                        <AssetImage alt={`${item.localizedName} 物品图标`} className="item-shop-tile__image" kind="item" name={item.name} />
                        <span>{item.localizedName}</span>
                        <strong>{item.cost.toLocaleString("zh-CN")} <small>金</small></strong>
                      </Link>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </section>
        );
      })()}
    </div>
  );
}

const officialCategory: Record<string, { label: string; rank: number }> = {
  official_quality_0: { label: "消耗用品", rank: 10 },
  official_quality_1: { label: "基础组件", rank: 11 },
  official_quality_2: { label: "常规装备", rank: 12 },
  official_quality_3: { label: "进阶装备", rank: 13 },
  official_quality_4: { label: "高阶装备", rank: 14 },
  official_quality_5: { label: "特殊装备", rank: 15 },
  official_quality_6: { label: "神秘商店组件", rank: 16 },
};

function itemDisplayGroup(item: ItemSummary) {
  if (item.kind === "neutral_enhancement") {
    return { key: "neutral_enhancement", label: "中立附魔", rank: 90 };
  }
  if (item.kind === "neutral_item") {
    const tier = /^neutral_tier_(\d+)$/.exec(item.category)?.[1];
    return tier
      ? { key: `neutral_item_${tier}`, label: `中立物品 · ${tier} 级`, rank: 80 + Number(tier) }
      : { key: "neutral_item", label: "中立物品", rank: 89 };
  }
  const official = officialCategory[item.category];
  if (official) return { key: item.category, ...official };
  return { key: "other", label: "其他当前物品", rank: 100 };
}

function groupCurrentItems(items: ItemSummary[]) {
  const groups = new Map<string, { items: ItemSummary[]; key: string; label: string; rank: number }>();
  for (const item of items) {
    const descriptor = itemDisplayGroup(item);
    const group = groups.get(descriptor.key);
    if (group) group.items.push(item);
    else groups.set(descriptor.key, { ...descriptor, items: [item] });
  }
  return [...groups.values()].sort((left, right) => left.rank - right.rank || left.label.localeCompare(right.label, "zh-CN"));
}
