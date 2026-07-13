import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MetaLine } from "@dodo/ui";
import { describe, expect, it } from "vitest";

describe("MetaLine source attribution", () => {
  it("links STRATZ attribution while preserving other source labels", () => {
    const markup = renderToStaticMarkup(createElement(MetaLine, {
      sources: ["opendota", "stratz"],
      updatedAt: "2026-07-13T00:00:00.000Z",
    }));

    expect(markup).toContain("opendota");
    expect(markup).toContain('href="https://stratz.com/"');
    expect(markup).toContain("STRATZ ↗");
    expect(markup).toContain('target="_blank"');
  });

  it("does not link an unrelated source", () => {
    const markup = renderToStaticMarkup(createElement(MetaLine, {
      sources: ["dota2_official"],
      updatedAt: "2026-07-13T00:00:00.000Z",
    }));

    expect(markup).toContain("dota2_official");
    expect(markup).not.toContain("stratz.com");
  });
});
