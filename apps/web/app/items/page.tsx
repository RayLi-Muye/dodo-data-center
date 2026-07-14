import { MetaLine } from "@dodo/ui";
import Link from "next/link";

import { AssetImage } from "../../components/asset-image";
import { DataState, EmptyState } from "../../components/data-state";
import { ItemDetailPanel } from "../../components/item-detail-panel";
import { PageHeading } from "../../components/page-heading";
import { QualityNotice } from "../../components/quality-notice";
import { api, collectAllItemsWithMeta, settle } from "../../lib/api";
import { buildItemCatalogEntries, filterItemCatalogEntries, findItemCatalogEntry, groupItemCatalogEntries, itemCatalogHref } from "../../lib/item-catalog";

type ItemQuery = { q?: string; selected?: string };

export default async function ItemsPage({ searchParams }: { searchParams: Promise<ItemQuery> }) {
  const query = await searchParams;
  const result = await settle(collectAllItemsWithMeta());
  const currentQuery = new URLSearchParams({ ...(query.q ? { q: query.q } : {}), ...(query.selected ? { selected: query.selected } : {}) }).toString();
  const currentHref = currentQuery ? `/items?${currentQuery}` : "/items";
  return (
    <div className="page-shell encyclopedia-page encyclopedia-page--items">
      <PageHeading eyebrow="ENCYCLOPEDIA / ITEMS" lead="浏览当前版本物品目录、价格与效果；已移除物品和配方图纸不进入目录。" title="物品百科" />
      <form className="catalog-search" method="get" role="search">
        <label htmlFor="item-search">搜索物品</label>
        <div>
          <input autoComplete="off" defaultValue={query.q ?? ""} id="item-search" inputMode="search" name="q" placeholder="输入物品中文名或内部名称…" spellCheck={false} type="search" />
          <button type="submit">筛选物品</button>
        </div>
      </form>
      {!result.ok ? <DataState error={result.error} retryHref={currentHref} /> : (
        <ItemCatalogResult query={query} result={result.value} />
      )}
    </div>
  );
}

async function ItemCatalogResult({ query, result }: {
  query: ItemQuery;
  result: Awaited<ReturnType<typeof collectAllItemsWithMeta>>;
}) {
  const entries = filterItemCatalogEntries(
    buildItemCatalogEntries(result.items.filter((item) => item.kind !== "recipe")),
    query.q,
  );
  const currentItems = entries.flatMap((entry) => entry.members.map(({ item }) => item));
  const zones = groupItemCatalogEntries(entries);
  const selectedEntry = findItemCatalogEntry(entries, query.selected) ?? entries[0];
  const selectedMember = selectedEntry?.members.find((member) => member.item.id === query.selected) ?? selectedEntry?.members[0];

  if (currentItems.length === 0 || !selectedEntry || !selectedMember) {
    return <EmptyState detail="尝试缩短关键词，或清空搜索查看当前快照中的全部物品。" title="没有匹配物品" />;
  }

  const detailResults = await Promise.all(selectedEntry.members.map((member) => settle(api.item(member.item.id))));
  const familyDetails = detailResults.flatMap((candidate) => candidate.ok ? [candidate.value.data] : []);
  const selectedDetailResult = detailResults[selectedEntry.members.indexOf(selectedMember)];
  const selectedResponse = selectedDetailResult?.ok ? selectedDetailResult.value : null;
  const componentResults = selectedResponse
    ? await Promise.all(selectedResponse.data.components.map((id) => settle(api.item(id))))
    : [];
  const components = componentResults.flatMap((candidate) => candidate.ok ? [candidate.value.data] : []);

  return (
    <section className="catalog-workbench item-shop">
      <header className="catalog-workbench__header">
        <div>
          <span>CURRENT ITEM SHOP</span>
          <h2>{query.q ? `“${query.q}” 的物品结果` : "当前物品目录"}</h2>
          <p>{currentItems.length} 个实体 / {entries.length} 个目录入口</p>
        </div>
        <MetaLine sources={result.meta.sources} updatedAt={result.meta.updatedAt} />
      </header>
      <QualityNotice label="物品百科" quality={result.meta.quality} showComplete />
      <div className="item-workbench">
        <div className="item-workbench__catalog">
          {zones.map((zone) => (
            <section className={`item-zone item-zone--${zone.key}`} key={zone.key}>
              <header><h2>{zone.label}</h2><span>{zone.groups.reduce((total, group) => total + group.entries.length, 0)} 项</span></header>
              {zone.groups.map((group) => (
                <section className="item-shop-group" key={group.key}>
                  <header><h3>{group.label}</h3><strong>{group.entries.length}</strong></header>
                  <div className="item-shop-grid">
                    {group.entries.map((entry) => {
                      const selected = entry.id === selectedEntry.id;
                      return (
                        <Link
                          aria-current={selected ? "true" : undefined}
                          aria-label={`${entry.item.localizedName}${entry.members.length > 1 ? `，${entry.members.length} 级可升级物品` : ""}`}
                          className="item-shop-tile"
                          href={itemCatalogHref(entry.item.id, query.q)}
                          key={entry.id}
                          title={entry.item.localizedName}
                        >
                          <AssetImage alt="" className="item-shop-tile__image" kind="item" name={entry.item.name} />
                          <span className="sr-only">{entry.item.localizedName}</span>
                          {entry.members.length > 1 ? <small>{entry.members.length}级</small> : null}
                        </Link>
                      );
                    })}
                  </div>
                </section>
              ))}
            </section>
          ))}
        </div>
        {selectedResponse ? (
          <ItemDetailPanel
            components={components}
            detail={selectedResponse.data}
            entry={selectedEntry}
            familyDetails={familyDetails}
            meta={selectedResponse.meta}
            q={query.q}
          />
        ) : (
          <div className="item-inspector"><DataState error={selectedDetailResult && !selectedDetailResult.ok ? selectedDetailResult.error : new Error("Item detail unavailable")} retryHref={itemCatalogHref(selectedMember.item.id, query.q)} /></div>
        )}
      </div>
    </section>
  );
}
