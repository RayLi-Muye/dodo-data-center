import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = (relativePath: string): string =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

describe("Web deployment contract", () => {
  it("self-hosts the design fonts through next/font", () => {
    const layout = source("../app/layout.tsx");
    const css = source("../app/globals.css");

    expect(layout).toContain('from "next/font/google"');
    expect(layout).toContain("Noto_Sans_SC(");
    expect(layout).toContain("Saira_Condensed(");
    expect(layout).toContain("<html className={`${notoSansSc.variable} ${sairaCondensed.variable}`}");
    expect(layout).not.toMatch(/fonts\.(?:googleapis|gstatic)\.com/);
    expect(layout).toContain("https://cdn.cloudflare.steamstatic.com");
    expect(css).toContain("--font-display: var(--font-saira-condensed)");
    expect(css).toContain("--font-body: var(--font-noto-sans-sc)");
  });

  it("prefers Tokyo for pages and every BFF route", () => {
    const regionDeclaration = 'export const preferredRegion = "hnd1";';

    expect(source("../app/layout.tsx")).toContain(regionDeclaration);
    expect(source("../app/api/account-resolutions/route.ts")).toContain(regionDeclaration);
    expect(source("../app/api/players/[accountId]/sync/route.ts")).toContain(regionDeclaration);
    expect(source("../app/api/sync-jobs/[jobId]/route.ts")).toContain(regionDeclaration);
  });
});
