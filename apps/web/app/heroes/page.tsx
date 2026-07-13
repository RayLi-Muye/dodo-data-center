import { MetaLine } from "@dodo/ui";

import { HeroCatalogBrowser } from "../../components/hero-catalog-browser";
import { DataState, EmptyState } from "../../components/data-state";
import { PageHeading } from "../../components/page-heading";
import { QualityNotice } from "../../components/quality-notice";
import { collectAllHeroesWithMeta, settle } from "../../lib/api";

export default async function HeroesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = await searchParams;
  const result = await settle(collectAllHeroesWithMeta(query.q));
  const currentQuery = new URLSearchParams({ ...(query.q ? { q: query.q } : {}) }).toString();
  const currentHref = currentQuery ? `/heroes?${currentQuery}` : "/heroes";
  return (
    <div className="page-shell encyclopedia-page">
      <PageHeading eyebrow="ENCYCLOPEDIA / HEROES" lead="按当前数据快照查询英雄属性、定位与技能。" title="英雄百科" />
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
        <section className="catalog-workbench">
          <header className="catalog-workbench__header">
            <div><span>CURRENT HERO ROSTER</span><h2>{query.q ? `“${query.q}” 的英雄结果` : "当前英雄名册"}</h2></div>
            <MetaLine sources={result.value.meta.sources} updatedAt={result.value.meta.updatedAt} />
          </header>
          <QualityNotice label="英雄百科" quality={result.value.meta.quality} showComplete />
          {result.value.items.length === 0 ? (
            <EmptyState detail="尝试缩短关键词，或清空搜索查看当前快照中的全部英雄。" title="没有匹配英雄" />
          ) : (
            <HeroCatalogBrowser heroes={result.value.items} />
          )}
        </section>
      )}
    </div>
  );
}
