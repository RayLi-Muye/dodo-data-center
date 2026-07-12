import type { UpdateReleaseDetail } from "@dodo/contracts";

import { Dota2OfficialProviderError } from "./dota2-official-errors.js";

const DEFAULT_BASE_URL = "https://www.dota2.com/";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_DETAIL_CONCURRENCY = 3;
const VERSION_PATTERN = /^[0-9]+\.[0-9]+[a-z]?$/;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type JsonRecord = Record<string, unknown>;

export type Dota2OfficialProviderConfig = {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  clock?: () => Date;
};

export type RecentUpdateReleases = {
  items: UpdateReleaseDetail[];
  excludedVersions: string[];
  source: { source: "dota2_official"; fetchedAt: string };
};

function providerError(message: string): never {
  throw new Dota2OfficialProviderError("invalid_response", message, true);
}

function readRecord(value: unknown, field: string): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : providerError(`${field} must be an object`);
}

function readArray(value: unknown, field: string): unknown[] {
  return Array.isArray(value) ? value : providerError(`${field} must be an array`);
}

function readString(value: unknown, field: string): string {
  return typeof value === "string" && value.length > 0
    ? value
    : providerError(`${field} must be a non-empty string`);
}

function readInteger(value: unknown, field: string): number {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : providerError(`${field} must be an integer`);
}

function positiveId(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return null;
  return value.toString();
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|apos|gt|lt|nbsp|quot);/gi, (entity, key: string) => {
    const lower = key.toLowerCase();
    if (lower.startsWith("#")) {
      const codePoint = Number.parseInt(lower.slice(lower[1] === "x" ? 2 : 1), lower[1] === "x" ? 16 : 10);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : "";
    }
    return named[lower] ?? entity;
  });
}

export function officialNoteText(value: unknown): string {
  if (typeof value !== "string") return "";
  const decoded = decodeHtmlEntities(decodeHtmlEntities(value));
  return decoded
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type NoteCollector = { excludedNoteCount: number };

function normalizeNotes(rawValue: unknown, collector: NoteCollector) {
  if (rawValue === undefined) return [];
  return readArray(rawValue, "notes").flatMap((rawNote) => {
    if (typeof rawNote !== "object" || rawNote === null || Array.isArray(rawNote)) {
      collector.excludedNoteCount += 1;
      return [];
    }
    const note = rawNote as JsonRecord;
    const text = officialNoteText(note.note);
    if (text.length === 0) {
      collector.excludedNoteCount += 1;
      return [];
    }
    const info = officialNoteText(note.info);
    const rawIndent = typeof note.indent_level === "number" && Number.isSafeInteger(note.indent_level)
      ? note.indent_level
      : 1;
    return [{
      text: text.slice(0, 2_000),
      info: info.length > 0 ? info.slice(0, 2_000) : null,
      indentLevel: Math.min(8, Math.max(1, rawIndent)),
    }];
  });
}

function cleanOptional(value: unknown, maxLength = 160): string | null {
  const cleaned = officialNoteText(value);
  return cleaned.length > 0 ? cleaned.slice(0, maxLength) : null;
}

type ChangeGroup = UpdateReleaseDetail["groups"][number];

function addGroup(
  groups: ChangeGroup[],
  collector: NoteCollector,
  group: Omit<ChangeGroup, "notes">,
  rawNotes: unknown,
) {
  const notes = normalizeNotes(rawNotes, collector);
  if (notes.length > 0) groups.push({ ...group, notes });
}

function normalizeUpdateDetail(
  payload: unknown,
  expectedVersion: string,
  releasedAt: string,
): UpdateReleaseDetail {
  const root = readRecord(payload, `patch ${expectedVersion}`);
  if (root.success !== true) providerError(`patch ${expectedVersion} was not successful`);
  if (readString(root.patch_number, `patch ${expectedVersion}.patch_number`) !== expectedVersion) {
    providerError(`patch ${expectedVersion} returned a different version`);
  }
  const collector: NoteCollector = { excludedNoteCount: 0 };
  const groups: ChangeGroup[] = [];

  for (const rawGeneral of readArray(root.general_notes ?? [], "general_notes")) {
    const general = readRecord(rawGeneral, "general note group");
    addGroup(groups, collector, {
      kind: "general",
      subsection: "overview",
      entityId: null,
      entityName: null,
      relatedAbilityId: null,
      title: cleanOptional(general.title),
    }, general.generic);
  }

  for (const [field, kind] of [
    ["items", "item"],
    ["neutral_items", "neutral_item"],
  ] as const) {
    for (const rawItem of readArray(root[field] ?? [], field)) {
      const item = readRecord(rawItem, `${field} entry`);
      const title = cleanOptional(item.title);
      const itemId = positiveId(item.ability_id);
      const isGeneralNote = item.is_general_note === true || itemId === null;
      const rawNotes = item.ability_notes ?? (
        isGeneralNote && title !== null
          ? [{ indent_level: 1, note: title }]
          : undefined
      );
      addGroup(groups, collector, {
        kind,
        subsection: "overview",
        entityId: isGeneralNote ? null : itemId,
        entityName: null,
        relatedAbilityId: null,
        title,
      }, rawNotes);
    }
  }

  for (const rawHero of readArray(root.heroes ?? [], "heroes")) {
    const hero = readRecord(rawHero, "hero entry");
    const heroId = positiveId(hero.hero_id);
    addGroup(groups, collector, {
      kind: "hero",
      subsection: "overview",
      entityId: heroId,
      entityName: cleanOptional(hero.localized_name) ?? cleanOptional(hero.name),
      relatedAbilityId: null,
      title: null,
    }, hero.hero_notes);
    addGroup(groups, collector, {
      kind: "hero",
      subsection: "talent",
      entityId: heroId,
      entityName: cleanOptional(hero.localized_name) ?? cleanOptional(hero.name),
      relatedAbilityId: null,
      title: null,
    }, hero.talent_notes);

    for (const rawAbility of readArray(hero.abilities ?? [], "hero abilities")) {
      const ability = readRecord(rawAbility, "hero ability entry");
      addGroup(groups, collector, {
        kind: "hero",
        subsection: "ability",
        entityId: heroId,
        entityName: cleanOptional(hero.localized_name) ?? cleanOptional(hero.name),
        relatedAbilityId: positiveId(ability.ability_id),
        title: cleanOptional(ability.title),
      }, ability.ability_notes);
    }
  }

  for (const rawCreep of readArray(root.neutral_creeps ?? [], "neutral_creeps")) {
    const creep = readRecord(rawCreep, "neutral creep entry");
    addGroup(groups, collector, {
      kind: "neutral_creep",
      subsection: "overview",
      entityId: positiveId(creep.neutral_creep_id) ?? positiveId(creep.id),
      entityName: cleanOptional(creep.localized_name) ?? cleanOptional(creep.name),
      relatedAbilityId: null,
      title: cleanOptional(creep.name),
    }, creep.neutral_creep_notes);
  }

  if (groups.length === 0) {
    providerError(`patch ${expectedVersion} contains no usable change groups`);
  }

  return {
    version: expectedVersion,
    releasedAt,
    sourceUrl: `https://www.dota2.com/patches/${expectedVersion}?l=english`,
    changeGroupCount: groups.length,
    contentStatus: collector.excludedNoteCount > 0 ? "partial" : "complete",
    excludedNoteCount: collector.excludedNoteCount,
    groups,
  };
}

export class Dota2OfficialProvider {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly clock: () => Date;

  constructor(config: Dota2OfficialProviderConfig = {}) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.clock = config.clock ?? (() => new Date());
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new TypeError("Dota 2 official timeoutMs must be a positive integer");
    }
  }

  async getRecentUpdateReleases(limit: number): Promise<RecentUpdateReleases> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new TypeError("Dota 2 official update limit must be a positive integer");
    }
    const listUrl = new URL("datafeed/patchnoteslist", this.baseUrl);
    listUrl.searchParams.set("language", "english");
    const listResponse = await this.requestJson(listUrl);
    const listRoot = readRecord(listResponse.payload, "patch notes list");
    if (listRoot.success !== true) providerError("patch notes list was not successful");
    const rawPatches = readArray(listRoot.patches, "patch notes list.patches");
    if (rawPatches.length === 0) providerError("patch notes list.patches must not be empty");

    const excludedVersions: string[] = [];
    const candidates = rawPatches.flatMap((rawPatch, index) => {
      const patch = readRecord(rawPatch, `patch notes list.patches[${index}]`);
      const version = readString(patch.patch_number, `patch notes list.patches[${index}].patch_number`);
      if (!VERSION_PATTERN.test(version)) {
        excludedVersions.push(version);
        return [];
      }
      const timestamp = readInteger(
        patch.patch_timestamp,
        `patch notes list.patches[${index}].patch_timestamp`,
      );
      if (timestamp <= 0) providerError(`patch ${version} timestamp must be positive`);
      return [{
        version,
        timestamp,
        releasedAt: new Date(timestamp * 1_000).toISOString(),
      }];
    })
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, limit);

    const items: UpdateReleaseDetail[] = [];
    const fetchedAtValues = [listResponse.fetchedAt];
    for (let offset = 0; offset < candidates.length; offset += MAX_DETAIL_CONCURRENCY) {
      const chunk = candidates.slice(offset, offset + MAX_DETAIL_CONCURRENCY);
      const results = await Promise.all(chunk.map(async (candidate) => {
        const detailUrl = new URL("datafeed/patchnotes", this.baseUrl);
        detailUrl.searchParams.set("version", candidate.version);
        detailUrl.searchParams.set("language", "english");
        try {
          const response = await this.requestJson(detailUrl);
          return {
            item: normalizeUpdateDetail(response.payload, candidate.version, candidate.releasedAt),
            fetchedAt: response.fetchedAt,
            version: candidate.version,
          };
        } catch {
          return { item: null, fetchedAt: null, version: candidate.version };
        }
      }));
      for (const result of results) {
        if (result.item === null) excludedVersions.push(result.version);
        else {
          items.push(result.item);
          fetchedAtValues.push(result.fetchedAt!);
        }
      }
    }

    return {
      items,
      excludedVersions,
      source: {
        source: "dota2_official",
        fetchedAt: fetchedAtValues.reduce((latest, current) => current > latest ? current : latest)
          .toISOString(),
      },
    };
  }

  private async requestJson(url: URL): Promise<{ payload: unknown; fetchedAt: Date }> {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        redirect: "error",
        signal: controller.signal,
      });
      if (response.status === 429) {
        throw new Dota2OfficialProviderError("rate_limited", "Dota 2 official rate limit was reached", true, 429);
      }
      if (response.status >= 500) {
        throw new Dota2OfficialProviderError("upstream_5xx", `Dota 2 official returned HTTP ${response.status}`, true, response.status);
      }
      if (!response.ok) {
        throw new Dota2OfficialProviderError("upstream_http", `Dota 2 official returned HTTP ${response.status}`, false, response.status);
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        providerError("Dota 2 official response is not valid JSON");
      }
      return { payload, fetchedAt: this.clock() };
    } catch (error) {
      if (error instanceof Dota2OfficialProviderError) throw error;
      if (timedOut) {
        throw new Dota2OfficialProviderError("timeout", `Dota 2 official request timed out after ${this.timeoutMs}ms`, true);
      }
      throw new Dota2OfficialProviderError("network", "Dota 2 official network request failed", true);
    } finally {
      clearTimeout(timeout);
    }
  }
}
