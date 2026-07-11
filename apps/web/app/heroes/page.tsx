import { DataSection, MetaLine } from "@dodo/ui";
import Link from "next/link";

import { AssetImage } from "../../components/asset-image";
import { DataState, EmptyState } from "../../components/data-state";
import { PageHeading } from "../../components/page-heading";
import { api, settle } from "../../lib/api";

const attributeLabel = {
  agility: "敏捷",
  intelligence: "智力",
  strength: "力量",
  universal: "全才",
} as const;

export default async function HeroesPage({ searchParams }: { searchParams: Promise<{ cursor?: string; q?: string }> }) {
  const query = await searchParams;
  const result = await settle(api.heroes({ cursor: query.cursor, q: query.q }));
  const currentQuery = new URLSearchParams({
    ...(query.cursor ? { cursor: query.cursor } : {}),
    ...(query.q ? { q: query.q } : {}),
  }).toString();
  const currentHref = currentQuery ? `/heroes?${currentQuery}` : "/heroes";
  return (
    <div className="page-shell encyclopedia-page">
      <PageHeading eyebrow="ENCYCLOPEDIA / HEROES" lead="按当前数据快照查询英雄属性、定位、命石与技能。" title="英雄百科" />
      <form className="catalog-search" method="get" role="search">
        <label htmlFor="hero-search">搜索英雄</label>
        <div>
          <input autoComplete="off" defaultValue={query.q ?? ""} id="hero-search" inputMode="search" name="q" placeholder="输入英雄中文名或内部名称…" spellCheck={false} type="search" />
          <button type="submit">筛选英雄</button>
        </div>
      </form>
      {!result.ok ? (
        <DataState error={result.error} retryHref={currentHref} />
      ) : (
        <DataSection
          eyebrow="CURRENT SNAPSHOT"
          title={query.q ? `“${query.q}” 的英雄结果` : "全部英雄"}
          trailing={<span className="module-note">本页 {result.value.data.items.length} 个</span>}
        >
          {result.value.data.items.length === 0 ? (
            <EmptyState detail="尝试缩短关键词，或清空搜索查看当前快照中的全部英雄。" title="没有匹配英雄" />
          ) : (
            <div className="hero-catalog">
              {result.value.data.items.map((hero) => (
                <Link href={`/heroes/${encodeURIComponent(hero.id)}`} key={hero.id}>
                  <AssetImage alt={`${hero.localizedName} 英雄图标`} className="hero-catalog__image" kind="hero" name={hero.name} />
                  <div className="hero-catalog__body">
                    <span>{attributeLabel[hero.primaryAttribute]} · {hero.attackType === "melee" ? "近战" : "远程"}</span>
                    <h2>{hero.localizedName}</h2>
                    <p>{hero.roles.join(" / ") || "定位未标注"}</p>
                  </div>
                  <small>{hero.patch}</small>
                </Link>
              ))}
            </div>
          )}
          <div className="catalog-footer">
            <MetaLine sources={result.value.meta.sources} updatedAt={result.value.meta.updatedAt} />
            {result.value.data.nextCursor ? (
              <Link className="button-secondary" href={`/heroes?${new URLSearchParams({ ...(query.q ? { q: query.q } : {}), cursor: result.value.data.nextCursor }).toString()}`}>
                查看下一页 →
              </Link>
            ) : null}
          </div>
        </DataSection>
      )}
    </div>
  );
}
