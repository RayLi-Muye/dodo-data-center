"use client";

import type { HeroSummary } from "@dodo/contracts";
import Link from "next/link";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import { AssetImage } from "./asset-image";
import { canCreateHeroGroup, type HeroGroup, readHeroGroups, writeHeroGroups } from "../lib/hero-groups";
const attributeGroups = [
  { key: "strength", label: "力量", short: "STR", note: "坚韧与正面交锋" },
  { key: "agility", label: "敏捷", short: "AGI", note: "攻速与机动输出" },
  { key: "intelligence", label: "智力", short: "INT", note: "法术与资源控制" },
  { key: "universal", label: "全才", short: "UNI", note: "多属性成长" },
] as const;

function HeroTile({ hero }: { hero: HeroSummary }) {
  const attackLabel = hero.attackType === "melee" ? "近战" : "远程";
  return (
    <Link
      aria-label={`${hero.localizedName}，${attackLabel}`}
      className="hero-armory-tile"
      href={`/heroes/${encodeURIComponent(hero.id)}`}
      title={`${hero.localizedName} · ${attackLabel}`}
    >
      <AssetImage alt="" className="hero-armory-tile__image" kind="hero" name={hero.name} />
      <span className="hero-armory-tile__name">{hero.localizedName}</span>
    </Link>
  );
}

export function HeroCatalogBrowser({ heroes }: { heroes: HeroSummary[] }) {
  const [mode, setMode] = useState<"official" | "custom">("official");
  const [customGroups, setCustomGroups] = useState<HeroGroup[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setCustomGroups(readHeroGroups(window.localStorage));
    } catch {
      setCustomGroups([]);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      writeHeroGroups(window.localStorage, customGroups);
    } catch {
      // The editor remains usable in memory when browser storage is unavailable.
    }
  }, [customGroups, ready]);

  const heroById = useMemo(() => new Map(heroes.map((hero) => [hero.id, hero])), [heroes]);

  function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("groupName") ?? "").trim().slice(0, 32);
    if (!name || !canCreateHeroGroup(customGroups.length)) return;
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setCustomGroups((current) => [...current, { heroIds: [], id, name }]);
    event.currentTarget.reset();
  }

  function addHero(groupId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const heroId = String(form.get("heroId") ?? "");
    if (!heroById.has(heroId)) return;
    setCustomGroups((current) => current.map((group) => (
      group.id === groupId && !group.heroIds.includes(heroId)
        ? { ...group, heroIds: [...group.heroIds, heroId] }
        : group
    )));
    event.currentTarget.reset();
  }

  function removeHero(groupId: string, heroId: string) {
    setCustomGroups((current) => current.map((group) => (
      group.id === groupId ? { ...group, heroIds: group.heroIds.filter((id) => id !== heroId) } : group
    )));
  }

  return (
    <div className="hero-browser">
      <div className="catalog-mode-switch" aria-label="英雄分类方式">
        <button aria-pressed={mode === "official"} onClick={() => setMode("official")} type="button">官方属性</button>
        <button aria-pressed={mode === "custom"} onClick={() => setMode("custom")} type="button">自定义分组</button>
        <span>{heroes.length} 位英雄</span>
      </div>

      {mode === "official" ? (
        <div className="hero-attribute-groups">
          {attributeGroups.map((attribute) => {
            const members = heroes.filter((hero) => hero.primaryAttribute === attribute.key);
            return (
              <section className={`hero-attribute-group hero-attribute-group--${attribute.key}`} key={attribute.key}>
                <header>
                  <span aria-hidden="true">{attribute.short}</span>
                  <div><h2>{attribute.label}</h2><p>{attribute.note}</p></div>
                  <strong>{members.length}</strong>
                </header>
                {members.length > 0 ? (
                  <div className="hero-armory-grid">{members.map((hero) => <HeroTile hero={hero} key={hero.id} />)}</div>
                ) : <p className="catalog-inline-empty">当前筛选中没有{attribute.label}英雄。</p>}
              </section>
            );
          })}
        </div>
      ) : (
        <section className="custom-hero-groups">
          <header>
            <div><h2>我的英雄分组</h2><p>分组仅保存在当前浏览器，不会上传账号数据。</p></div>
            <button className="button-secondary" onClick={() => setMode("official")} type="button">恢复官方属性视图</button>
          </header>
          <form className="custom-group-create" onSubmit={createGroup}>
            <label htmlFor="hero-group-name">新分组名称</label>
            <input id="hero-group-name" maxLength={32} name="groupName" placeholder="例如：中路练习池" required type="text" />
            <button disabled={!canCreateHeroGroup(customGroups.length)} type="submit">建立分组</button>
          </form>
          {!ready ? <p className="catalog-inline-empty">正在读取本地分组…</p> : customGroups.length === 0 ? (
            <p className="catalog-inline-empty">还没有自定义分组。建立一个分组，再从完整英雄名册中添加成员。</p>
          ) : (
            <div className="custom-group-list">
              {customGroups.map((group) => {
                const members = group.heroIds.flatMap((id) => heroById.get(id) ?? []);
                const available = heroes.filter((hero) => !group.heroIds.includes(hero.id));
                return (
                  <section className="custom-group" key={group.id}>
                    <header>
                      <div><h3>{group.name}</h3><span>{members.length} 位英雄</span></div>
                      <button aria-label={`删除分组 ${group.name}`} onClick={() => setCustomGroups((current) => current.filter((candidate) => candidate.id !== group.id))} type="button">删除分组</button>
                    </header>
                    {members.length > 0 ? (
                      <div className="hero-armory-grid">
                        {members.map((hero) => (
                          <article className="custom-hero-member" key={hero.id}>
                            <HeroTile hero={hero} />
                            <button aria-label={`从 ${group.name} 移除 ${hero.localizedName}`} onClick={() => removeHero(group.id, hero.id)} type="button">移除</button>
                          </article>
                        ))}
                      </div>
                    ) : <p className="catalog-inline-empty">这个分组还没有英雄。</p>}
                    <details className="custom-group-editor">
                      <summary>编辑成员</summary>
                      <form onSubmit={(event) => addHero(group.id, event)}>
                        <label htmlFor={`hero-select-${group.id}`}>从完整名册添加</label>
                        <select defaultValue="" id={`hero-select-${group.id}`} name="heroId" required>
                          <option disabled value="">选择英雄</option>
                          {available.map((hero) => <option key={hero.id} value={hero.id}>{hero.localizedName}</option>)}
                        </select>
                        <button disabled={available.length === 0} type="submit">添加英雄</button>
                      </form>
                    </details>
                  </section>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
