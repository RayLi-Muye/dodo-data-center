import { DataSection, MetaLine } from "@dodo/ui";
import Link from "next/link";

import { AssetImage } from "../../../components/asset-image";
import { DataState, EmptyState } from "../../../components/data-state";
import { PageHeading } from "../../../components/page-heading";
import { QualityNotice } from "../../../components/quality-notice";
import { api, settle } from "../../../lib/api";
import { encyclopediaVersionLabel } from "../../../lib/format";

const attributeLabel = {
  agility: "敏捷",
  intelligence: "智力",
  strength: "力量",
  universal: "全才",
} as const;

const abilityTypeLabel = {
  basic: "基础技能",
  innate: "先天技能",
  talent: "天赋",
  ultimate: "终极技能",
} as const;

export default async function HeroDetailPage({ params }: { params: Promise<{ heroId: string }> }) {
  const { heroId } = await params;
  const result = await settle(api.hero(heroId));
  if (!result.ok) {
    return (
      <div className="page-shell">
        <PageHeading eyebrow={`HERO / ${heroId}`} lead="当前数据快照中的英雄属性、定位与技能资料。" title="英雄详情" />
        <DataState error={result.error} retryHref={`/heroes/${encodeURIComponent(heroId)}`} />
      </div>
    );
  }
  const hero = result.value;
  const versionLabel = encyclopediaVersionLabel(hero.data.officialVersion);
  return (
    <div className="page-shell hero-detail-page">
      <Link className="back-link" href="/heroes">← 返回英雄百科</Link>
      <section className="hero-profile">
        <AssetImage alt={`${hero.data.localizedName} 英雄图像`} className="hero-profile__image" kind="hero" name={hero.data.name} priority />
        <div className="hero-profile__main">
          <p className="page-heading__eyebrow">HERO / {hero.data.id} / {versionLabel}</p>
          <h1>{hero.data.localizedName}</h1>
          <p>{hero.data.name}</p>
          <div className="tag-row">
            <span>{attributeLabel[hero.data.primaryAttribute]}</span>
            <span>{hero.data.attackType === "melee" ? "近战" : "远程"}</span>
            {hero.data.roles.map((role) => <span key={role}>{role}</span>)}
          </div>
        </div>
        <div className="hero-profile__index">
          <span>PATCH</span>
          <strong>{versionLabel}</strong>
          <small>当前来源快照</small>
        </div>
      </section>

      <QualityNotice label="英雄详情" quality={hero.meta.quality} showComplete />

      <div className="detail-grid">
        <DataSection className="detail-grid__main" eyebrow="ABILITY KIT" title="技能组">
          {hero.data.abilities.length === 0 ? (
            <EmptyState detail="当前来源快照还没有结构化技能资料；这不代表英雄没有技能。" title="技能资料待补充" />
          ) : (
            <ol className="ability-list">
              {hero.data.abilities.map((ability) => (
                <li key={ability.id}>
                  <span className="ability-list__slot">{String(ability.slot + 1).padStart(2, "0")}</span>
                  <AssetImage alt={`${ability.localizedName} 技能图标`} className="ability-list__icon" kind="ability" name={ability.name} />
                  <div>
                    <small>{abilityTypeLabel[ability.type]}</small>
                    <h3>{ability.localizedName}</h3>
                    <p>{ability.description || "当前快照没有技能说明。"}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </DataSection>

        <DataSection className="detail-grid__side" eyebrow="FACETS" title="命石 / 分支">
          {hero.data.facetsStatus === "active" && hero.data.facets.length > 0 ? (
            <ul className="facet-list">
              {hero.data.facets.map((facet) => (
                <li key={facet.name}><strong>{facet.name}</strong><p>{facet.description || "当前快照没有命石说明。"}</p></li>
              ))}
            </ul>
          ) : hero.data.facetsStatus === "removed" ? (
            <p className="detail-empty">当前版本已移除命石机制，不展示历史命石数据。</p>
          ) : hero.data.facetsStatus === "unavailable" ? (
            <p className="detail-empty">当前来源不足以确认命石状态。</p>
          ) : (
            <p className="detail-empty">当前版本标记命石可用，但没有可展示的命石条目。</p>
          )}
        </DataSection>
      </div>

      <MetaLine sources={hero.meta.sources} updatedAt={hero.meta.updatedAt} />
      <p className="source-snapshot">来源快照：{hero.data.sourceSnapshot}</p>
    </div>
  );
}
