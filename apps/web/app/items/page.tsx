import { DataState } from "../../components/data-state";
import { ItemCatalogWorkbench, type ItemWorkbenchQuery } from "../../components/item-catalog-workbench";
import { PageHeading } from "../../components/page-heading";
import { collectAllItemDetailsWithMeta, settle } from "../../lib/api";

export default async function ItemsPage({ searchParams }: { searchParams: Promise<ItemWorkbenchQuery> }) {
  const query = await searchParams;
  const result = await settle(collectAllItemDetailsWithMeta());
  const currentQuery = new URLSearchParams({
    ...(query.q ? { q: query.q } : {}),
    ...(query.selected ? { selected: query.selected } : {}),
  }).toString();
  const currentHref = currentQuery ? `/items?${currentQuery}` : "/items";

  return (
    <div className="page-shell encyclopedia-page encyclopedia-page--items">
      <PageHeading eyebrow="ENCYCLOPEDIA / ITEMS" lead="浏览当前版本物品目录、价格与效果；已移除物品和配方图纸不进入目录。" title="物品百科" />
      {!result.ok ? (
        <DataState error={result.error} retryHref={currentHref} />
      ) : (
        <ItemCatalogWorkbench details={result.value.items} initialQuery={query} meta={result.value.meta} />
      )}
    </div>
  );
}
