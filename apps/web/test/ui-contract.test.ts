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
    expect(itemList).toContain("itemKindLabel[item.kind]");
    expect(itemList).toContain("availabilityLabel[item.availabilityStatus]");
    expect(itemDetail).toContain('item.data.availabilityStatus === "unverified"');
    expect(itemDetail).toContain("官方定义存在不等于当前商店可购买");
    expect(patchesPage).toContain("updatedAt={detail.meta.updatedAt}");
  });

  it("localizes official hero roles and marks unavailable snapshot descriptions", () => {
    const heroList = source("../app/heroes/page.tsx");
    const heroDetail = source("../app/heroes/[heroId]/page.tsx");
    const itemDetail = source("../app/items/[itemId]/page.tsx");
    const patchesPage = source("../app/patches/page.tsx");

    expect(heroList).toContain('hero.roles.map(heroRoleLabel).join(" / ")');
    expect(heroDetail).toContain("heroRoleLabel(role)");
    expect(heroDetail).toContain("officialDescription(ability.description)");
    expect(heroDetail).toContain("officialDescription(facet.description)");
    expect(itemDetail).toContain("officialDescription(item.data.description)");
    expect(patchesPage).toContain('detail.data.contentStatus === "partial"');
    expect(patchesPage).toContain('title="更新正文仅部分可用"');
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
    expect(playerControl).toContain("继续下一批");
    expect(playerControl).toContain("不会自动连续扫描全历史");
    expect(matchControl).toContain("router.refresh()");
    expect(matchControl).toContain("当前比赛数据仍会保留");
    expect(workflow).toContain('requestProgress(accountId, scope, "POST"');
    expect(workflow).toContain('requestProgress(accountId, scope, "GET"');
  });
});
