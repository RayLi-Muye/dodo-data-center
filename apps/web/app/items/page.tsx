import { DataSection, MetaLine } from "@dodo/ui";
import Link from "next/link";

import { AssetImage } from "../../components/asset-image";
import { DataState, EmptyState } from "../../components/data-state";
import { PageHeading } from "../../components/page-heading";
import { QualityNotice } from "../../components/quality-notice";
import { api, settle } from "../../lib/api";
import { encyclopediaVersionLabel } from "../../lib/format";

export default async function ItemsPage({ searchParams }: { searchParams: Promise<{ cursor?: string; q?: string }> }) {
  const query = await searchParams;
  const result = await settle(api.items({ cursor: query.cursor, q: query.q }));
  const currentQuery = new URLSearchParams({
    ...(query.cursor ? { cursor: query.cursor } : {}),
    ...(query.q ? { q: query.q } : {}),
  }).toString();
  const currentHref = currentQuery ? `/items?${currentQuery}` : "/items";
  return (
    <div className="page-shell encyclopedia-page">
      <PageHeading eyebrow="ENCYCLOPEDIA / ITEMS" lead="查询官方数据中存在的物品定义、价格、属性与合成组件；定义存在不代表当前商店可购买。" title="物品百科" />
      <form className="catalog-search" method="get" role="search">
        <label htmlFor="item-search">搜索物品</label>
        <div>
          <input autoComplete="off" defaultValue={query.q ?? ""} id="item-search" inputMode="search" name="q" placeholder="输入物品中文名或内部名称…" spellCheck={false} type="search" />
          <button type="submit">筛选物品</button>
        </div>
      </form>
      {!result.ok ? <DataState error={result.error} retryHref={currentHref} /> : (
        <DataSection
          eyebrow="CURRENT SNAPSHOT"
          title={query.q ? `“${query.q}” 的物品结果` : "全部物品"}
          trailing={<span className="module-note">本页 {result.value.data.items.length} 个</span>}
        >
          <QualityNotice label="物品百科" quality={result.value.meta.quality} showComplete />
          {result.value.data.items.length === 0 ? (
            <EmptyState detail="尝试缩短关键词，或清空搜索查看当前快照中的全部物品。" title="没有匹配物品" />
          ) : (
            <div className="item-catalog">
              {result.value.data.items.map((item) => (
                <Link href={`/items/${encodeURIComponent(item.id)}`} key={item.id}>
                  <AssetImage alt={`${item.localizedName} 物品图标`} className="item-catalog__image" kind="item" name={item.name} />
                  <div><span>{item.category} · {itemKindLabel[item.kind]}</span><h2>{item.localizedName}</h2><p>{encyclopediaVersionLabel(item.officialVersion)} · {availabilityLabel[item.availabilityStatus]}</p></div>
                  <strong>{item.cost.toLocaleString("zh-CN")} <small>金</small></strong>
                </Link>
              ))}
            </div>
          )}
          <div className="catalog-footer">
            <MetaLine sources={result.value.meta.sources} updatedAt={result.value.meta.updatedAt} />
            {result.value.data.nextCursor ? (
              <Link className="button-secondary" href={`/items?${new URLSearchParams({ ...(query.q ? { q: query.q } : {}), cursor: result.value.data.nextCursor }).toString()}`}>查看下一页 →</Link>
            ) : null}
          </div>
        </DataSection>
      )}
    </div>
  );
}

const itemKindLabel = {
  item: "普通物品定义",
  neutral_enhancement: "中立附魔定义",
  neutral_item: "中立物品定义",
  recipe: "配方定义",
} as const;

const availabilityLabel = {
  unverified: "可购买性未核验",
  verified_current: "已核验当前可用",
} as const;
