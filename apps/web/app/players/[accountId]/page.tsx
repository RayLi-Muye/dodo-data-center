import { metricWindowSchema } from "@dodo/contracts";
import { DataSection, MetaLine, StatusNotice } from "@dodo/ui";

import { AccountSearch } from "../../../components/account-search";
import { DataState, EmptyState } from "../../../components/data-state";
import { HeroDistribution } from "../../../components/hero-distribution";
import { MatchLedger } from "../../../components/match-ledger";
import { PageHeading } from "../../../components/page-heading";
import { QualityNotice } from "../../../components/quality-notice";
import { WinRateDonut } from "../../../components/win-rate-donut";
import { api, collectAllItems, collectAllPlayerHeroes, settle } from "../../../lib/api";
import { formatCount, formatPercent, windowLabel } from "../../../lib/format";

const windows = ["last_20", "last_50", "last_100", "all_imported"] as const;

export default async function PlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ window?: string }>;
}) {
  const [{ accountId }, query] = await Promise.all([params, searchParams]);
  const parsedWindow = metricWindowSchema.safeParse(query.window);
  const window = parsedWindow.success ? parsedWindow.data : "last_100";

  const [overviewResult, heroesResult, matchesResult, itemsResult] = await Promise.all([
    settle(api.playerOverview(accountId)),
    settle(collectAllPlayerHeroes(accountId, window)),
    settle(api.playerMatches(accountId)),
    settle(collectAllItems()),
  ]);

  if (!overviewResult.ok) {
    return (
      <div className="page-shell">
        <PageHeading
          actions={<AccountSearch compact />}
          eyebrow={`PLAYER / ${accountId}`}
          lead="这里只展示上游允许公开且已导入的比赛；私密、限流与解析中状态不会退化为空数据。"
          title="玩家数据"
        />
        <DataState error={overviewResult.error} retryHref={`/players/${encodeURIComponent(accountId)}`} />
      </div>
    );
  }

  const overview = overviewResult.value;
  const heroes = heroesResult.ok ? heroesResult.value.items : [];
  const matches = matchesResult.ok ? matchesResult.value.data.items : [];
  const visibleMatchCount = window === "last_20" ? 20 : window === "last_50" ? 50 : 100;
  const visibleMatches = matches.slice(0, visibleMatchCount);
  const heroById = new Map([
    ...overview.data.heroes.map((stats) => [stats.hero.id, stats.hero] as const),
    ...heroes.map((stats) => [stats.hero.id, stats.hero] as const),
  ]);
  const itemById = new Map(itemsResult.ok ? itemsResult.value.map((item) => [item.id, item]) : []);
  const windowGames = heroes.reduce((sum, stats) => sum + stats.games, 0);
  const windowWins = heroes.reduce((sum, stats) => sum + stats.wins, 0);
  const windowWinRate = windowGames > 0 ? windowWins / windowGames : null;
  const metricMeta = heroesResult.ok ? heroesResult.value.meta : undefined;

  return (
    <div className="page-shell player-page">
      <PageHeading
        actions={<AccountSearch compact />}
        eyebrow={`PLAYER / ${overview.data.profile.accountId}`}
        lead="切换窗口比较英雄使用与胜负结构；全部已导入不等于完整生涯。"
        title={overview.data.profile.personaName ?? "匿名公开玩家"}
      />

      {overview.data.profile.status === "public_partial" ? (
        <StatusNotice
          detail="当前账号仅有部分公开比赛成功导入。各模块继续分别标记自己的完整度与更新时间。"
          title="账号公开数据不完整"
          tone="warning"
        />
      ) : null}

      <QualityNotice label="账号概览" quality={overview.meta.quality} />

      <nav className="window-switcher" aria-label="统计时间窗口">
        {windows.map((item) => (
          <a aria-current={window === item ? "page" : undefined} href={`?window=${item}`} key={item}>
            {windowLabel(item)}
          </a>
        ))}
      </nav>

      <section className="player-summary">
        <div className="player-summary__identity">
          <div className="profile-monogram" aria-hidden="true">
            {(overview.data.profile.personaName ?? overview.data.profile.accountId).slice(0, 2).toUpperCase()}
          </div>
          <div>
            <span>DOTA ACCOUNT</span>
            <strong>{overview.data.profile.accountId}</strong>
            <small>{formatCount(overview.data.profile.importedMatchCount)} 场已导入</small>
          </div>
        </div>
        <WinRateDonut games={windowGames} winRate={windowWinRate} wins={windowWins} />
        <dl className="player-summary__metrics">
          <div><dt>窗口样本</dt><dd>{formatCount(windowGames)}</dd><small>{windowLabel(window)}</small></div>
          <div><dt>胜 / 负</dt><dd>{windowWins} <i>/</i> {Math.max(0, windowGames - windowWins)}</dd><small>方向与颜色双重标记</small></div>
          <div><dt>使用英雄</dt><dd>{heroes.length}</dd><small>按使用场次稳定排序</small></div>
          <div><dt>最近 100 场 KDA</dt><dd>{overview.data.kdaRatio.toFixed(2)}</dd><small>{overview.data.averageKills.toFixed(1)} / {overview.data.averageDeaths.toFixed(1)} / {overview.data.averageAssists.toFixed(1)}</small></div>
        </dl>
      </section>

      {metricMeta ? (
        <MetaLine
          coverageRate={metricMeta.coverageRate}
          sampleSize={metricMeta.sampleSize}
          sources={metricMeta.sources}
          updatedAt={metricMeta.updatedAt}
        />
      ) : null}

      <div className="player-content-grid">
        <DataSection className="player-content-grid__heroes" eyebrow="HERO DISTRIBUTION" title="英雄使用分布">
          {!heroesResult.ok ? (
            <div className="section-state"><DataState error={heroesResult.error} retryHref={`/players/${encodeURIComponent(accountId)}?window=${window}`} /></div>
          ) : heroes.length === 0 ? (
            <>
              {metricMeta ? <QualityNotice label="英雄使用" quality={metricMeta.quality} /> : null}
              <EmptyState detail="当前窗口没有合格英雄样本。尝试切换到更长时间窗口。" title="英雄样本为空" />
            </>
          ) : (
            <>
              {metricMeta ? <QualityNotice label="英雄使用" quality={metricMeta.quality} /> : null}
              <HeroDistribution heroes={heroes} limit={100} />
            </>
          )}
        </DataSection>

        <DataSection
          className="player-content-grid__matches"
          eyebrow="MATCH LEDGER"
          title="比赛明细"
          trailing={<span className="module-note">接口仅提供最近 100 场明细</span>}
        >
          {!matchesResult.ok ? (
            <div className="section-state"><DataState error={matchesResult.error} retryHref={`/players/${encodeURIComponent(accountId)}?window=${window}`} /></div>
          ) : visibleMatches.length === 0 ? (
            <>
              <QualityNotice label="比赛明细" quality={matchesResult.value.meta.quality} />
              <EmptyState detail="账号已定位，但当前还没有合格的已导入公开比赛。" title="没有比赛明细" />
            </>
          ) : (
            <>
              <QualityNotice label="比赛明细" quality={matchesResult.value.meta.quality} />
              <MatchLedger heroes={heroById} items={itemById} matches={visibleMatches} />
            </>
          )}
        </DataSection>
      </div>

      <p className="data-disclaimer">
        胜率 {formatPercent(windowWinRate)}，只描述 {windowGames} 场合格已导入比赛；不外推私密记录或完整职业生涯。
      </p>
    </div>
  );
}
