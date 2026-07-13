import type { OperationMeta, PatchSummary } from "@dodo/contracts";
import { DataSection, MetaLine, StatusNotice } from "@dodo/ui";
import Link from "next/link";

import { DataState, EmptyState } from "../../components/data-state";
import { PageHeading } from "../../components/page-heading";
import { QualityNotice } from "../../components/quality-notice";
import { UpdateChangeGroup } from "../../components/update-change-group";
import {
  api,
  collectAllHeroes,
  collectAllItems,
  collectAllPatchesWithMeta,
  collectAllUpdatesWithMeta,
  settle,
  type Settled,
} from "../../lib/api";
import { formatUtc } from "../../lib/format";

export const dynamic = "force-dynamic";

const sections = ["general", "hero", "item", "neutral_item", "neutral_creep"] as const;
type UpdateSection = typeof sections[number];

const sectionLabels: Record<UpdateSection, string> = {
  general: "通用",
  hero: "英雄",
  item: "物品",
  neutral_item: "中立物品",
  neutral_creep: "中立生物",
};

const isSection = (value: string | undefined): value is UpdateSection =>
  sections.some((section) => section === value);

function PatchDirectory({ result }: { result: Settled<{ items: PatchSummary[]; meta: OperationMeta }> }) {
  if (!result.ok) {
    return <DataState error={result.error} retryHref="/patches" />;
  }
  const patches = [...result.value.items].sort((a, b) => b.releasedAt.localeCompare(a.releasedAt));
  return (
    <DataSection eyebrow="OFFICIAL VERSION DIRECTORY" title={`${patches.length} 个官方版本`}>
      <QualityNotice label="官方版本目录" quality={result.value.meta.quality} showComplete />
      <details className="update-patch-directory">
        <summary>展开比赛筛选使用的官方小版本目录</summary>
        <ol className="patch-timeline">
          {patches.map((patch, index) => (
            <li key={patch.id}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{patch.name}</strong>
              <time dateTime={patch.releasedAt}>{formatUtc(patch.releasedAt)}</time>
              <code>VERSION {patch.id}</code>
            </li>
          ))}
        </ol>
      </details>
      <MetaLine sources={result.value.meta.sources} updatedAt={result.value.meta.updatedAt} />
    </DataSection>
  );
}

export default async function PatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; version?: string }>;
}) {
  const query = await searchParams;
  const section = isSection(query.section) ? query.section : "general";
  const [updatesResult, patchesResult, heroesResult, itemsResult] = await Promise.all([
    settle(collectAllUpdatesWithMeta()),
    settle(collectAllPatchesWithMeta()),
    settle(collectAllHeroes()),
    settle(collectAllItems()),
  ]);

  const updates = updatesResult.ok
    ? [...updatesResult.value.items].sort((a, b) => b.releasedAt.localeCompare(a.releasedAt))
    : [];
  const requestedVersion = query.version?.trim();
  const selectedVersion = requestedVersion && updates.some((update) => update.version === requestedVersion)
    ? requestedVersion
    : updates[0]?.version;
  const detailResult = selectedVersion ? await settle(api.update(selectedVersion)) : null;
  const recentUpdates = updates.slice(0, 12);
  if (selectedVersion && !recentUpdates.some((update) => update.version === selectedVersion)) {
    const selected = updates.find((update) => update.version === selectedVersion);
    if (selected) recentUpdates.push(selected);
  }

  const heroById = new Map(heroesResult.ok ? heroesResult.value.map((hero) => [hero.id, hero]) : []);
  const itemById = new Map(itemsResult.ok ? itemsResult.value.map((item) => [item.id, item]) : []);

  return (
    <div className="page-shell patches-page">
      <PageHeading
        eyebrow="OFFICIAL UPDATE ARCHIVE"
        lead="阅读 Dota 2 官方小版本更新正文，并按通用、英雄、物品与中立单位分类浏览。"
        title="版本更新"
      />
      <StatusNotice
        detail="官方更新正文与比赛筛选统一使用 7.41d 这类官方小版本号；比赛标签中的推定状态会单独说明。"
        title="统一的官方版本语义"
        tone="neutral"
      />

      {!updatesResult.ok ? (
        <DataState error={updatesResult.error} retryHref="/patches" />
      ) : updates.length === 0 ? (
        <>
          <QualityNotice label="官方更新目录" quality={updatesResult.value.meta.quality} showComplete />
          <MetaLine sources={updatesResult.value.meta.sources} updatedAt={updatesResult.value.meta.updatedAt} />
          <EmptyState detail="官方更新目录当前没有可展示的版本；页面底部仍会呈现可用的官方版本筛选目录。" title="没有官方更新记录" />
        </>
      ) : (
        <>
          <QualityNotice label="官方更新目录" quality={updatesResult.value.meta.quality} showComplete />
          <MetaLine sources={updatesResult.value.meta.sources} updatedAt={updatesResult.value.meta.updatedAt} />
          <nav aria-label="最近官方版本" className="update-version-switcher">
            {recentUpdates.map((update) => (
              <Link
                aria-current={selectedVersion === update.version ? "page" : undefined}
                href={`/patches?version=${encodeURIComponent(update.version)}&section=${section}`}
                key={update.version}
              >
                <strong>{update.version}</strong>
                <small>{update.releasedAt.slice(0, 10)}</small>
              </Link>
            ))}
          </nav>

          <nav aria-label="更新内容分类" className="update-section-switcher">
            {sections.map((item) => (
              <Link
                aria-current={section === item ? "page" : undefined}
                href={`/patches?version=${encodeURIComponent(selectedVersion ?? "")}&section=${item}`}
                key={item}
              >
                {sectionLabels[item]}
              </Link>
            ))}
          </nav>

          {!detailResult ? null : !detailResult.ok ? (
            <DataState
              error={detailResult.error}
              retryHref={`/patches?version=${encodeURIComponent(selectedVersion ?? "")}&section=${section}`}
            />
          ) : (() => {
            const detail = detailResult.value;
            const groups = detail.data.groups.filter((group) => group.kind === section);
            return (
              <DataSection
                className="update-content"
                eyebrow={`${detail.data.version} / ${section.toUpperCase()}`}
                title={`${detail.data.version} · ${sectionLabels[section]}`}
                trailing={<span className="module-note">{groups.length} 组改动</span>}
              >
                <QualityNotice label={`${detail.data.version} 更新正文`} quality={detail.meta.quality} showComplete />
                <MetaLine sources={detail.meta.sources} updatedAt={detail.meta.updatedAt} />
                <dl className="update-release-meta">
                  <div><dt>正文状态</dt><dd><code>{detail.data.contentStatus}</code></dd></div>
                  <div><dt>未收录条目</dt><dd>{detail.data.excludedNoteCount}</dd></div>
                  <div><dt>发布日期</dt><dd>{formatUtc(detail.data.releasedAt)}</dd></div>
                  <div><dt>权威来源</dt><dd><a href={detail.data.sourceUrl} rel="noreferrer" target="_blank">Dota 2 官方更新 ↗</a></dd></div>
                </dl>
                {detail.data.contentStatus === "partial" ? (
                  <StatusNotice
                    detail={`有 ${detail.data.excludedNoteCount} 条内容无法安全转换为纯文本，当前正文不能视为完整版本记录。`}
                    title="更新正文仅部分可用"
                    tone="warning"
                  />
                ) : null}
                {groups.length === 0 ? (
                  <EmptyState detail={`${detail.data.version} 当前没有 ${sectionLabels[section]} 分类的结构化改动。`} title="此分类没有内容" />
                ) : (
                  <div className="update-group-list">
                    {groups.map((group, index) => (
                      <UpdateChangeGroup group={group} heroById={heroById} itemById={itemById} key={`${group.kind}-${group.entityId ?? group.title}-${index}`} />
                    ))}
                  </div>
                )}
              </DataSection>
            );
          })()}
        </>
      )}

      <PatchDirectory result={patchesResult} />
    </div>
  );
}
