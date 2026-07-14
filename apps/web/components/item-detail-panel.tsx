import type { ItemDetail } from "@dodo/contracts";
import { MetaLine } from "@dodo/ui";
import Link from "next/link";

import type { ItemCatalogEntry } from "../lib/item-catalog";
import { itemCatalogHref, levelAttributeValues } from "../lib/item-catalog";
import { officialDescription } from "../lib/format";
import { AssetImage } from "./asset-image";
import { QualityNotice } from "./quality-notice";

export function ItemDetailPanel({
  components,
  detail,
  entry,
  familyDetails,
  meta,
  q,
}: {
  components: ItemDetail[];
  detail: ItemDetail;
  entry: ItemCatalogEntry;
  familyDetails: ItemDetail[];
  meta: { quality: "complete" | "partial" | "stale"; sources: string[]; updatedAt: string };
  q: string | undefined;
}) {
  const selectedLevel = entry.members.find((member) => member.item.id === detail.id)?.level ?? 1;
  const isUpgradeFamily = entry.members.length > 1;
  const hasCompleteFamilyDetails = familyDetails.length === entry.members.length;
  return (
    <aside aria-label={`${detail.localizedName} 物品详情`} className="item-inspector">
      <header className="item-inspector__profile">
        <AssetImage alt={`${detail.localizedName} 物品图标`} className="item-inspector__image" kind="item" name={detail.name} priority />
        <div>
          <span>{isUpgradeFamily ? `可升级物品 · 等级 ${selectedLevel}` : itemCategoryLabel(detail)}</span>
          <h2>{detail.localizedName}</h2>
          <strong><span aria-hidden="true">●</span> {detail.cost.toLocaleString("zh-CN")} <small>金币</small></strong>
        </div>
      </header>

      {isUpgradeFamily ? (
        <nav aria-label={`${detail.localizedName} 等级`} className="item-level-switcher">
          {entry.members.map((member) => (
            <Link
              aria-current={member.item.id === detail.id ? "page" : undefined}
              href={itemCatalogHref(member.item.id, q)}
              key={member.item.id}
            >
              <span>等级</span><strong>{member.level}</strong>
            </Link>
          ))}
        </nav>
      ) : null}

      <section className="item-inspector__section">
        <h3>属性与效果</h3>
        {detail.attributes.length > 0 ? (
          <dl className="item-effect-list">
            {detail.attributes.map((attribute, index) => {
              const values = hasCompleteFamilyDetails ? levelAttributeValues(familyDetails, index) : null;
              return (
                <div key={`${attribute.label}-${index}`}>
                  <dt>{attribute.label}</dt>
                  <dd>{values ? <LevelValues currentLevel={selectedLevel} values={values} /> : attribute.value}</dd>
                </div>
              );
            })}
          </dl>
        ) : <p className="item-inspector__empty">当前快照没有结构化属性。</p>}
        <p className="item-inspector__description">{officialDescription(detail.description)}</p>
      </section>

      {isUpgradeFamily && !hasCompleteFamilyDetails ? (
        <p className="item-inspector__disclaimer">升级族已识别，但部分等级详情暂不可用；等级导航仍保留，当前仅展示所选等级的原始属性。</p>
      ) : null}

      <section className="item-inspector__section">
        <h3>合成组件</h3>
        {detail.components.length === 0 ? <p className="item-inspector__empty">该物品没有合成组件。</p> : (
          <div className="item-inspector__components">
            {detail.components.map((componentId) => {
              const component = components.find((candidate) => candidate.id === componentId);
              return component ? (
                <Link href={`/items/${encodeURIComponent(component.id)}`} key={component.id} title={component.localizedName}>
                  <AssetImage alt={component.localizedName} kind="item" name={component.name} />
                  <span>{component.localizedName}<small>{component.cost.toLocaleString("zh-CN")} 金</small></span>
                </Link>
              ) : <span className="item-inspector__missing" key={componentId}>#{componentId}</span>;
            })}
          </div>
        )}
      </section>

      {detail.availabilityStatus === "unverified" ? (
        <p className="item-inspector__disclaimer">官方定义存在不等于当前商店可购买；当前可购买性尚未核验。</p>
      ) : null}
      <QualityNotice label="物品详情" quality={meta.quality} showComplete />
      <MetaLine sources={meta.sources} updatedAt={meta.updatedAt} />
      <Link className="item-inspector__full-link" href={`/items/${encodeURIComponent(detail.id)}`}>打开独立详情与更新记录 →</Link>
    </aside>
  );
}

export function LevelValues({ currentLevel, values }: { currentLevel: number; values: string[] }) {
  return (
    <span aria-label={values.map((value, index) => `等级 ${index + 1}：${value}`).join("；")} className="level-values">
      {values.map((value, index) => (
        <span className={index + 1 === currentLevel ? "is-current" : undefined} key={`${value}-${index}`}>
          {index > 0 ? <i aria-hidden="true">/</i> : null}<b>{value}</b>
        </span>
      ))}
    </span>
  );
}

function itemCategoryLabel(item: ItemDetail): string {
  if (item.kind === "neutral_enhancement") return "中立附魔";
  if (item.kind === "neutral_item") return "中立物品";
  return "固定物品";
}
