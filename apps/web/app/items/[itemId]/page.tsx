import { DataSection, MetaLine } from "@dodo/ui";
import Link from "next/link";

import { AssetImage } from "../../../components/asset-image";
import { DataState } from "../../../components/data-state";
import { PageHeading } from "../../../components/page-heading";
import { api, settle } from "../../../lib/api";

export default async function ItemDetailPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const result = await settle(api.item(itemId));
  if (!result.ok) {
    return (
      <div className="page-shell">
        <PageHeading eyebrow={`ITEM / ${itemId}`} lead="当前版本物品价格、属性、效果与合成组件。" title="物品详情" />
        <DataState error={result.error} retryHref={`/items/${encodeURIComponent(itemId)}`} />
      </div>
    );
  }
  const item = result.value;
  const componentResults = await Promise.all(item.data.components.map((id) => settle(api.item(id))));
  const components = componentResults.flatMap((component) => component.ok ? [component.value.data] : []);

  return (
    <div className="page-shell item-detail-page">
      <Link className="back-link" href="/items">← 返回物品百科</Link>
      <section className="item-profile">
        <AssetImage alt={`${item.data.localizedName} 物品图标`} className="item-profile__image" kind="item" name={item.data.name} priority />
        <div>
          <p className="page-heading__eyebrow">ITEM / {item.data.id} / {item.data.category}</p>
          <h1>{item.data.localizedName}</h1>
          <p>{item.data.description || "当前快照没有物品说明。"}</p>
          <div className="tag-row"><span>{item.data.category}</span><span>{item.data.patch}</span></div>
        </div>
        <div className="item-profile__cost"><span>COST</span><strong>{item.data.cost.toLocaleString("zh-CN")}</strong><small>金币</small></div>
      </section>

      <div className="detail-grid">
        <DataSection className="detail-grid__main" eyebrow="ATTRIBUTES" title="属性与效果">
          {item.data.attributes.length > 0 ? (
            <dl className="attribute-list">
              {item.data.attributes.map((attribute, index) => <div key={`${attribute.label}-${index}`}><dt>{attribute.label}</dt><dd>{attribute.value}</dd></div>)}
            </dl>
          ) : <p className="detail-empty">当前快照没有结构化属性。</p>}
        </DataSection>
        <DataSection className="detail-grid__side" eyebrow="RECIPE" title="合成组件">
          {item.data.components.length === 0 ? <p className="detail-empty">该物品没有合成组件。</p> : (
            <div className="component-list">
              {item.data.components.map((componentId) => {
                const component = components.find((candidate) => candidate.id === componentId);
                return component ? (
                  <Link href={`/items/${encodeURIComponent(component.id)}`} key={component.id}>
                    <AssetImage alt={component.localizedName} className="item-thumb item-thumb--large" kind="item" name={component.name} />
                    <span>{component.localizedName}<small>{component.cost.toLocaleString("zh-CN")} 金</small></span>
                  </Link>
                ) : <span className="component-list__missing" key={componentId}>组件 #{componentId} 暂不可读</span>;
              })}
            </div>
          )}
        </DataSection>
      </div>

      <MetaLine sources={item.meta.sources} updatedAt={item.meta.updatedAt} />
      <p className="source-snapshot">来源快照：{item.data.sourceSnapshot}</p>
    </div>
  );
}
