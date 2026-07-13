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
  patchesResponseSchema,
  dataStatusResponseSchema,
  entityUpdatesResponseSchema,
  updateDetailResponseSchema,
  updatesResponseSchema,
} from "@dodo/contracts";
import type { ApiError } from "@dodo/contracts";
import type { HeroSummary, ItemSummary, OperationMeta, PatchSummary, PlayerHeroStats, ResponseMeta, UpdateReleaseSummary } from "@dodo/contracts";
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
    environment.API_BASE_URL?.trim() || environment.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (environment.NODE_ENV === "production") {
    throw new Error("API_BASE_URL must be configured for production Web requests.");
  }
  return FALLBACK_API_BASE_URL;
}

export async function fetchApi<TSchema extends z.ZodType>(
  schema: TSchema,
  path: string,
  init: NextRequestInit = {},
): Promise<z.output<TSchema>> {
  const apiBaseUrl = getApiBaseUrl();
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
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
      cache: "no-store",
    }),
  heroUpdates: (heroId: string) =>
    fetchApi(
      entityUpdatesResponseSchema,
      `/v1/heroes/${encodeURIComponent(heroId)}/updates${queryString({ limit: 5 })}`,
      { cache: "no-store" },
    ),
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
  itemUpdates: (itemId: string) =>
    fetchApi(
      entityUpdatesResponseSchema,
      `/v1/items/${encodeURIComponent(itemId)}/updates${queryString({ limit: 5 })}`,
      { cache: "no-store" },
    ),
  items: (options: { cursor?: string | undefined; limit?: number; q?: string | undefined } = {}) =>
    fetchApi(
      itemsResponseSchema,
      `/v1/items${queryString({ cursor: options.cursor, limit: options.limit ?? 100, q: options.q })}`,
      { next: { revalidate: 3_600 } },
    ),
  map: () => fetchApi(mapVersionResponseSchema, "/v1/maps/current", { cache: "no-store" }),
  match: (matchId: string) =>
    fetchApi(matchDetailResponseSchema, `/v1/matches/${encodeURIComponent(matchId)}`, {
      cache: "no-store",
    }),
  patches: (cursor?: string) =>
    fetchApi(
      patchesResponseSchema,
      `/v1/patches${queryString({ cursor, limit: 100 })}`,
      { cache: "no-store" },
    ),
  update: (version: string) =>
    fetchApi(
      updateDetailResponseSchema,
      `/v1/updates/${encodeURIComponent(version)}`,
      { cache: "no-store" },
    ),
  updates: (cursor?: string) =>
    fetchApi(
      updatesResponseSchema,
      `/v1/updates${queryString({ cursor, limit: 100 })}`,
      { cache: "no-store" },
    ),
  playerHeroes: (accountId: string, window: string, patch?: string, cursor?: string) =>
    fetchApi(
      playerHeroesResponseSchema,
      `/v1/players/${encodeURIComponent(accountId)}/heroes${queryString({ cursor, limit: 100, patch, window })}`,
      { cache: "no-store" },
    ),
  playerMatches: (
    accountId: string,
    options: {
      cursor?: string | undefined;
      dateFrom?: string | undefined;
      dateTo?: string | undefined;
      gameMode?: string | undefined;
      heroId?: string | undefined;
      limit?: number;
      lobbyType?: string | undefined;
      outcome?: "win" | "loss" | undefined;
      patch?: string | undefined;
      window?: string | undefined;
    } = {},
  ) =>
    fetchApi(
      playerMatchesResponseSchema,
      `/v1/players/${encodeURIComponent(accountId)}/matches${queryString({
        cursor: options.cursor,
        dateFrom: options.dateFrom,
        dateTo: options.dateTo,
        gameMode: options.gameMode,
        heroId: options.heroId,
        limit: options.limit ?? 30,
        lobbyType: options.lobbyType,
        outcome: options.outcome,
        patch: options.patch,
        window: options.window ?? "all_imported",
      })}`,
      { cache: "no-store" },
    ),
  playerOverview: (accountId: string, window: string, patch?: string) =>
    fetchApi(playerOverviewResponseSchema, `/v1/players/${encodeURIComponent(accountId)}${queryString({ patch, window })}`, {
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

export async function collectAllPatches() {
  return (await collectAllPatchesWithMeta()).items;
}

export async function collectAllPatchesWithMeta() {
  const items: PatchSummary[] = [];
  let cursor: string | undefined;
  let meta: OperationMeta | undefined;
  do {
    const page = await api.patches(cursor);
    items.push(...page.data.items);
    meta ??= page.meta;
    cursor = page.data.nextCursor ?? undefined;
  } while (cursor);
  if (!meta) throw new Error("Patch catalog did not return operation metadata.");
  return { items, meta };
}

export async function collectAllUpdates() {
  return (await collectAllUpdatesWithMeta()).items;
}

export async function collectAllUpdatesWithMeta() {
  const items: UpdateReleaseSummary[] = [];
  let cursor: string | undefined;
  let meta: OperationMeta | undefined;
  do {
    const page = await api.updates(cursor);
    items.push(...page.data.items);
    meta ??= page.meta;
    cursor = page.data.nextCursor ?? undefined;
  } while (cursor);
  if (!meta) throw new Error("Update catalog did not return operation metadata.");
  return { items, meta };
}

export async function collectAllPlayerHeroes(accountId: string, window: string, patch?: string) {
  const items: PlayerHeroStats[] = [];
  let cursor: string | undefined;
  let meta: ResponseMeta | undefined;
  do {
    const page = await api.playerHeroes(accountId, window, patch, cursor);
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
