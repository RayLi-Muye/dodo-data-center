import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = (relativePath: string): string =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

describe("Web UI copy and touch contract", () => {
  it("uses the Unicode ellipsis for every requested input placeholder", () => {
    const accountSearch = source("../components/account-search.tsx");
    const heroesPage = source("../app/heroes/page.tsx");
    const itemsPage = source("../app/items/page.tsx");

    expect(accountSearch.match(/placeholder: "[^"]+…"/g)).toHaveLength(3);
    expect(heroesPage).toContain('placeholder="输入英雄中文名或内部名称…"');
    expect(itemsPage).toContain('placeholder="输入物品中文名或内部名称…"');
    expect(`${accountSearch}${heroesPage}${itemsPage}`).not.toMatch(/placeholder(?::|=)[^\n]*\.\.\./);
  });

  it("applies manipulation touch behavior to direct text-like inputs", () => {
    const css = source("../app/globals.css");

    expect(css).toContain('input[type="text"]');
    expect(css).toContain('input[type="search"]');
    expect(css).toContain('input[type="url"]');
    expect(css).toMatch(/input\[type="url"\][^{]+\{\s*touch-action: manipulation;/s);
  });

  it("keeps player refresh visible and waits for sync before first-query navigation", () => {
    const accountSearch = source("../components/account-search.tsx");
    const playerPage = source("../app/players/[accountId]/page.tsx");
    const syncControl = source("../components/player-sync-control.tsx");

    expect(playerPage).toContain("<PlayerSyncControl");
    expect(syncControl).toContain("刷新数据");
    expect(syncControl).toContain("超过 30 分钟");
    expect(syncControl).toContain("disabled={state.running}");
    expect(syncControl).toContain('trigger: force ? "manual" : "automatic"');
    expect(accountSearch.indexOf("await startAndPollPlayerSync")).toBeLessThan(
      accountSearch.indexOf("router.push"),
    );
  });

  it("keeps unavailable maps and current hero mechanics explicit", () => {
    const dataState = source("../components/data-state.tsx");
    const mapApi = source("../lib/api.ts");
    const mapPage = source("../app/map/page.tsx");
    const heroList = source("../app/heroes/page.tsx");
    const heroDetail = source("../app/heroes/[heroId]/page.tsx");

    expect(dataState).toContain('case "MAP_UNAVAILABLE"');
    expect(dataState).toContain("不会用示例数据或空 geometry 冒充真实地图");
    expect(mapApi).toContain('mapVersionResponseSchema, "/v1/maps/current", { cache: "no-store" }');
    expect(mapPage.indexOf("if (!result.ok)")).toBeLessThan(mapPage.indexOf("const width"));
    expect(heroList).not.toContain("命石与技能");
    expect(heroDetail).toContain('hero.data.facetsStatus === "active"');
    expect(heroDetail).toContain('hero.data.facetsStatus === "removed"');
    expect(heroDetail).toContain('hero.data.facetsStatus === "unavailable"');
  });

  it("presents audited map coverage without implying live or raster data", () => {
    const mapPage = source("../app/map/page.tsx");
    const geometry = source("../lib/geometry.ts");
    const css = source("../app/globals.css");

    for (const label of ["痛苦魔方", "双生之门", "观测者", "智慧神符"]) {
      expect(mapPage).toContain(label);
    }
    for (const field of ["buildId", "depotManifestId", "resourceSha256", "extractorVersion", "verifiedAt", "sourceUrls"]) {
      expect(mapPage).toContain(`map.data.${field === "verifiedAt" || field === "sourceUrls" ? field : `sourceRevision.${field}`}`);
    }
    expect(mapPage).toContain("不是肉山的实时位置");
    expect(mapPage).toContain("不显示或复制官方地图贴图");
    expect(mapPage).toContain("不补画未经来源验证的地点、地形或通行路线");
    expect(mapPage).toContain("map.data.coverage.exclusions");
    expect(mapPage).toContain("map.data.quality === \"complete\"");
    expect(mapPage).not.toContain("map-terrain");
    expect(mapPage).not.toContain("if (!geometry) return null");
    expect(geometry).toContain('parseGeometry(geometry: MapGeometry): RenderGeometry');
    expect(geometry).not.toContain("RenderGeometry | null");
    expect(css).toContain(".map-evidence-grid");
    expect(css).toContain(".map-audit-grid");
    expect(css).toMatch(/\.map-filter\s*\{[^}]*overflow-x:\s*auto/s);
    expect(css).toMatch(/\.map-audit-grid dd\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  });

  it("shows friendly match labels without changing raw filter values", () => {
    const ledger = source("../components/match-ledger.tsx");
    const explorer = source("../components/match-explorer.tsx");
    const matchPage = source("../app/matches/[matchId]/page.tsx");

    expect(ledger).toContain("gameModeLabel(match.gameMode)");
    expect(ledger).toContain("matchVersionLabel(match)");
    expect(matchPage).toContain("matchVersionLabel(match.data)");
    expect(explorer).toContain("value={mode}");
    expect(explorer).toContain("gameModeLabel(mode)");
    expect(explorer).toContain('<option value="7">天梯匹配（Ranked）</option>');
    expect(explorer).toContain('<option value="0">普通公开匹配（Normal）</option>');
    expect(explorer).toContain('mode === "23" ? "（Turbo）" : ""');
    expect(explorer).toContain('query.set("gameMode", filters.gameMode)');
    expect(explorer).toContain('query.set("lobbyType", filters.lobbyType)');
  });

  it("keeps history import actionable after loading and visible on the player page", () => {
    const playerPage = source("../app/players/[accountId]/page.tsx");
    const historyControl = source("../components/player-history-sync-control.tsx");
    const historyWorkflow = source("../lib/player-history-sync.ts");

    expect(playerPage).toContain("<PlayerHistorySyncControl");
    expect(historyControl).toContain("继续导入历史");
    expect(historyControl).toContain("controllerRef.current === controller");
    expect(historyControl).toContain("onClick={() => void run()}");
    expect(historyControl).toContain('history?.status === "complete"');
    expect(historyWorkflow).toContain('runWithSignals(accountId, "GET"');
    expect(historyWorkflow).toContain('requestHistorySync(accountId, "POST"');
  });

  it("exposes the shared patch catalog and preserves player patch filters", () => {
    const header = source("../components/site-header.tsx");
    const playerPage = source("../app/players/[accountId]/page.tsx");
    const explorer = source("../components/match-explorer.tsx");
    const patchesPage = source("../app/patches/page.tsx");
    const api = source("../lib/api.ts");

    expect(header).toContain('{ href: "/patches", label: "更新" }');
    expect(playerPage).toContain('id="player-patch"');
    expect(playerPage).toContain("官方小版本");
    expect(explorer).toContain("官方小版本");
    expect(explorer).toContain("value={patch.id}");
    expect(playerPage).toContain("patch=${encodeURIComponent(patch)}");
    expect(patchesPage).toContain("collectAllPatches");
    expect(api).toContain("patch, window");
  });

  it("browses filtered matches in independent 30-row cursor pages", () => {
    const playerPage = source("../app/players/[accountId]/page.tsx");
    const explorer = source("../components/match-explorer.tsx");
    const bff = source("../app/api/players/[accountId]/matches/route.ts");

    expect(playerPage).toContain('collectAllPlayerHeroes(accountId, "all_imported")');
    expect(playerPage).toContain('window: "all_imported"');
    expect(playerPage).toContain("limit: 30");
    expect(playerPage).toContain("key={JSON.stringify(matchFilters)}");
    expect(playerPage).toContain("matchFilterSuffix");
    expect(playerPage).toContain("[...matchFilterParams].map");
    expect(explorer).toContain('const filterKeys = ["heroId", "matchPatch", "outcome", "lobbyType", "gameMode", "dateFrom", "dateTo"]');
    expect(explorer).toContain('cursor: nextCursor');
    expect(explorer).toContain('limit: "30"');
    expect(explorer).toContain("setMatches((current) =>");
    expect(explorer).toContain("显示更多");
    expect(bff).toContain("playerMatchesQuerySchema.safeParse");
    expect(bff).toContain("playerMatchesResponseSchema");
  });

  it("shows encyclopedia quality and keeps item availability claims honest", () => {
    const heroList = source("../app/heroes/page.tsx");
    const heroDetail = source("../app/heroes/[heroId]/page.tsx");
    const itemList = source("../app/items/page.tsx");
    const itemDetail = source("../app/items/[itemId]/page.tsx");
    const patchesPage = source("../app/patches/page.tsx");

    for (const page of [heroList, heroDetail, itemList, itemDetail, patchesPage]) {
      expect(page).toContain("<QualityNotice");
      expect(page).toContain("showComplete");
    }
    expect(heroList).toContain("collectAllHeroesWithMeta");
    expect(itemList).toContain("collectAllItemsWithMeta");
    expect(itemList).toContain('item.kind !== "recipe"');
    expect(itemList).toContain('label: "其他当前物品"');
    expect(itemDetail).toContain('item.data.availabilityStatus === "unverified"');
    expect(itemDetail).toContain("官方定义存在不等于当前商店可购买");
    expect(patchesPage).toContain("updatedAt={detail.meta.updatedAt}");
  });

  it("localizes official hero roles and marks unavailable snapshot descriptions", () => {
    const heroList = source("../app/heroes/page.tsx");
    const heroBrowser = source("../components/hero-catalog-browser.tsx");
    const heroDetail = source("../app/heroes/[heroId]/page.tsx");
    const itemDetail = source("../app/items/[itemId]/page.tsx");
    const patchesPage = source("../app/patches/page.tsx");

    expect(heroList).toContain("<HeroCatalogBrowser");
    expect(heroBrowser).toContain("map(heroRoleLabel)");
    expect(heroDetail).toContain("heroRoleLabel(role)");
    expect(heroDetail).toContain("officialDescription(ability.description)");
    expect(heroDetail).toContain("officialDescription(facet.description)");
    expect(itemDetail).toContain("officialDescription(item.data.description)");
    expect(patchesPage).toContain('detail.data.contentStatus === "partial"');
    expect(patchesPage).toContain('title="更新正文仅部分可用"');
  });

  it("shows all heroes in official attribute groups and preserves local custom groups", () => {
    const heroList = source("../app/heroes/page.tsx");
    const heroBrowser = source("../components/hero-catalog-browser.tsx");
    const itemList = source("../app/items/page.tsx");

    expect(heroList).toContain("collectAllHeroesWithMeta(query.q)");
    for (const attribute of ["strength", "agility", "intelligence", "universal"]) {
      expect(heroBrowser).toContain(`key: "${attribute}"`);
    }
    expect(heroBrowser).toContain('useState<"official" | "custom">("official")');
    expect(heroBrowser).toContain("readHeroGroups(window.localStorage)");
    expect(heroBrowser).toContain("writeHeroGroups(window.localStorage, customGroups)");
    expect(itemList).toContain("groupCurrentItems(currentItems)");
    expect(itemList).toContain('kind === "neutral_enhancement"');
    expect(itemList).toContain('kind === "neutral_item"');
  });

  it("shows the official hero profile and base-stat fields in a responsive reference grid", () => {
    const heroDetail = source("../app/heroes/[heroId]/page.tsx");
    const css = source("../app/globals.css");

    expect(heroDetail).toContain("hero.data.hype.trim()");
    expect(heroDetail).toContain("当前官方快照玩法简介不可用");
    expect(heroDetail).toContain("hero.data.biography.trim()");
    expect(heroDetail).toContain("当前官方快照背景说明不可用");
    expect(heroDetail).toContain("hero.data.complexity");
    expect(heroDetail).toContain("当前官方快照复杂度不可用");
    expect(heroDetail).toContain("当前官方快照基础属性不可用");
    for (const field of [
      "maxHealth",
      "healthRegen",
      "maxMana",
      "manaRegen",
      "armor",
      "magicResistance",
      "damageMin",
      "damageMax",
      "strength",
      "agility",
      "intelligence",
      "movementSpeed",
      "attackRange",
      "attackRate",
      "projectileSpeed",
      "turnRate",
      "sightRangeDay",
      "sightRangeNight",
    ]) {
      expect(heroDetail).toContain(`stats.${field}`);
    }
    expect(css).toContain(".hero-reference-grid");
    expect(css).toContain(".hero-primary-stats");
    expect(css).toMatch(/@media \(min-width: 40rem\)[\s\S]*?\.hero-reference-grid[^}]+grid-template-columns:/);
  });

  it("keeps hero and item details usable while recent official updates fail independently", () => {
    const heroDetail = source("../app/heroes/[heroId]/page.tsx");
    const itemDetail = source("../app/items/[itemId]/page.tsx");
    const recentUpdates = source("../components/entity-recent-updates.tsx");
    const api = source("../lib/api.ts");
    const css = source("../app/globals.css");

    expect(heroDetail).toContain("Promise.all([");
    expect(heroDetail).toContain("settle(api.hero(heroId))");
    expect(heroDetail).toContain("settle(api.heroUpdates(heroId))");
    expect(heroDetail).toContain("if (!heroResult.ok)");
    expect(heroDetail).toContain("ability.attributes.length > 0");
    expect(heroDetail).toContain('className="ability-attribute-list"');
    expect(itemDetail).toContain("settle(api.item(itemId))");
    expect(itemDetail).toContain("settle(api.itemUpdates(itemId))");
    expect(itemDetail).toContain("if (!itemResult.ok)");
    expect(recentUpdates).toContain("if (!result.ok)");
    expect(recentUpdates).toContain("当前可用的部分更新快照没有匹配记录");
    expect(recentUpdates).toContain("不能据此判断它没有改动");
    expect(recentUpdates).toContain("release.sourceUrl");
    expect(recentUpdates).toContain("release.releasedAt.slice(0, 10)");
    expect(api).toContain("/updates${queryString({ limit: 5 })}");
    expect(css).toMatch(/\.entity-update-release\s*\{[^}]*min-width:\s*0/s);
    expect(css).toMatch(/\.entity-update-release__header dd[^}]*overflow-wrap:\s*anywhere/s);
    expect(css).toMatch(/\.ability-attribute-list dd[^}]*overflow-wrap:\s*anywhere/s);
  });

  it("runs bounded player and match enrichment without automatically scanning history", () => {
    const playerPage = source("../app/players/[accountId]/page.tsx");
    const matchPage = source("../app/matches/[matchId]/page.tsx");
    const playerControl = source("../components/enrichment-control.tsx");
    const matchControl = source("../components/match-enrichment-control.tsx");
    const workflow = source("../lib/enrichment.ts");

    expect(playerPage).toContain("<EnrichmentControl");
    expect(matchPage).toContain("<MatchEnrichmentControl");
    for (const label of ["范围比赛", "详情就绪", "完整增强", "等待重试", "终止部分", "终止失败", "提供方阻断", "尚未请求"]) {
      expect(playerControl).toContain(label);
    }
    expect(playerControl).toContain("最近 20 场");
    expect(playerControl).toContain("全部已导入");
    expect(workflow).toContain('buttonLabel: "继续下一批"');
    expect(workflow).toContain('buttonLabel: "等待计划重试"');
    expect(playerControl).toContain("不会自动连续扫描全历史");
    expect(matchControl).toContain("router.refresh()");
    expect(matchControl).toContain("当前比赛数据仍会保留");
    expect(workflow).toContain('requestProgress(accountId, scope, "POST"');
    expect(workflow).toContain('requestProgress(accountId, scope, "GET"');
  });
});
