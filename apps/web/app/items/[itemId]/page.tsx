import type { HeroSummary } from "@dodo/contracts";
import { DataSection, MetaLine } from "@dodo/ui";
import Link from "next/link";

import { AssetImage } from "../../../components/asset-image";
import { DataState } from "../../../components/data-state";
import { EntityRecentUpdates } from "../../../components/entity-recent-updates";
import { LevelValues } from "../../../components/item-detail-panel";
import { PageHeading } from "../../../components/page-heading";
import { QualityNotice } from "../../../components/quality-notice";
import { Badge } from "../../../components/ui/badge";
import { api, collectAllItemsWithMeta, settle } from "../../../lib/api";
import { encyclopediaVersionLabel, officialDescription } from "../../../lib/format";
import { buildItemCatalogEntries, findItemCatalogEntry, levelAttributeValues } from "../../../lib/item-catalog";

const itemKindLabel = {
  item: "普通物品定义",
  neutral_enhancement: "中立附魔定义",
  neutral_item: "中立物品定义",
  recipe: "配方定义",
} as const;

export default async function ItemDetailPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const [itemResult, updatesResult, catalogResult] = await Promise.all([
    settle(api.item(itemId)),
    settle(api.itemUpdates(itemId)),
    settle(collectAllItemsWithMeta()),
  ]);
  if (!itemResult.ok) {
    return (
      <div className="page-shell">
        <PageHeading eyebrow={`ITEM / ${itemId}`} lead="官方物品定义中的价格、属性、效果与合成组件。" title="物品详情" />
        <DataState error={itemResult.error} retryHref={`/items/${encodeURIComponent(itemId)}`} />
      </div>
    );
  }
  const item = itemResult.value;
  const catalogEntries = catalogResult.ok ? buildItemCatalogEntries(catalogResult.value.items) : [];
  const familyEntry = findItemCatalogEntry(catalogEntries, item.data.id);
  const familyDetailResults = familyEntry && familyEntry.members.length > 1
    ? await Promise.all(familyEntry.members.map((member) => member.item.id === item.data.id ? itemResult : settle(api.item(member.item.id))))
    : [];
  const familyDetails = familyDetailResults.flatMap((candidate) => candidate.ok ? [candidate.value.data] : []);
  const selectedLevel = familyEntry?.members.find((member) => member.item.id === item.data.id)?.level ?? 1;
  const isUpgradeFamily = Boolean(familyEntry && familyEntry.members.length > 1);
  const hasCompleteFamilyDetails = Boolean(familyEntry && familyDetails.length === familyEntry.members.length);
  const versionLabel = encyclopediaVersionLabel(item.data.officialVersion);
  const componentResults = await Promise.all(item.data.components.map((id) => settle(api.item(id))));
  const components = componentResults.flatMap((component) => component.ok ? [component.value.data] : []);
  const heroById = new Map<string, HeroSummary>();
  const itemById = new Map([[item.data.id, item.data]]);
  const categoryLabel = itemCategoryLabel(item.data.category, item.data.kind);

  return (
    <div className="page-shell item-detail-page">
      <Link className="back-link" href="/items">← 返回物品百科</Link>
      <section className="item-profile">
        <AssetImage alt={`${item.data.localizedName} 物品图标`} className="item-profile__image" kind="item" name={item.data.name} priority />
        <div className="item-profile__main">
          <p className="page-heading__eyebrow">ITEM / {item.data.id} / {versionLabel}</p>
          <h1>{item.data.localizedName}</h1>
          <p>{officialDescription(item.data.description)}</p>
          <div className="item-profile__tags"><Badge variant="secondary">{categoryLabel}</Badge><Badge variant="outline">{itemKindLabel[item.data.kind]}</Badge><Badge variant="outline">{versionLabel}</Badge>{isUpgradeFamily ? <Badge variant="outline">等级 {selectedLevel}</Badge> : null}</div>
          {isUpgradeFamily && familyEntry ? (
            <nav aria-label={`${item.data.localizedName} 等级`} className="item-level-switcher item-level-switcher--detail">
              {familyEntry.members.map((member) => (
                <Link aria-current={member.item.id === item.data.id ? "page" : undefined} href={`/items/${encodeURIComponent(member.item.id)}`} key={member.item.id}>
                  <span>等级</span><strong>{member.level}</strong>
                </Link>
              ))}
            </nav>
          ) : null}
        </div>
        <div className="item-profile__cost"><span>COST</span><strong>{item.data.cost.toLocaleString("zh-CN")}</strong><small>金币</small></div>
      </section>

      <QualityNotice label="物品详情" quality={item.meta.quality} showComplete />
      {item.data.availabilityStatus === "unverified" ? (
        <p className="data-disclaimer">官方定义存在不等于当前商店可购买；该物品的当前可购买性尚未核验。</p>
      ) : null}
      {!catalogResult.ok ? (
        <p className="data-disclaimer">物品目录暂不可用；当前详情仍保留，但可升级物品的等级导航可能暂时缺失。</p>
      ) : isUpgradeFamily && !hasCompleteFamilyDetails ? (
        <p className="data-disclaimer">升级族已识别，但部分等级详情暂不可用；等级导航仍保留，当前仅展示所选等级的原始属性。</p>
      ) : null}

      <div className="detail-grid item-detail-workbench">
        <DataSection className="detail-grid__main item-detail-workbench__effects" eyebrow="ATTRIBUTES" title="属性与效果">
          {item.data.attributes.length > 0 ? (
            <dl className="attribute-list">
              {item.data.attributes.map((attribute, index) => {
                const values = hasCompleteFamilyDetails ? levelAttributeValues(familyDetails, index) : null;
                return <div key={`${attribute.label}-${index}`}><dt>{attribute.label}</dt><dd>{values ? <LevelValues currentLevel={selectedLevel} values={values} /> : attribute.value}</dd></div>;
              })}
            </dl>
          ) : <p className="detail-empty">当前快照没有结构化属性。</p>}
        </DataSection>
        <DataSection className="detail-grid__side item-detail-workbench__recipe" eyebrow="RECIPE" title="合成组件">
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

      <EntityRecentUpdates
        entityLabel={item.data.localizedName}
        heroById={heroById}
        itemById={itemById}
        result={updatesResult}
        retryHref={`/items/${encodeURIComponent(itemId)}`}
      />

      <MetaLine sources={item.meta.sources} updatedAt={item.meta.updatedAt} />
      <p className="source-snapshot">来源快照：{item.data.sourceSnapshot}</p>
    </div>
  );
}

function itemCategoryLabel(category: string, kind: keyof typeof itemKindLabel): string {
  if (kind === "neutral_enhancement") return "中立附魔";
  if (kind === "neutral_item") {
    const tier = /^neutral_tier_(\d+)$/.exec(category)?.[1];
    return tier ? `中立物品 · ${tier} 级` : "中立物品";
  }
  return ({
    official_quality_0: "消耗用品",
    official_quality_1: "基础组件",
    official_quality_2: "常规装备",
    official_quality_3: "进阶装备",
    official_quality_4: "高阶装备",
    official_quality_5: "特殊装备",
    official_quality_6: "神秘商店组件",
  } as Record<string, string>)[category] ?? "其他当前物品";
}
