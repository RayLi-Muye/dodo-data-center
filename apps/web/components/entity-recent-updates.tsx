import type {
  EntityUpdateRelease,
  HeroSummary,
  ItemSummary,
  OperationMeta,
} from "@dodo/contracts";
import { DataSection, MetaLine } from "@dodo/ui";

import type { Settled } from "../lib/api";
import { DataState, EmptyState } from "./data-state";
import { QualityNotice } from "./quality-notice";
import { UpdateChangeGroup } from "./update-change-group";

type EntityUpdatesResponse = {
  data: { items: EntityUpdateRelease[]; nextCursor: string | null };
  meta: OperationMeta;
};

export function EntityRecentUpdates({
  entityLabel,
  heroById,
  itemById,
  result,
  retryHref,
}: {
  entityLabel: string;
  heroById: Map<string, HeroSummary>;
  itemById: Map<string, ItemSummary>;
  result: Settled<EntityUpdatesResponse>;
  retryHref: string;
}) {
  if (!result.ok) {
    return (
      <DataSection className="entity-updates" eyebrow="RECENT CHANGES" title="最近更新">
        <DataState error={result.error} retryHref={retryHref} />
      </DataSection>
    );
  }

  const { items } = result.value.data;
  const isPartial = result.value.meta.quality === "partial";

  return (
    <DataSection
      className="entity-updates"
      eyebrow="RECENT CHANGES"
      title="最近更新"
      trailing={<span className="module-note">最近 {items.length} 个匹配版本</span>}
    >
      <QualityNotice label={`${entityLabel}更新记录`} quality={result.value.meta.quality} showComplete />
      <MetaLine sources={result.value.meta.sources} updatedAt={result.value.meta.updatedAt} />
      {items.length === 0 ? (
        <EmptyState
          detail={isPartial
            ? "当前可用的部分更新快照没有匹配记录；未收录内容中仍可能包含该条目，不能据此判断它没有改动。"
            : "当前已同步的官方更新范围内没有匹配记录；这不代表更早版本从未改动。"}
          title={isPartial ? "部分快照暂未匹配" : "同步范围内暂未匹配"}
        />
      ) : (
        <div className="entity-update-list">
          {items.map((release) => (
            <section className="entity-update-release" key={release.version}>
              <header className="entity-update-release__header">
                <div>
                  <small>VERSION</small>
                  <h3>{release.version}</h3>
                </div>
                <dl>
                  <div><dt>发布日期</dt><dd><time dateTime={release.releasedAt}>{release.releasedAt.slice(0, 10)}</time></dd></div>
                  <div><dt>匹配改动</dt><dd>{release.matchedGroupCount} 组</dd></div>
                </dl>
                <a href={release.sourceUrl} rel="noreferrer" target="_blank">Dota 2 官方更新 ↗</a>
              </header>
              {release.contentStatus === "partial" ? (
                <p className="entity-update-release__partial">
                  △ 本版本正文仅部分可用；另有 {release.excludedNoteCount} 条内容未能安全结构化。
                </p>
              ) : null}
              <div className="update-group-list">
                {release.groups.map((group, index) => (
                  <UpdateChangeGroup
                    group={group}
                    heroById={heroById}
                    itemById={itemById}
                    key={`${release.version}-${group.kind}-${group.entityId ?? group.title}-${index}`}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </DataSection>
  );
}
