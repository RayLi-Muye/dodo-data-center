import type { ItemSummary } from "@dodo/contracts";
import { DataSection, MetaLine } from "@dodo/ui";
import Link from "next/link";

import { AssetImage } from "../../../components/asset-image";
import { DataState, EmptyState } from "../../../components/data-state";
import { EntityRecentUpdates } from "../../../components/entity-recent-updates";
import { PageHeading } from "../../../components/page-heading";
import { QualityNotice } from "../../../components/quality-notice";
import { api, settle } from "../../../lib/api";
import {
  encyclopediaVersionLabel,
  formatStatGain,
  formatStatValue,
  heroRoleLabel,
  officialDescription,
} from "../../../lib/format";

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
  const [heroResult, updatesResult] = await Promise.all([
    settle(api.hero(heroId)),
    settle(api.heroUpdates(heroId)),
  ]);
  if (!heroResult.ok) {
    return (
      <div className="page-shell">
        <PageHeading eyebrow={`HERO / ${heroId}`} lead="当前数据快照中的英雄属性、定位与技能资料。" title="英雄详情" />
        <DataState error={heroResult.error} retryHref={`/heroes/${encodeURIComponent(heroId)}`} />
      </div>
    );
  }
  const hero = heroResult.value;
  const heroById = new Map([[hero.data.id, hero.data]]);
  const itemById = new Map<string, ItemSummary>();
  const versionLabel = encyclopediaVersionLabel(hero.data.officialVersion);
  const hype = hero.data.hype.trim() || "当前官方快照玩法简介不可用";
  const biography = hero.data.biography.trim() || "当前官方快照背景说明不可用";
  const complexity = hero.data.complexity;
  const stats = hero.data.baseStats;
  const primaryStats = stats ? [
    { key: "strength", label: "力量", value: stats.strength },
    { key: "agility", label: "敏捷", value: stats.agility },
    { key: "intelligence", label: "智力", value: stats.intelligence },
  ] : [];
  const statGroups = stats ? [
    {
      key: "resources",
      label: "生命 / 魔法",
      entries: [
        { label: "生命", value: formatStatValue(stats.maxHealth), note: `${formatStatGain(stats.healthRegen)} / 秒` },
        { label: "魔法", value: formatStatValue(stats.maxMana), note: `${formatStatGain(stats.manaRegen)} / 秒` },
      ],
    },
    {
      key: "combat",
      label: "攻防",
      entries: [
        { label: "攻击力", value: `${formatStatValue(stats.damageMin)}–${formatStatValue(stats.damageMax)}`, note: null },
        { label: "护甲", value: formatStatValue(stats.armor), note: null },
        { label: "魔法抗性", value: `${formatStatValue(stats.magicResistance)}%`, note: null },
      ],
    },
    {
      key: "mechanics",
      label: "机动 / 攻击 / 视野",
      entries: [
        { label: "移动速度", value: formatStatValue(stats.movementSpeed), note: null },
        { label: "攻击距离", value: formatStatValue(stats.attackRange), note: null },
        { label: "攻击间隔", value: `${formatStatValue(stats.attackRate)} 秒`, note: null },
        { label: "弹道速度", value: formatStatValue(stats.projectileSpeed), note: null },
        { label: "转身速率", value: formatStatValue(stats.turnRate), note: null },
        { label: "视野（昼 / 夜）", value: `${formatStatValue(stats.sightRangeDay)} / ${formatStatValue(stats.sightRangeNight)}`, note: null },
      ],
    },
  ] : [];
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
            {hero.data.roles.map((role) => <span key={role}>{heroRoleLabel(role)}</span>)}
          </div>
        </div>
        <div className="hero-profile__index">
          <span>PATCH</span>
          <strong>{versionLabel}</strong>
          <small>当前来源快照</small>
        </div>
      </section>

      <QualityNotice label="英雄详情" quality={hero.meta.quality} showComplete />

      <div className="hero-reference-grid">
        <DataSection className="hero-lore" eyebrow="PLAYSTYLE / LORE" title="玩法与背景">
          <article>
            <small>玩法简介</small>
            <p>{hype}</p>
          </article>
          <article>
            <small>英雄背景</small>
            <p>{biography}</p>
          </article>
        </DataSection>

        <DataSection
          className="hero-facts"
          eyebrow="BASE PROFILE"
          title="基础数据"
          trailing={(
            <div className="hero-complexity">
              <span>复杂度</span>
              {complexity === null ? (
                <small>当前官方快照复杂度不可用</small>
              ) : (
                <>
                  <span aria-hidden="true" className="hero-complexity__scale">
                    {[1, 2, 3].map((level) => <i className={level <= complexity ? "is-active" : undefined} key={level} />)}
                  </span>
                  <strong>{complexity} / 3</strong>
                </>
              )}
            </div>
          )}
        >
          {!stats ? (
            <p className="detail-empty">当前官方快照基础属性不可用</p>
          ) : (
            <>
              <dl className="hero-primary-stats">
                {primaryStats.map((stat) => (
                  <div key={stat.key}>
                    <dt>{stat.label}</dt>
                    <dd>
                      <strong>{formatStatValue(stat.value.base)}</strong>
                      <small>{formatStatGain(stat.value.gain)} / 级</small>
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="hero-stat-groups">
                {statGroups.map((group) => (
                  <section className="hero-stat-group" key={group.key}>
                    <h3>{group.label}</h3>
                    <dl className="hero-stat-list">
                      {group.entries.map((entry) => (
                        <div key={entry.label}>
                          <dt>{entry.label}</dt>
                          <dd>
                            <strong>{entry.value}</strong>
                            {entry.note ? <small>{entry.note}</small> : null}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))}
              </div>
            </>
          )}
        </DataSection>
      </div>

      <EntityRecentUpdates
        entityLabel={hero.data.localizedName}
        heroById={heroById}
        itemById={itemById}
        result={updatesResult}
        retryHref={`/heroes/${encodeURIComponent(heroId)}`}
      />

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
                  <div className="ability-list__body">
                    <small>{abilityTypeLabel[ability.type]}</small>
                    <h3>{ability.localizedName}</h3>
                    <p>{officialDescription(ability.description)}</p>
                    {ability.attributes.length > 0 ? (
                      <dl className="ability-attribute-list">
                        {ability.attributes.map((attribute, index) => (
                          <div key={`${attribute.label}-${index}`}>
                            <dt>{attribute.label}</dt>
                            <dd>{attribute.value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
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
                <li key={facet.name}><strong>{facet.name}</strong><p>{officialDescription(facet.description)}</p></li>
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
