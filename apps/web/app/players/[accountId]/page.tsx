import { identifierSchema, metricWindowSchema } from "@dodo/contracts";
import { DataSection, MetaLine, StatusNotice } from "@dodo/ui";

import { AccountSearch } from "../../../components/account-search";
import { DataState, EmptyState } from "../../../components/data-state";
import { EnrichmentControl } from "../../../components/enrichment-control";
import { HeroDistribution } from "../../../components/hero-distribution";
import { MatchExplorer, type MatchFilters } from "../../../components/match-explorer";
import { PageHeading } from "../../../components/page-heading";
import { PlayerHistorySyncControl } from "../../../components/player-history-sync-control";
import { PlayerSyncControl } from "../../../components/player-sync-control";
import { QualityNotice } from "../../../components/quality-notice";
import { WinRateDonut } from "../../../components/win-rate-donut";
import { api, collectAllItems, collectAllPatches, collectAllPlayerHeroes, DodoApiError, settle } from "../../../lib/api";
import { formatCount, formatPercent, windowLabel } from "../../../lib/format";

const windows = ["last_20", "last_50", "last_100", "all_imported"] as const;

export default async function PlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{
    dateFrom?: string;
    dateTo?: string;
    gameMode?: string;
    heroId?: string;
    lobbyType?: string;
    matchPatch?: string;
    outcome?: string;
    patch?: string;
    window?: string;
  }>;
}) {
  const [{ accountId }, query] = await Promise.all([params, searchParams]);
  const parsedWindow = metricWindowSchema.safeParse(query.window);
  const window = parsedWindow.success ? parsedWindow.data : "last_100";
  const parsedPatch = identifierSchema.safeParse(query.patch);
  const patch = parsedPatch.success ? parsedPatch.data : undefined;
  const matchFilters: MatchFilters = {
    dateFrom: /^\d{4}-\d{2}-\d{2}$/.test(query.dateFrom ?? "") ? query.dateFrom : undefined,
    dateTo: /^\d{4}-\d{2}-\d{2}$/.test(query.dateTo ?? "") ? query.dateTo : undefined,
    gameMode: query.gameMode?.trim() || undefined,
    heroId: identifierSchema.safeParse(query.heroId).success ? query.heroId : undefined,
    lobbyType: query.lobbyType === "7" || query.lobbyType === "0" ? query.lobbyType : undefined,
    matchPatch: identifierSchema.safeParse(query.matchPatch).success ? query.matchPatch : undefined,
    outcome: query.outcome === "win" || query.outcome === "loss" ? query.outcome : undefined,
  };
  const matchFilterParams = new URLSearchParams();
  for (const [key, value] of Object.entries(matchFilters)) {
    if (value) matchFilterParams.set(key, value);
  }
  const matchFilterSuffix = matchFilterParams.size > 0 ? `&${matchFilterParams.toString()}` : "";

  const [overviewResult, heroesResult, allImportedHeroesResult, matchesResult, itemsResult, patchesResult] = await Promise.all([
    settle(api.playerOverview(accountId, window, patch)),
    settle(collectAllPlayerHeroes(accountId, window, patch)),
    settle(collectAllPlayerHeroes(accountId, "all_imported")),
    settle(api.playerMatches(accountId, {
      dateFrom: matchFilters.dateFrom,
      dateTo: matchFilters.dateTo,
      gameMode: matchFilters.gameMode,
      heroId: matchFilters.heroId,
      limit: 30,
      lobbyType: matchFilters.lobbyType,
      outcome: matchFilters.outcome,
      patch: matchFilters.matchPatch,
      window: "all_imported",
    })),
    settle(collectAllItems()),
    settle(collectAllPatches()),
  ]);

  if (!overviewResult.ok) {
    const autoSync =
      overviewResult.error instanceof DodoApiError &&
      overviewResult.error.payload?.error.code === "NOT_FOUND";
    return (
      <div className="page-shell">
        <PageHeading
          actions={(
            <div className="player-page-actions">
              <AccountSearch compact />
              <PlayerSyncControl accountId={accountId} autoSync={autoSync} />
            </div>
          )}
          eyebrow={`PLAYER / ${accountId}`}
          lead="这里只展示上游允许公开且已导入的比赛；私密、限流与解析中状态不会退化为空数据。"
          title="玩家数据"
        />
        {autoSync ? null : (
          <DataState error={overviewResult.error} retryHref={`/players/${encodeURIComponent(accountId)}`} />
        )}
      </div>
    );
  }

  const overview = overviewResult.value;
  const patches = patchesResult.ok ? [...patchesResult.value].sort((a, b) => b.releasedAt.localeCompare(a.releasedAt)) : [];
  const activePatch = patches.find((item) => item.id === patch);
  const heroes = heroesResult.ok ? heroesResult.value.items : [];
  const matchFilterHeroes = allImportedHeroesResult.ok ? allImportedHeroesResult.value.items : [];
  const matchHeroOptions = [...new Map([
    ...matchFilterHeroes.map((stats) => [stats.hero.id, stats.hero] as const),
  ]).values()].sort((a, b) => a.localizedName.localeCompare(b.localizedName, "zh-CN"));
  const matchDisplayHeroes = [...new Map([
    ...overview.data.heroes.map((stats) => [stats.hero.id, stats.hero] as const),
    ...heroes.map((stats) => [stats.hero.id, stats.hero] as const),
    ...matchHeroOptions.map((hero) => [hero.id, hero] as const),
  ]).values()];
  const activeMatchPatch = patches.find((item) => item.id === matchFilters.matchPatch);
  const windowGames = heroes.reduce((sum, stats) => sum + stats.games, 0);
  const windowWins = heroes.reduce((sum, stats) => sum + stats.wins, 0);
  const windowWinRate = windowGames > 0 ? windowWins / windowGames : null;
  const metricMeta = heroesResult.ok ? heroesResult.value.meta : undefined;

  return (
    <div className="page-shell player-page">
      <PageHeading
        actions={(
          <div className="player-page-actions">
            <AccountSearch compact />
            <PlayerSyncControl accountId={accountId} updatedAt={overview.meta.updatedAt} />
            <PlayerHistorySyncControl accountId={accountId} />
          </div>
        )}
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

      <EnrichmentControl accountId={accountId} />

      <nav className="window-switcher" aria-label="统计时间窗口">
        {windows.map((item) => (
          <a
            aria-current={window === item ? "page" : undefined}
            href={`?window=${item}${patch ? `&patch=${encodeURIComponent(patch)}` : ""}${matchFilterSuffix}`}
            key={item}
          >
            {windowLabel(item)}
          </a>
        ))}
      </nav>

      <form className="patch-filter" method="get">
        <input name="window" type="hidden" value={window} />
        {[...matchFilterParams].map(([name, value]) => (
          <input key={name} name={name} type="hidden" value={value} />
        ))}
        <label htmlFor="player-patch">官方小版本</label>
        <select defaultValue={patch ?? ""} id="player-patch" name="patch">
          <option value="">全部官方版本</option>
          {patches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <button type="submit">应用版本</button>
        {patch ? <a href={`?window=${window}${matchFilterSuffix}`}>清除版本</a> : null}
      </form>

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
          <div><dt>窗口样本</dt><dd>{formatCount(windowGames)}</dd><small>{windowLabel(window)} · {activePatch?.name ?? "全部版本"}</small></div>
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
            <div className="section-state"><DataState error={heroesResult.error} retryHref={`/players/${encodeURIComponent(accountId)}?window=${window}${patch ? `&patch=${encodeURIComponent(patch)}` : ""}`} /></div>
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
          trailing={<span className="module-note">{activeMatchPatch ? `${activeMatchPatch.name} · ` : ""}每页 30 场</span>}
        >
          {!matchesResult.ok ? (
            <div className="section-state"><DataState error={matchesResult.error} retryHref={`/players/${encodeURIComponent(accountId)}?window=${window}${patch ? `&patch=${encodeURIComponent(patch)}` : ""}`} /></div>
          ) : (
            <>
              <QualityNotice label="比赛明细" quality={matchesResult.value.meta.quality} />
              <MatchExplorer
                accountId={accountId}
                filterHeroes={matchHeroOptions}
                filters={matchFilters}
                heroFilterAvailable={allImportedHeroesResult.ok}
                heroes={matchDisplayHeroes}
                initialPage={matchesResult.value}
                items={itemsResult.ok ? itemsResult.value : []}
                key={JSON.stringify(matchFilters)}
                patches={patches}
              />
            </>
          )}
        </DataSection>
      </div>

      <p className="data-disclaimer">
        胜率 {formatPercent(windowWinRate)}，只描述 {windowGames} 场{activePatch ? ` ${activePatch.name} ` : ""}合格已导入比赛；不外推私密记录或完整职业生涯。
      </p>
    </div>
  );
}
