"use client";

import type { ItemDetail, OperationMeta } from "@dodo/contracts";
import { MetaLine } from "@dodo/ui";
import { useEffect, useMemo, useState } from "react";

import {
  buildItemCatalogEntries,
  filterItemCatalogEntries,
  findItemCatalogEntry,
  groupItemCatalogEntries,
} from "../lib/item-catalog";
import { AssetImage } from "./asset-image";
import { EmptyState } from "./data-state";
import { ItemDetailPanel } from "./item-detail-panel";
import { QualityNotice } from "./quality-notice";

export type ItemWorkbenchQuery = { q?: string | undefined; selected?: string | undefined };

export function readItemWorkbenchQuery(search: string): ItemWorkbenchQuery {
  const params = new URLSearchParams(search);
  const q = params.get("q")?.trim() || undefined;
  const selected = params.get("selected")?.trim() || undefined;
  return { q, selected };
}

export function ItemCatalogWorkbench({
  details,
  initialQuery,
  meta,
}: {
  details: ItemDetail[];
  initialQuery: ItemWorkbenchQuery;
  meta: OperationMeta;
}) {
  const allEntries = useMemo(
    () => buildItemCatalogEntries(details.filter((item) => item.kind !== "recipe")),
    [details],
  );
  const initialEntries = filterItemCatalogEntries(allEntries, initialQuery.q);
  const initialEntry = findItemCatalogEntry(initialEntries, initialQuery.selected) ?? initialEntries[0];
  const [query, setQuery] = useState(initialQuery.q ?? "");
  const [selectedId, setSelectedId] = useState<string | undefined>(
    initialEntry?.members.find((member) => member.item.id === initialQuery.selected)?.item.id
      ?? initialEntry?.members[0]?.item.id,
  );

  const entries = filterItemCatalogEntries(allEntries, query);
  const selectedEntry = findItemCatalogEntry(entries, selectedId) ?? entries[0];
  const selectedMember = selectedEntry?.members.find((member) => member.item.id === selectedId)
    ?? selectedEntry?.members[0];
  const detailById = useMemo(() => new Map(details.map((detail) => [detail.id, detail])), [details]);
  const selectedDetail = selectedMember ? detailById.get(selectedMember.item.id) : undefined;
  const familyDetails = selectedEntry
    ? selectedEntry.members.flatMap((member) => {
      const detail = detailById.get(member.item.id);
      return detail ? [detail] : [];
    })
    : [];
  const components = selectedDetail
    ? selectedDetail.components.flatMap((id) => {
      const component = detailById.get(id);
      return component ? [component] : [];
    })
    : [];
  const currentItems = entries.flatMap((entry) => entry.members.map(({ item }) => item));
  const zones = groupItemCatalogEntries(entries);

  useEffect(() => {
    const restoreFromHistory = () => {
      const next = readItemWorkbenchQuery(window.location.search);
      setQuery(next.q ?? "");
      setSelectedId(next.selected);
    };
    window.addEventListener("popstate", restoreFromHistory);
    return () => window.removeEventListener("popstate", restoreFromHistory);
  }, []);

  const replaceUrl = (nextQuery: string, nextSelectedId: string | undefined) => {
    const url = new URL(window.location.href);
    if (nextQuery.trim()) url.searchParams.set("q", nextQuery.trim());
    else url.searchParams.delete("q");
    if (nextSelectedId) url.searchParams.set("selected", nextSelectedId);
    else url.searchParams.delete("selected");
    window.history.replaceState(window.history.state, "", url);
  };

  const updateQuery = (nextQuery: string) => {
    const nextEntries = filterItemCatalogEntries(allEntries, nextQuery);
    const nextEntry = findItemCatalogEntry(nextEntries, selectedId) ?? nextEntries[0];
    const nextSelectedId = nextEntry?.members.find((member) => member.item.id === selectedId)?.item.id
      ?? nextEntry?.members[0]?.item.id;
    setQuery(nextQuery);
    setSelectedId(nextSelectedId);
    replaceUrl(nextQuery, nextSelectedId);
  };

  const selectItem = (itemId: string, preserveQuery = true) => {
    const nextQuery = preserveQuery ? query : "";
    setQuery(nextQuery);
    setSelectedId(itemId);
    replaceUrl(nextQuery, itemId);
  };

  return (
    <>
      <form className="catalog-search" onSubmit={(event) => event.preventDefault()} role="search">
        <label htmlFor="item-search">搜索物品</label>
        <div>
          <input
            autoComplete="off"
            id="item-search"
            inputMode="search"
            onChange={(event) => updateQuery(event.currentTarget.value)}
            placeholder="输入物品中文名或内部名称…"
            spellCheck={false}
            type="search"
            value={query}
          />
          <button type="submit">筛选物品</button>
        </div>
      </form>

      {currentItems.length === 0 || !selectedEntry || !selectedDetail ? (
        <EmptyState detail="尝试缩短关键词，或清空搜索查看当前快照中的全部物品。" title="没有匹配物品" />
      ) : (
        <section className="catalog-workbench item-shop">
          <header className="catalog-workbench__header">
            <div>
              <span>CURRENT ITEM SHOP</span>
              <h2>{query ? `“${query}” 的物品结果` : "当前物品目录"}</h2>
              <p>{currentItems.length} 个实体 / {entries.length} 个目录入口</p>
            </div>
            <MetaLine sources={meta.sources} updatedAt={meta.updatedAt} />
          </header>
          <QualityNotice label="物品百科" quality={meta.quality} showComplete />
          <div className="item-workbench">
            <div className="item-workbench__catalog">
              {zones.map((zone) => (
                <section className={`item-zone item-zone--${zone.key}`} key={zone.key}>
                  <header><h2>{zone.label}</h2><span>{zone.groups.reduce((total, group) => total + group.entries.length, 0)} 项</span></header>
                  {zone.groups.map((group) => (
                    <section className="item-shop-group" key={group.key}>
                      <header><h3>{group.label}</h3><strong>{group.entries.length}</strong></header>
                      <div className="item-shop-grid">
                        {group.entries.map((entry) => {
                          const selected = entry.id === selectedEntry.id;
                          return (
                            <button
                              aria-current={selected ? "true" : undefined}
                              aria-label={`${entry.item.localizedName}${entry.members.length > 1 ? `，${entry.members.length} 级可升级物品` : ""}`}
                              className="item-shop-tile"
                              key={entry.id}
                              onClick={() => selectItem(entry.item.id)}
                              title={entry.item.localizedName}
                              type="button"
                            >
                              <AssetImage alt="" className="item-shop-tile__image" kind="item" name={entry.item.name} />
                              <span className="sr-only">{entry.item.localizedName}</span>
                              {entry.members.length > 1 ? <small>{entry.members.length}级</small> : null}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </section>
              ))}
            </div>
            <ItemDetailPanel
              components={components}
              detail={selectedDetail}
              entry={selectedEntry}
              familyDetails={familyDetails}
              meta={meta}
              onSelectItem={(itemId) => selectItem(itemId, false)}
              onSelectLevel={(itemId) => selectItem(itemId)}
              selectableComponentIds={components.flatMap((component) => (
                findItemCatalogEntry(allEntries, component.id) ? [component.id] : []
              ))}
            />
          </div>
        </section>
      )}
    </>
  );
}
