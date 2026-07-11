import {
  apiErrorSchema,
  heroDetailResponseSchema,
  heroesResponseSchema,
  itemDetailResponseSchema,
  itemsResponseSchema,
  mapVersionResponseSchema,
  matchDetailResponseSchema,
  playerHeroesResponseSchema,
  playerMatchesResponseSchema,
  playerOverviewResponseSchema,
  dataStatusResponseSchema,
} from "@dodo/contracts";
import type { ApiError } from "@dodo/contracts";
import type { HeroSummary, ItemSummary, PlayerHeroStats, ResponseMeta } from "@dodo/contracts";
import type { z } from "zod";

const FALLBACK_API_BASE_URL = "http://127.0.0.1:3001";
const REQUEST_TIMEOUT_MS = 8_000;

type NextRequestInit = RequestInit & {
  next?: { revalidate?: number };
};

export class DodoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: ApiError | null,
    readonly kind: "api" | "unavailable" | "invalid-response",
  ) {
    super(message);
    this.name = "DodoApiError";
  }
}

export function getApiBaseUrl(
  environment: Record<string, string | undefined> = process.env,
): string {
  const configured =
    environment.API_BASE_URL ?? environment.NEXT_PUBLIC_API_BASE_URL ?? FALLBACK_API_BASE_URL;
  return configured.replace(/\/+$/, "");
}

export async function fetchApi<TSchema extends z.ZodType>(
  schema: TSchema,
  path: string,
  init: NextRequestInit = {},
): Promise<z.output<TSchema>> {
  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      ...init,
      headers: { Accept: "application/json", ...init.headers },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const detail = error instanceof Error && error.name === "TimeoutError" ? "请求超时" : "无法连接数据服务";
    throw new DodoApiError(detail, 503, null, "unavailable");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new DodoApiError("数据服务返回了无法读取的响应", response.status, null, "invalid-response");
  }

  if (!response.ok) {
    const error = apiErrorSchema.safeParse(body);
    if (!error.success) {
      throw new DodoApiError("数据服务返回了未知错误", response.status, null, "invalid-response");
    }
    throw new DodoApiError(error.data.error.message, response.status, error.data, "api");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new DodoApiError("数据格式与当前客户端契约不一致", response.status, null, "invalid-response");
  }
  return parsed.data;
}

const queryString = (values: Record<string, string | number | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : "";
};

export const api = {
  dataStatus: () => fetchApi(dataStatusResponseSchema, "/v1/data-status", { cache: "no-store" }),
  hero: (heroId: string) =>
    fetchApi(heroDetailResponseSchema, `/v1/heroes/${encodeURIComponent(heroId)}`, {
      next: { revalidate: 3_600 },
    }),
  heroes: (options: { cursor?: string | undefined; limit?: number; q?: string | undefined } = {}) =>
    fetchApi(
      heroesResponseSchema,
      `/v1/heroes${queryString({ cursor: options.cursor, limit: options.limit ?? 100, q: options.q })}`,
      { next: { revalidate: 3_600 } },
    ),
  item: (itemId: string) =>
    fetchApi(itemDetailResponseSchema, `/v1/items/${encodeURIComponent(itemId)}`, {
      next: { revalidate: 3_600 },
    }),
  items: (options: { cursor?: string | undefined; limit?: number; q?: string | undefined } = {}) =>
    fetchApi(
      itemsResponseSchema,
      `/v1/items${queryString({ cursor: options.cursor, limit: options.limit ?? 100, q: options.q })}`,
      { next: { revalidate: 3_600 } },
    ),
  map: () => fetchApi(mapVersionResponseSchema, "/v1/maps/current", { next: { revalidate: 3_600 } }),
  match: (matchId: string) =>
    fetchApi(matchDetailResponseSchema, `/v1/matches/${encodeURIComponent(matchId)}`, {
      cache: "no-store",
    }),
  playerHeroes: (accountId: string, window: string, cursor?: string) =>
    fetchApi(
      playerHeroesResponseSchema,
      `/v1/players/${encodeURIComponent(accountId)}/heroes${queryString({ cursor, limit: 100, window })}`,
      { cache: "no-store" },
    ),
  playerMatches: (accountId: string, cursor?: string) =>
    fetchApi(
      playerMatchesResponseSchema,
      `/v1/players/${encodeURIComponent(accountId)}/matches${queryString({ cursor, limit: 100 })}`,
      { cache: "no-store" },
    ),
  playerOverview: (accountId: string) =>
    fetchApi(playerOverviewResponseSchema, `/v1/players/${encodeURIComponent(accountId)}`, {
      cache: "no-store",
    }),
};

export async function collectAllHeroes() {
  const items: HeroSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.heroes({ cursor, limit: 100 });
    items.push(...page.data.items);
    cursor = page.data.nextCursor ?? undefined;
  } while (cursor);
  return items;
}

export async function collectAllItems() {
  const items: ItemSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.items({ cursor, limit: 100 });
    items.push(...page.data.items);
    cursor = page.data.nextCursor ?? undefined;
  } while (cursor);
  return items;
}

export async function collectAllPlayerHeroes(accountId: string, window: string) {
  const items: PlayerHeroStats[] = [];
  let cursor: string | undefined;
  let meta: ResponseMeta | undefined;
  do {
    const page = await api.playerHeroes(accountId, window, cursor);
    items.push(...page.data.items);
    meta ??= page.meta;
    cursor = page.data.nextCursor ?? undefined;
  } while (cursor);
  return { items, meta };
}

export type Settled<T> = { ok: true; value: T } | { error: unknown; ok: false };

export async function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { error, ok: false };
  }
}
