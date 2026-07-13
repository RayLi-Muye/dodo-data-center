import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = (relativePath: string): string =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

describe("official updates page", () => {
  it("defaults to the newest general section and preserves URL selections", () => {
    const page = source("../app/patches/page.tsx");

    expect(page).toContain('const section = isSection(query.section) ? query.section : "general"');
    expect(page).toContain("updates[0]?.version");
    expect(page).toContain("await settle(api.update(selectedVersion))");
    expect(page).toContain("version=${encodeURIComponent(update.version)}&section=${section}");
    expect(page).toContain("version=${encodeURIComponent(selectedVersion ?? \"\")}&section=${item}");
  });

  it("exposes all five sections, partial state, official source, and the match patch directory", () => {
    const page = source("../app/patches/page.tsx");

    for (const label of ["通用", "英雄", "物品", "中立物品", "中立生物"]) {
      expect(page).toContain(label);
    }
    expect(page).toContain('detail.data.contentStatus === "partial"');
    expect(page).toContain("detail.data.excludedNoteCount");
    expect(page).toContain("href={detail.data.sourceUrl}");
    expect(page).toContain('target="_blank"');
    expect(page).toContain("<PatchDirectory result={patchesResult}");
    expect(page).toContain("比赛筛选使用的官方小版本目录");
    expect(page).toContain("统一的官方版本语义");
  });

  it("resolves hero and item groups by exact entity ID and keeps safe fallbacks", () => {
    const group = source("../components/update-change-group.tsx");

    expect(group).toContain("heroById.get(group.entityId)");
    expect(group).toContain("itemById.get(group.entityId)");
    expect(group).toContain('`英雄 #${fallbackId}`');
    expect(group).toContain('`物品 #${fallbackId}`');
    expect(group).toContain('`技能 #${group.relatedAbilityId}`');
    expect(group).toContain('return "天赋"');
    expect(group).toContain("group.entityName ?? group.title ?? \"中立生物\"");
    expect(group).not.toContain("find((hero)");
    expect(group).not.toContain("find((item)");
  });

  it("keeps selectors wrapping and long update copy inside narrow screens", () => {
    const css = source("../app/globals.css");

    expect(css).toMatch(/\.update-version-switcher,[\s\S]*?flex-wrap: wrap;/);
    expect(css).toMatch(/\.update-section-switcher[\s\S]*?flex-wrap: wrap;/);
    expect(css).toMatch(/\.update-note-list li > p,[\s\S]*?overflow-wrap: anywhere;/);
    expect(css).toContain("white-space: pre-wrap");
  });
});
