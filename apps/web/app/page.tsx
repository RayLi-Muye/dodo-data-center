import { DataSection, MetaLine, StatusNotice } from "@dodo/ui";
import Link from "next/link";

import { AccountSearch } from "../components/account-search";
import { DataState } from "../components/data-state";
import { DataStatusPanel } from "../components/data-status-panel";
import { HeroDistribution } from "../components/hero-distribution";
import { MatchLedger } from "../components/match-ledger";
import { WinRateDonut } from "../components/win-rate-donut";
import { api, collectAllItems, settle } from "../lib/api";
import { formatCount } from "../lib/format";

const DEFAULT_ACCOUNT_ID = "123456789";

export default async function HomePage() {
  const [overviewResult, statusResult, itemsResult] = await Promise.all([
    settle(api.playerOverview(DEFAULT_ACCOUNT_ID)),
    settle(api.dataStatus()),
    settle(collectAllItems()),
  ]);

  const overview = overviewResult.ok ? overviewResult.value : null;
  const heroById = new Map(overview?.data.heroes.map((stats) => [stats.hero.id, stats.hero]) ?? []);
  const itemById = new Map(itemsResult.ok ? itemsResult.value.map((item) => [item.id, item]) : []);

  return (
    <div className="page-shell home-page">
      <section className="home-intro">
        <div className="home-intro__copy">
          <p className="page-heading__eyebrow">DOTA 2 / PUBLIC MATCH INTELLIGENCE</p>
          <h1>把公开比赛<br />整理成你的<span>竞技档案。</span></h1>
          <p>定位账号，查看最近已导入比赛、英雄倾向与关键表现；再进入当前版本英雄、物品和地图百科。</p>
        </div>
        <div className="home-intro__search">
          <span className="coordinate-label">QUERY / 01</span>
          <AccountSearch />
        </div>
      </section>

      <div className="home-dashboard">
        <DataSection
          className="home-dashboard__overview"
          eyebrow="ACCOUNT OVERVIEW"
          title="账号概览"
          trailing={overview ? <Link className="text-action" href={`/players/${DEFAULT_ACCOUNT_ID}`}>展开全部数据 →</Link> : null}
        >
          {overview ? (
            <div className="account-overview">
              {overview.data.profile.status === "public_partial" ? (
                <StatusNotice
                  detail="当前账号只包含部分公开数据。所有统计仍显示实际样本与覆盖率。"
                  title="公开数据不完整"
                  tone="warning"
                />
              ) : null}
              <div className="account-overview__identity">
                <div className="profile-monogram" aria-hidden="true">
                  {(overview.data.profile.personaName ?? overview.data.profile.accountId).slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p>默认演示账号 / {overview.data.profile.accountId}</p>
                  <h3>{overview.data.profile.personaName ?? "匿名公开玩家"}</h3>
                  <span>{formatCount(overview.data.profile.importedMatchCount)} 场已导入比赛</span>
                </div>
              </div>
              <WinRateDonut games={overview.data.games} winRate={overview.data.winRate} wins={overview.data.wins} />
              <dl className="account-overview__metrics">
                <div><dt>KDA</dt><dd>{overview.data.kdaRatio.toFixed(2)}</dd><small>{overview.data.averageKills.toFixed(1)} / {overview.data.averageDeaths.toFixed(1)} / {overview.data.averageAssists.toFixed(1)}</small></div>
                <div><dt>平均 GPM</dt><dd>{overview.data.averageGpm?.toFixed(0) ?? "—"}</dd><small>{overview.data.fieldCoverage.gpm.observedCount} 场有数据</small></div>
                <div><dt>英雄池</dt><dd>{overview.data.distinctHeroes}</dd><small>最近 {overview.data.games} 场合格比赛</small></div>
              </dl>
              <MetaLine
                coverageRate={overview.meta.coverageRate}
                sampleSize={overview.meta.sampleSize}
                sources={overview.meta.sources}
                updatedAt={overview.meta.updatedAt}
              />
            </div>
          ) : (
            <div className="section-state"><DataState error={overviewResult.ok ? null : overviewResult.error} retryHref="/" /></div>
          )}
        </DataSection>

        <DataSection className="home-dashboard__heroes" eyebrow="HERO POOL" title="英雄使用">
          {overview && overview.data.heroes.length > 0 ? (
            <>
              <HeroDistribution heroes={overview.data.heroes} />
              <Link className="module-footer-link" href={`/players/${DEFAULT_ACCOUNT_ID}`}>按时间窗口查看完整英雄池 →</Link>
            </>
          ) : (
            <div className="section-state">{overviewResult.ok ? "没有合格英雄样本" : <DataState error={overviewResult.error} retryHref="/" />}</div>
          )}
        </DataSection>

        <DataSection className="home-dashboard__matches" eyebrow="RECENT MATCHES" title="最近比赛">
          {overview && overview.data.recentMatches.length > 0 ? (
            <MatchLedger heroes={heroById} items={itemById} matches={overview.data.recentMatches.slice(0, 8)} />
          ) : (
            <div className="section-state">{overviewResult.ok ? "尚无已导入公开比赛" : <DataState error={overviewResult.error} retryHref="/" />}</div>
          )}
        </DataSection>

        <DataSection className="home-dashboard__status" eyebrow="PIPELINE" title="数据状态">
          {statusResult.ok ? (
            <DataStatusPanel data={statusResult.value.data} meta={statusResult.value.meta} />
          ) : (
            <div className="section-state"><DataState error={statusResult.error} retryHref="/" /></div>
          )}
        </DataSection>
      </div>
    </div>
  );
}
