import type { HeroSummary, ItemSummary, UpdateReleaseDetail } from "@dodo/contracts";
import Link from "next/link";

import { AssetImage } from "./asset-image";

type ChangeGroup = UpdateReleaseDetail["groups"][number];

const subsectionLabel = (group: ChangeGroup): string | null => {
  if (group.subsection === "ability") {
    return group.relatedAbilityId ? `技能 #${group.relatedAbilityId}` : "技能";
  }
  if (group.subsection === "talent") return "天赋";
  return null;
};

export function UpdateChangeGroup({
  group,
  heroById,
  itemById,
}: {
  group: ChangeGroup;
  heroById: Map<string, HeroSummary>;
  itemById: Map<string, ItemSummary>;
}) {
  const hero = group.kind === "hero" && group.entityId ? heroById.get(group.entityId) : undefined;
  const item = (group.kind === "item" || group.kind === "neutral_item") && group.entityId
    ? itemById.get(group.entityId)
    : undefined;
  const fallbackId = group.entityId ?? "未知";
  const label = group.kind === "general"
    ? group.title ?? "通用改动"
    : group.kind === "hero"
      ? hero?.localizedName ?? group.entityName ?? `英雄 #${fallbackId}`
      : group.kind === "item" || group.kind === "neutral_item"
        ? item?.localizedName ?? group.entityName ?? `物品 #${fallbackId}`
        : group.entityName ?? group.title ?? "中立生物";
  const relatedLabel = subsectionLabel(group);
  const sourceTitle = group.title && group.title !== label ? group.title : null;

  return (
    <article className={`update-group update-group--${group.kind}`}>
      <header>
        {hero ? <AssetImage alt={`${hero.localizedName} 英雄图标`} className="update-group__asset update-group__asset--hero" kind="hero" name={hero.name} /> : null}
        {item ? <AssetImage alt={`${item.localizedName} 物品图标`} className="update-group__asset" kind="item" name={item.name} /> : null}
        <div>
          {relatedLabel ? <small>{relatedLabel}</small> : null}
          {hero ? <h3><Link href={`/heroes/${encodeURIComponent(hero.id)}`}>{label}</Link></h3>
            : item ? <h3><Link href={`/items/${encodeURIComponent(item.id)}`}>{label}</Link></h3>
              : <h3>{label}</h3>}
          {sourceTitle ? <p>{sourceTitle}</p> : null}
        </div>
      </header>
      <ul className="update-note-list">
        {group.notes.map((note, index) => (
          <li
            className={note.info ? "has-info" : undefined}
            key={`${note.text}-${index}`}
            style={{ paddingInlineStart: `${(note.indentLevel - 1) * 0.5}rem` }}
          >
            <p>{note.text}</p>
            {note.info ? <small>{note.info}</small> : null}
          </li>
        ))}
      </ul>
    </article>
  );
}
