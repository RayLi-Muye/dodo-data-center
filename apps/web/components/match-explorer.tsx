"use client";

import {
  apiErrorSchema,
  playerMatchesResponseSchema,
  type HeroSummary,
  type ItemSummary,
  type MatchSummary,
  type PatchSummary,
} from "@dodo/contracts";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

import { MatchLedger } from "./match-ledger";

export type MatchFilters = {
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  gameMode?: string | undefined;
  heroId?: string | undefined;
  matchPatch?: string | undefined;
  outcome?: "win" | "loss" | undefined;
};

type MatchPage = {
  data: { items: MatchSummary[]; nextCursor: string | null };
};

const filterKeys = ["heroId", "matchPatch", "outcome", "gameMode", "dateFrom", "dateTo"] as const;

export function MatchExplorer({
  accountId,
  filters,
  filterHeroes,
  heroes,
  heroFilterAvailable,
  initialPage,
  items,
  patches,
}: {
  accountId: string;
  filters: MatchFilters;
  filterHeroes: HeroSummary[];
  heroes: HeroSummary[];
  heroFilterAvailable: boolean;
  initialPage: MatchPage;
  items: ItemSummary[];
  patches: PatchSummary[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [matches, setMatches] = useState(initialPage.data.items);
  const [nextCursor, setNextCursor] = useState(initialPage.data.nextCursor);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const heroById = useMemo(() => new Map(heroes.map((hero) => [hero.id, hero])), [heroes]);
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const gameModes = useMemo(
    () => [...new Set(matches.map((match) => match.gameMode))].sort(),
    [matches],
  );

  const navigateWithFilters = (values: MatchFilters) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const key of filterKeys) next.delete(key);
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
    }
    router.replace(`/players/${encodeURIComponent(accountId)}?${next.toString()}`, { scroll: false });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const outcome = data.get("outcome");
    navigateWithFilters({
      dateFrom: String(data.get("dateFrom") ?? "") || undefined,
      dateTo: String(data.get("dateTo") ?? "") || undefined,
      gameMode: String(data.get("gameMode") ?? "").trim() || undefined,
      heroId: String(data.get("heroId") ?? "") || undefined,
      matchPatch: String(data.get("matchPatch") ?? "") || undefined,
      outcome: outcome === "win" || outcome === "loss" ? outcome : undefined,
    });
  };

  const loadMore = async () => {
    if (!nextCursor || loading) return;
    setLoading(true);
    setMessage(null);
    const query = new URLSearchParams({
      cursor: nextCursor,
      limit: "30",
      window: "all_imported",
    });
    if (filters.heroId) query.set("heroId", filters.heroId);
    if (filters.matchPatch) query.set("patch", filters.matchPatch);
    if (filters.outcome) query.set("outcome", filters.outcome);
    if (filters.gameMode) query.set("gameMode", filters.gameMode);
    if (filters.dateFrom) query.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) query.set("dateTo", filters.dateTo);

    try {
      const response = await fetch(
        `/api/players/${encodeURIComponent(accountId)}/matches?${query.toString()}`,
        { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) },
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        const parsedError = apiErrorSchema.safeParse(body);
        throw new Error(parsedError.success ? parsedError.data.error.message : "加载更多比赛失败。");
      }
      const parsed = playerMatchesResponseSchema.safeParse(body);
      if (!parsed.success) throw new Error("比赛列表返回了无法读取的数据。");
      setMatches((current) => {
        const known = new Set(current.map((match) => match.id));
        return [...current, ...parsed.data.data.items.filter((match) => !known.has(match.id))];
      });
      setNextCursor(parsed.data.data.nextCursor);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载更多比赛失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  };

  const hasFilters = filterKeys.some((key) => Boolean(filters[key]));

  return (
    <div className="match-explorer">
      <details className="match-explorer__filters" open>
        <summary>
          <span>筛选比赛</span>
          <small>{hasFilters ? "已应用组合条件" : "全部已导入比赛"}</small>
        </summary>
        <form onSubmit={submit}>
          <label>
            <span>英雄</span>
            <select defaultValue={filters.heroId ?? ""} disabled={!heroFilterAvailable} name="heroId">
              <option value="">{heroFilterAvailable ? "全部英雄" : "英雄选项暂时不可用"}</option>
              {filterHeroes.map((hero) => <option key={hero.id} value={hero.id}>{hero.localizedName}</option>)}
            </select>
          </label>
          <label>
            <span>比赛列表版本</span>
            <select defaultValue={filters.matchPatch ?? ""} name="matchPatch">
              <option value="">全部版本</option>
              {patches.map((patch) => <option key={patch.id} value={patch.id}>{patch.name}</option>)}
            </select>
          </label>
          <label>
            <span>结果</span>
            <select defaultValue={filters.outcome ?? ""} name="outcome">
              <option value="">全部结果</option>
              <option value="win">胜利</option>
              <option value="loss">失败</option>
            </select>
          </label>
          <label>
            <span>游戏模式（名称或 ID）</span>
            <input defaultValue={filters.gameMode ?? ""} list="player-match-game-modes" name="gameMode" placeholder="例如 All Draft 或 22…" type="text" />
            <datalist id="player-match-game-modes">
              {gameModes.map((mode) => <option key={mode} value={mode} />)}
            </datalist>
          </label>
          <label>
            <span>开始日期（UTC）</span>
            <input defaultValue={filters.dateFrom ?? ""} name="dateFrom" type="date" />
          </label>
          <label>
            <span>结束日期（UTC）</span>
            <input defaultValue={filters.dateTo ?? ""} name="dateTo" type="date" />
          </label>
          <div className="match-explorer__filter-actions">
            <button type="submit">应用筛选</button>
            {hasFilters ? <button className="button-secondary" onClick={() => navigateWithFilters({})} type="button">清除筛选</button> : null}
          </div>
        </form>
      </details>

      {matches.length > 0 ? (
        <MatchLedger heroes={heroById} items={itemById} matches={matches} />
      ) : (
        <div className="match-explorer__empty">
          <strong>没有符合条件的比赛</strong>
          <p>尝试放宽英雄、版本、结果、模式或日期条件。</p>
        </div>
      )}

      <div className="match-explorer__footer">
        <span>已显示 {matches.length} 场</span>
        {nextCursor ? (
          <button disabled={loading} onClick={() => void loadMore()} type="button">
            {loading ? "正在加载…" : "显示更多"}
          </button>
        ) : <small>已到达当前筛选结果末尾</small>}
      </div>
      {message ? <p className="match-explorer__error" role="alert">{message}</p> : null}
    </div>
  );
}
