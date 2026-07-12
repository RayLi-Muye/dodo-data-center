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
    expect(syncControl).toContain("disabled={state.running}");
    expect(accountSearch.indexOf("await startAndPollPlayerSync")).toBeLessThan(
      accountSearch.indexOf("router.push"),
    );
  });

  it("exposes the shared patch catalog and preserves player patch filters", () => {
    const header = source("../components/site-header.tsx");
    const playerPage = source("../app/players/[accountId]/page.tsx");
    const patchesPage = source("../app/patches/page.tsx");
    const api = source("../lib/api.ts");

    expect(header).toContain('{ href: "/patches", label: "更新" }');
    expect(playerPage).toContain('id="player-patch"');
    expect(playerPage).toContain("patch=${encodeURIComponent(patch)}");
    expect(patchesPage).toContain("collectAllPatches");
    expect(api).toContain("patch, window");
  });
});
