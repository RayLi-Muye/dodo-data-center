import { DataSection, StatusNotice } from "@dodo/ui";

import { DataState } from "../../components/data-state";
import { PageHeading } from "../../components/page-heading";
import { collectAllPatches, settle } from "../../lib/api";
import { formatUtc } from "../../lib/format";

export const dynamic = "force-dynamic";

export default async function PatchesPage() {
  const result = await settle(collectAllPatches());
  if (!result.ok) {
    return (
      <div className="page-shell">
        <PageHeading eyebrow="PATCH ARCHIVE" lead="Dota 版本目录与更新内容。" title="版本更新" />
        <DataState error={result.error} retryHref="/patches" />
      </div>
    );
  }

  const patches = [...result.value].sort((a, b) => b.releasedAt.localeCompare(a.releasedAt));
  return (
    <div className="page-shell patches-page">
      <PageHeading
        eyebrow="PATCH ARCHIVE"
        lead="浏览版本发布日期；英雄、物品、地图和系统改动正文将在下一纵切接入。"
        title="版本更新"
      />
      <StatusNotice
        detail="当前先提供权威版本目录，并与玩家比赛筛选共用 Patch ID，避免两套版本体系。"
        title="版本目录已连接"
        tone="neutral"
      />
      <DataSection eyebrow="PATCH TIMELINE" title={`${patches.length} 个版本`}>
        <ol className="patch-timeline">
          {patches.map((patch, index) => (
            <li key={patch.id}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{patch.name}</strong>
              <time dateTime={patch.releasedAt}>{formatUtc(patch.releasedAt)}</time>
              <code>PATCH #{patch.id}</code>
            </li>
          ))}
        </ol>
      </DataSection>
    </div>
  );
}
