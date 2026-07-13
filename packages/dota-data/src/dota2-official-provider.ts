import type { UpdateReleaseDetail } from "@dodo/contracts";

import { Dota2OfficialProviderError } from "./dota2-official-errors.js";
import type {
  CanonicalHeroAbilityConstant,
  CanonicalHeroAbilitySet,
  CanonicalHeroConstant,
  CanonicalItemConstant,
  CanonicalOfficialCatalogExclusion,
  CanonicalOfficialConstantsSnapshot,
  CanonicalOfficialHeroAbilityConstants,
  CanonicalOfficialHeroCatalog,
  CanonicalPatchSummary,
} from "./types.js";

const DEFAULT_BASE_URL = "https://www.dota2.com/";
const OFFICIAL_LANGUAGE = "schinese";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_DETAIL_CONCURRENCY = 3;
const VERSION_PATTERN = /^[0-9]+\.[0-9]+[a-z]?$/;
const HERO_ROLES = [
  "Carry",
  "Support",
  "Nuker",
  "Disabler",
  "Jungler",
  "Durable",
  "Escape",
  "Pusher",
  "Initiator",
] as const;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type JsonRecord = Record<string, unknown>;
type OfficialPatchIndex = {
  items: Array<CanonicalPatchSummary & { timestamp: number }>;
  excludedVersions: string[];
};

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

function readNumber(value: unknown, field: string): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : providerError(`${field} must be a finite number`);
}

function readNonNegativeNumber(value: unknown, field: string): number {
  const number = readNumber(value, field);
  return number >= 0 ? number : providerError(`${field} must be non-negative`);
}

function readBoolean(value: unknown, field: string): boolean {
  return typeof value === "boolean" ? value : providerError(`${field} must be a boolean`);
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function positiveId(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return null;
  return value.toString();
}

function readPositiveId(value: unknown, field: string): string {
  return positiveId(value) ?? providerError(`${field} must be a positive integer ID`);
}

function normalizeOfficialEnvelope(payload: unknown, entity: string): JsonRecord {
  const root = readRecord(payload, entity);
  const result = readRecord(root.result, `${entity}.result`);
  if (result.status !== undefined) {
    if (readInteger(result.status, `${entity}.result.status`) !== 1) {
      providerError(`${entity} was not successful`);
    }
  }
  return readRecord(result.data, `${entity}.result.data`);
}

function normalizePatchIndex(payload: unknown): OfficialPatchIndex {
  const root = readRecord(payload, "patch notes list");
  if (root.success !== true) providerError("patch notes list was not successful");
  const rawPatches = readArray(root.patches, "patch notes list.patches");
  if (rawPatches.length === 0) providerError("patch notes list.patches must not be empty");

  const excludedVersions: string[] = [];
  const items = rawPatches.flatMap((rawPatch, index) => {
    const patch = readRecord(rawPatch, `patch notes list.patches[${index}]`);
    const version = readString(
      patch.patch_number,
      `patch notes list.patches[${index}].patch_number`,
    );
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
      id: version,
      name: version,
      releasedAt: new Date(timestamp * 1_000).toISOString(),
      timestamp,
    }];
  }).sort((left, right) => {
    if (left.timestamp !== right.timestamp) return left.timestamp - right.timestamp;
    return left.name.localeCompare(right.name);
  });
  if (items.length === 0) providerError("patch notes list contains no supported versions");
  return { items, excludedVersions };
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

function formatOfficialNumber(value: number): string {
  return value.toString();
}

function specialValueTextByName(rawAbility: JsonRecord): Map<string, string> {
  const values = new Map<string, string>();
  const rawSpecialValues = rawAbility.special_values;
  if (!Array.isArray(rawSpecialValues)) return values;
  for (const [index, rawSpecialValue] of rawSpecialValues.entries()) {
    if (typeof rawSpecialValue !== "object" || rawSpecialValue === null || Array.isArray(rawSpecialValue)) {
      continue;
    }
    const specialValue = rawSpecialValue as JsonRecord;
    const name = readOptionalString(specialValue.name);
    if (name === null || !Array.isArray(specialValue.values_float)) continue;
    const numericValues = specialValue.values_float.filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value),
    );
    if (numericValues.length === 0) continue;
    values.set(name, numericValues.map(formatOfficialNumber).join(" / "));
    if (name === "value") values.set("value", values.get(name)!);
    if (index === 0 && !values.has("value")) {
      values.set("value", numericValues.map(formatOfficialNumber).join(" / "));
    }
  }
  return values;
}

function officialGameplayText(
  value: unknown,
  rawAbility: JsonRecord,
): { text: string; unresolvedTokens: string[] } {
  if (typeof value !== "string") return { text: "", unresolvedTokens: [] };
  const values = specialValueTextByName(rawAbility);
  const unresolvedTokens = new Set<string>();
  let rendered = decodeHtmlEntities(decodeHtmlEntities(value));
  rendered = rendered.replace(/\{s:([A-Za-z_][A-Za-z0-9_]*)\}/g, (token, name: string) => {
    const replacement = values.get(name);
    if (replacement === undefined) {
      unresolvedTokens.add(token);
      return token;
    }
    return replacement;
  });
  rendered = rendered.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (token, name: string) => {
    const replacement = values.get(name);
    if (replacement === undefined) {
      unresolvedTokens.add(token);
      return token;
    }
    return replacement;
  });
  rendered = rendered.replace(/%%/g, "%");
  return {
    text: officialNoteText(rendered),
    unresolvedTokens: [...unresolvedTokens].sort(),
  };
}

function officialAttributes(rawAbility: JsonRecord): Array<{ label: string; value: string }> {
  if (!Array.isArray(rawAbility.special_values)) return [];
  return rawAbility.special_values.flatMap((rawSpecialValue) => {
    if (typeof rawSpecialValue !== "object" || rawSpecialValue === null || Array.isArray(rawSpecialValue)) {
      return [];
    }
    const specialValue = rawSpecialValue as JsonRecord;
    const label = officialNoteText(specialValue.heading_loc);
    const name = readOptionalString(specialValue.name);
    if (label.length === 0 || name === null) return [];
    const value = specialValueTextByName(rawAbility).get(name);
    return value === undefined ? [] : [{ label, value }];
  });
}

function normalizePrimaryAttribute(value: unknown): CanonicalHeroConstant["primaryAttribute"] {
  if (value === 0) return "strength";
  if (value === 1) return "agility";
  if (value === 2) return "intelligence";
  if (value === 3) return "universal";
  return providerError("hero.primary_attr is not recognized");
}

function normalizeAttackCapability(value: unknown): CanonicalHeroConstant["attackType"] {
  if (value === 1) return "melee";
  if (value === 2) return "ranged";
  return providerError("hero.attack_capability is not recognized");
}

function normalizeRoleLevels(value: unknown): string[] {
  const levels = readArray(value, "hero.role_levels");
  if (levels.length !== HERO_ROLES.length) {
    providerError(`hero.role_levels must contain ${HERO_ROLES.length} entries`);
  }
  return HERO_ROLES.filter((_role, index) => readInteger(levels[index], `hero.role_levels[${index}]`) > 0);
}

function isHiddenAbility(name: string, rawAbility: JsonRecord): boolean {
  return rawAbility.deprecated === true || name === "generic_hidden" || name.endsWith("_hidden");
}

function normalizeAbility(
  rawValue: unknown,
  slot: number,
  forcedType: "talent" | null,
): { ability: CanonicalHeroAbilityConstant | null; reason: string | null; name: string | null } {
  const rawAbility = readRecord(rawValue, "hero ability");
  const name = readString(rawAbility.name, "hero ability.name");
  if (isHiddenAbility(name, rawAbility)) return { ability: null, reason: "hidden_or_deprecated", name };
  const id = readPositiveId(rawAbility.id, "hero ability.id");
  const localizedName = officialGameplayText(rawAbility.name_loc, rawAbility);
  if (localizedName.text.length === 0) return { ability: null, reason: "localized_name_unavailable", name };
  if (localizedName.unresolvedTokens.length > 0) {
    return {
      ability: null,
      reason: `unresolved_template:${localizedName.unresolvedTokens.join(",")}`,
      name,
    };
  }
  const description = officialGameplayText(rawAbility.desc_loc, rawAbility);
  const unresolvedDescriptionReason = description.unresolvedTokens.length > 0
    ? `unresolved_template:${description.unresolvedTokens.join(",")}`
    : null;
  const type = forcedType ?? (
    rawAbility.ability_is_innate === true
      ? "innate"
      : rawAbility.type === 1
        ? "ultimate"
        : "basic"
  );
  return {
    ability: {
      id,
      name,
      localizedName: localizedName.text,
      description: unresolvedDescriptionReason === null ? description.text : "",
      slot,
      type,
    },
    reason: unresolvedDescriptionReason,
    name,
  };
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

function readOfficialText(value: unknown, field: string): string {
  const text = officialNoteText(readString(value, field));
  return text.length > 0 ? text : providerError(`${field} must contain text`);
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
    sourceUrl: `https://www.dota2.com/patches/${expectedVersion}?l=${OFFICIAL_LANGUAGE}`,
    changeGroupCount: groups.length,
    contentStatus: collector.excludedNoteCount > 0 ? "partial" : "complete",
    excludedNoteCount: collector.excludedNoteCount,
    groups,
  };
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let offset = 0; offset < items.length; offset += concurrency) {
    results.push(...await Promise.all(items.slice(offset, offset + concurrency).map(mapper)));
  }
  return results;
}

function exclusionFromError(
  entityType: CanonicalOfficialCatalogExclusion["entityType"],
  entityId: string | null,
  entityName: string | null,
  error: unknown,
): CanonicalOfficialCatalogExclusion {
  if (error instanceof Dota2OfficialProviderError) {
    return {
      entityType,
      entityId,
      entityName,
      kind: "failed",
      reason: error.reason,
      retryable: error.retryable,
    };
  }
  return {
    entityType,
    entityId,
    entityName,
    kind: "failed",
    reason: "unknown_provider_failure",
    retryable: true,
  };
}

function filteredExclusion(
  entityType: CanonicalOfficialCatalogExclusion["entityType"],
  entityId: string | null,
  entityName: string | null,
  reason: string,
): CanonicalOfficialCatalogExclusion {
  return { entityType, entityId, entityName, kind: "filtered", reason, retryable: false };
}

function normalizeFacet(rawValue: unknown): { facet: CanonicalHeroAbilitySet["facets"][number] | null; reason: string | null; name: string | null } {
  const rawFacet = readRecord(rawValue, "hero facet");
  const internalName = readOptionalString(rawFacet.name);
  const name = officialNoteText(
    rawFacet.title_loc ?? rawFacet.name_loc ?? rawFacet.title ?? rawFacet.name,
  );
  if (rawFacet.deprecated === true) return { facet: null, reason: "deprecated", name: internalName };
  if (name.length === 0) return { facet: null, reason: "localized_name_unavailable", name: internalName };
  return {
    facet: {
      name,
      description: officialNoteText(
        rawFacet.description_loc ?? rawFacet.desc_loc ?? rawFacet.description,
      ),
    },
    reason: null,
    name: internalName,
  };
}

function normalizeHeroDetail(
  payload: unknown,
  expectedId: string,
  officialVersion: string,
): {
  hero: CanonicalHeroConstant;
  abilitySet: CanonicalHeroAbilitySet;
  exclusions: CanonicalOfficialCatalogExclusion[];
} {
  const data = normalizeOfficialEnvelope(payload, `hero ${expectedId}`);
  const heroes = readArray(data.heroes, `hero ${expectedId}.heroes`);
  if (heroes.length !== 1) providerError(`hero ${expectedId}.heroes must contain exactly one entry`);
  const rawHero = readRecord(heroes[0], `hero ${expectedId}`);
  const id = readPositiveId(rawHero.id, `hero ${expectedId}.id`);
  if (id !== expectedId) providerError(`hero ${expectedId} returned a different ID`);
  const internalName = readString(rawHero.name, `hero ${expectedId}.name`);
  const localizedName = readString(rawHero.name_loc, `hero ${expectedId}.name_loc`);
  const complexity = readInteger(rawHero.complexity, `hero ${expectedId}.complexity`);
  if (complexity < 1 || complexity > 3) {
    providerError(`hero ${expectedId}.complexity must be between 1 and 3`);
  }
  const rawAbilities = readArray(rawHero.abilities, `hero ${expectedId}.abilities`);
  const rawTalents = readArray(rawHero.talents ?? [], `hero ${expectedId}.talents`);
  const exclusions: CanonicalOfficialCatalogExclusion[] = [];
  const abilities: CanonicalHeroAbilityConstant[] = [];
  const excludedAbilityNames: string[] = [];

  for (const [slot, rawAbility] of rawAbilities.entries()) {
    const normalized = normalizeAbility(rawAbility, slot, null);
    if (normalized.ability !== null) {
      abilities.push(normalized.ability);
      if (normalized.reason !== null) {
        exclusions.push(filteredExclusion(
          "ability",
          normalized.ability.id,
          normalized.name,
          normalized.reason,
        ));
      }
    }
    else {
      if (normalized.name !== null) excludedAbilityNames.push(normalized.name);
      exclusions.push(filteredExclusion(
        "ability",
        positiveId(readRecord(rawAbility, "hero ability").id),
        normalized.name,
        normalized.reason ?? "unusable",
      ));
    }
  }
  for (const [index, rawTalent] of rawTalents.entries()) {
    const normalized = normalizeAbility(rawTalent, rawAbilities.length + index, "talent");
    if (normalized.ability !== null) {
      abilities.push(normalized.ability);
      if (normalized.reason !== null) {
        exclusions.push(filteredExclusion(
          "ability",
          normalized.ability.id,
          normalized.name,
          normalized.reason,
        ));
      }
    }
    else {
      if (normalized.name !== null) excludedAbilityNames.push(normalized.name);
      exclusions.push(filteredExclusion(
        "ability",
        positiveId(readRecord(rawTalent, "hero talent").id),
        normalized.name,
        normalized.reason ?? "unusable",
      ));
    }
  }

  const facets: CanonicalHeroAbilitySet["facets"] = [];
  for (const rawFacet of readArray(rawHero.facets ?? [], `hero ${expectedId}.facets`)) {
    const normalized = normalizeFacet(rawFacet);
    if (normalized.facet !== null) facets.push(normalized.facet);
    else exclusions.push(filteredExclusion("facet", id, normalized.name, normalized.reason ?? "unusable"));
  }

  return {
    hero: {
      id,
      name: internalName.replace(/^npc_dota_hero_/, ""),
      localizedName,
      primaryAttribute: normalizePrimaryAttribute(rawHero.primary_attr),
      attackType: normalizeAttackCapability(rawHero.attack_capability),
      roles: normalizeRoleLevels(rawHero.role_levels),
      officialVersion,
      hype: readOfficialText(rawHero.hype_loc, `hero ${expectedId}.hype_loc`),
      biography: readOfficialText(rawHero.bio_loc, `hero ${expectedId}.bio_loc`),
      complexity,
      baseStats: {
        maxHealth: readNonNegativeNumber(rawHero.max_health, `hero ${expectedId}.max_health`),
        healthRegen: readNumber(rawHero.health_regen, `hero ${expectedId}.health_regen`),
        maxMana: readNonNegativeNumber(rawHero.max_mana, `hero ${expectedId}.max_mana`),
        manaRegen: readNumber(rawHero.mana_regen, `hero ${expectedId}.mana_regen`),
        armor: readNumber(rawHero.armor, `hero ${expectedId}.armor`),
        magicResistance: readNumber(
          rawHero.magic_resistance,
          `hero ${expectedId}.magic_resistance`,
        ),
        damageMin: readNumber(rawHero.damage_min, `hero ${expectedId}.damage_min`),
        damageMax: readNumber(rawHero.damage_max, `hero ${expectedId}.damage_max`),
        strength: {
          base: readNumber(rawHero.str_base, `hero ${expectedId}.str_base`),
          gain: readNumber(rawHero.str_gain, `hero ${expectedId}.str_gain`),
        },
        agility: {
          base: readNumber(rawHero.agi_base, `hero ${expectedId}.agi_base`),
          gain: readNumber(rawHero.agi_gain, `hero ${expectedId}.agi_gain`),
        },
        intelligence: {
          base: readNumber(rawHero.int_base, `hero ${expectedId}.int_base`),
          gain: readNumber(rawHero.int_gain, `hero ${expectedId}.int_gain`),
        },
        movementSpeed: readNonNegativeNumber(
          rawHero.movement_speed,
          `hero ${expectedId}.movement_speed`,
        ),
        attackRange: readNonNegativeNumber(
          rawHero.attack_range,
          `hero ${expectedId}.attack_range`,
        ),
        attackRate: readNonNegativeNumber(rawHero.attack_rate, `hero ${expectedId}.attack_rate`),
        projectileSpeed: readNonNegativeNumber(
          rawHero.projectile_speed,
          `hero ${expectedId}.projectile_speed`,
        ),
        turnRate: readNumber(rawHero.turn_rate, `hero ${expectedId}.turn_rate`),
        sightRangeDay: readNonNegativeNumber(
          rawHero.sight_range_day,
          `hero ${expectedId}.sight_range_day`,
        ),
        sightRangeNight: readNonNegativeNumber(
          rawHero.sight_range_night,
          `hero ${expectedId}.sight_range_night`,
        ),
      },
    },
    abilitySet: {
      heroName: internalName,
      abilities,
      facetsStatus: facets.length > 0 ? "active" : "removed",
      facets,
      excludedAbilityNames: [...new Set(excludedAbilityNames)].sort(),
    },
    exclusions,
  };
}

type OfficialItemListEntry = {
  id: string;
  name: string;
  localizedName: string;
  neutralItemTier: number | null;
  isPregameSuggested: boolean;
  isEarlygameSuggested: boolean;
  isLategameSuggested: boolean;
  recipes: Array<{ componentIds: string[]; componentNames: string[] }>;
};

function normalizeOfficialItemKind(
  name: string,
  neutralItemTier: number | null,
): CanonicalItemConstant["kind"] {
  if (name.startsWith("item_enhancement_")) return "neutral_enhancement";
  if (name.startsWith("item_recipe_")) return "recipe";
  if (neutralItemTier !== null) return "neutral_item";
  return "item";
}

function normalizeItemDetail(
  payload: unknown,
  listEntry: OfficialItemListEntry,
  officialVersion: string,
): { item: CanonicalItemConstant; reason: string | null } {
  const data = normalizeOfficialEnvelope(payload, `item ${listEntry.id}`);
  const items = readArray(data.items, `item ${listEntry.id}.items`);
  if (items.length !== 1) providerError(`item ${listEntry.id}.items must contain exactly one entry`);
  const rawItem = readRecord(items[0], `item ${listEntry.id}`);
  const id = readPositiveId(rawItem.id, `item ${listEntry.id}.id`);
  if (id !== listEntry.id) providerError(`item ${listEntry.id} returned a different ID`);
  const name = readString(rawItem.name, `item ${listEntry.id}.name`).replace(/^item_/, "");
  const localizedName = readString(rawItem.name_loc, `item ${listEntry.id}.name_loc`);
  const description = officialGameplayText(rawItem.desc_loc, rawItem);
  const unresolvedDescriptionReason = description.unresolvedTokens.length > 0
    ? `unresolved_template:${description.unresolvedTokens.join(",")}`
    : null;
  const itemQuality = readInteger(rawItem.item_quality, `item ${listEntry.id}.item_quality`);
  const itemCost = readInteger(rawItem.item_cost, `item ${listEntry.id}.item_cost`);
  if (itemCost < 0) providerError(`item ${listEntry.id}.item_cost must be non-negative`);
  return {
    item: {
      id,
      name,
      localizedName,
      cost: itemCost,
      category: listEntry.neutralItemTier === null
        ? `official_quality_${itemQuality}`
        : `neutral_tier_${listEntry.neutralItemTier}`,
      description: unresolvedDescriptionReason === null ? description.text : "",
      attributes: officialAttributes(rawItem),
      componentNames: listEntry.recipes[0]?.componentNames ?? [],
      kind: normalizeOfficialItemKind(listEntry.name, listEntry.neutralItemTier),
      availabilityStatus: "unverified",
      officialVersion,
      officialClassification: {
        itemQuality,
        neutralItemTier: listEntry.neutralItemTier,
        isPregameSuggested: listEntry.isPregameSuggested,
        isEarlygameSuggested: listEntry.isEarlygameSuggested,
        isLategameSuggested: listEntry.isLategameSuggested,
      },
      officialRecipes: listEntry.recipes,
    },
    reason: unresolvedDescriptionReason,
  };
}

export class Dota2OfficialProvider {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly clock: () => Date;
  private heroCatalogInFlight: Promise<CanonicalOfficialHeroCatalog> | null = null;

  constructor(config: Dota2OfficialProviderConfig = {}) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.clock = config.clock ?? (() => new Date());
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new TypeError("Dota 2 official timeoutMs must be a positive integer");
    }
  }

  async getPatchConstants(): Promise<CanonicalOfficialConstantsSnapshot<CanonicalPatchSummary>> {
    const response = await this.requestPatchIndex();
    const latest = response.index.items.at(-1)!;
    return {
      items: response.index.items.map(({ timestamp: _timestamp, ...patch }) => patch),
      officialVersion: latest.name,
      quality: response.index.excludedVersions.length === 0 ? "complete" : "partial",
      exclusions: response.index.excludedVersions.map((version) =>
        filteredExclusion("patch", null, version, "unsupported_version_format")
      ),
      source: { source: "dota2_official", fetchedAt: response.fetchedAt.toISOString() },
    };
  }

  async getHeroConstants(): Promise<CanonicalOfficialConstantsSnapshot<CanonicalHeroConstant>> {
    return (await this.getCurrentHeroCatalog()).heroes;
  }

  async getHeroAbilityConstants(): Promise<CanonicalOfficialHeroAbilityConstants> {
    return (await this.getCurrentHeroCatalog()).abilities;
  }

  async getCurrentHeroCatalog(): Promise<CanonicalOfficialHeroCatalog> {
    if (this.heroCatalogInFlight !== null) return this.heroCatalogInFlight;
    const request = this.loadCurrentHeroCatalog();
    this.heroCatalogInFlight = request;
    void request.finally(() => {
      if (this.heroCatalogInFlight === request) this.heroCatalogInFlight = null;
    }).catch(() => undefined);
    return request;
  }

  async getItemConstants(): Promise<CanonicalOfficialConstantsSnapshot<CanonicalItemConstant>> {
    const patchResponse = await this.requestPatchIndex();
    const officialVersion = patchResponse.index.items.at(-1)!.name;
    const listUrl = new URL("datafeed/itemlist", this.baseUrl);
    listUrl.searchParams.set("language", OFFICIAL_LANGUAGE);
    const listResponse = await this.requestJson(listUrl);
    const data = normalizeOfficialEnvelope(listResponse.payload, "item list");
    const rawItems = readArray(data.itemabilities, "item list.itemabilities");
    if (rawItems.length === 0) providerError("item list.itemabilities must not be empty");

    const rawEntries = rawItems.map((rawItem, index) => {
      const item = readRecord(rawItem, `item list.itemabilities[${index}]`);
      return {
        raw: item,
        id: readPositiveId(item.id, `item list.itemabilities[${index}].id`),
        name: readString(item.name, `item list.itemabilities[${index}].name`),
        localizedName: readOptionalString(item.name_loc) ?? "",
      };
    });
    const nameById = new Map(rawEntries.map((entry) => [entry.id, entry.name.replace(/^item_/, "")]));
    const recipesByResultName = new Map<string, OfficialItemListEntry["recipes"]>();
    for (const entry of rawEntries) {
      if (!entry.name.startsWith("item_recipe_")) continue;
      const resultName = `item_${entry.name.slice("item_recipe_".length)}`;
      const recipes = readArray(entry.raw.recipes ?? [], `item ${entry.id}.recipes`).map(
        (rawRecipe, recipeIndex) => {
          const recipe = readRecord(rawRecipe, `item ${entry.id}.recipes[${recipeIndex}]`);
          const componentIds = readArray(
            recipe.items,
            `item ${entry.id}.recipes[${recipeIndex}].items`,
          ).map((componentId, componentIndex) =>
            readPositiveId(
              componentId,
              `item ${entry.id}.recipes[${recipeIndex}].items[${componentIndex}]`,
            )
          );
          return {
            componentIds,
            componentNames: componentIds.flatMap((componentId) => {
              const name = nameById.get(componentId);
              return name === undefined ? [] : [name];
            }),
          };
        },
      );
      if (recipes.length > 0) recipesByResultName.set(resultName, recipes);
    }

    const exclusions: CanonicalOfficialCatalogExclusion[] = [];
    const candidates: OfficialItemListEntry[] = [];
    for (const entry of rawEntries) {
      if (entry.localizedName.length === 0) {
        exclusions.push(filteredExclusion("item", entry.id, entry.name, "localized_name_unavailable"));
        continue;
      }
      const rawTier = readInteger(entry.raw.neutral_item_tier, `item ${entry.id}.neutral_item_tier`);
      candidates.push({
        id: entry.id,
        name: entry.name,
        localizedName: entry.localizedName,
        neutralItemTier: rawTier < 0 ? null : rawTier,
        isPregameSuggested: readBoolean(
          entry.raw.is_pregame_suggested,
          `item ${entry.id}.is_pregame_suggested`,
        ),
        isEarlygameSuggested: readBoolean(
          entry.raw.is_earlygame_suggested,
          `item ${entry.id}.is_earlygame_suggested`,
        ),
        isLategameSuggested: readBoolean(
          entry.raw.is_lategame_suggested,
          `item ${entry.id}.is_lategame_suggested`,
        ),
        recipes: recipesByResultName.get(entry.name) ?? [],
      });
    }
    if (candidates.length === 0) providerError("item list contains no localized entries");

    const results = await mapWithConcurrency(candidates, MAX_DETAIL_CONCURRENCY, async (candidate) => {
      const detailUrl = new URL("datafeed/itemdata", this.baseUrl);
      detailUrl.searchParams.set("item_id", candidate.id);
      detailUrl.searchParams.set("language", OFFICIAL_LANGUAGE);
      try {
        const response = await this.requestJson(detailUrl);
        const normalized = normalizeItemDetail(response.payload, candidate, officialVersion);
        return {
          item: normalized.item,
          exclusionReason: normalized.reason,
          fetchedAt: response.fetchedAt,
          error: null,
          candidate,
        };
      } catch (error) {
        return { item: null, exclusionReason: null, fetchedAt: null, error, candidate };
      }
    });
    const items: CanonicalItemConstant[] = [];
    const fetchedAtValues = [patchResponse.fetchedAt, listResponse.fetchedAt];
    let firstFailure: unknown;
    for (const result of results) {
      if (result.item === null) {
        firstFailure ??= result.error;
        exclusions.push(exclusionFromError(
          "item",
          result.candidate.id,
          result.candidate.name,
          result.error,
        ));
      } else {
        items.push(result.item);
        if (result.exclusionReason !== null) {
          exclusions.push(filteredExclusion(
            "item",
            result.item.id,
            result.candidate.name,
            result.exclusionReason,
          ));
        }
        fetchedAtValues.push(result.fetchedAt!);
      }
    }
    if (items.length === 0) throw firstFailure;
    items.sort((left, right) => Number(left.id) - Number(right.id));
    const incomplete = exclusions.some((exclusion) =>
      exclusion.kind === "failed" || (
        exclusion.entityType === "item" && exclusion.reason.startsWith("unresolved_template:")
      )
    );
    return {
      items,
      officialVersion,
      quality: incomplete ? "partial" : "complete",
      exclusions,
      source: {
        source: "dota2_official",
        fetchedAt: fetchedAtValues.reduce((latest, current) => current > latest ? current : latest)
          .toISOString(),
      },
    };
  }

  async getRecentUpdateReleases(limit: number): Promise<RecentUpdateReleases> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new TypeError("Dota 2 official update limit must be a positive integer");
    }
    const listResponse = await this.requestPatchIndex();
    const excludedVersions = [...listResponse.index.excludedVersions];
    const candidates = [...listResponse.index.items]
      .sort((left, right) => right.timestamp - left.timestamp)
      .map((patch) => ({
        version: patch.name,
        timestamp: patch.timestamp,
        releasedAt: patch.releasedAt,
      }))
      .slice(0, limit);

    const items: UpdateReleaseDetail[] = [];
    const detailErrors: unknown[] = [];
    const fetchedAtValues = [listResponse.fetchedAt];
    for (let offset = 0; offset < candidates.length; offset += MAX_DETAIL_CONCURRENCY) {
      const chunk = candidates.slice(offset, offset + MAX_DETAIL_CONCURRENCY);
      const results = await Promise.all(chunk.map(async (candidate) => {
        const detailUrl = new URL("datafeed/patchnotes", this.baseUrl);
        detailUrl.searchParams.set("version", candidate.version);
        detailUrl.searchParams.set("language", OFFICIAL_LANGUAGE);
        try {
          const response = await this.requestJson(detailUrl);
          return {
            item: normalizeUpdateDetail(response.payload, candidate.version, candidate.releasedAt),
            fetchedAt: response.fetchedAt,
            version: candidate.version,
            error: null,
          };
        } catch (error) {
          return { item: null, fetchedAt: null, version: candidate.version, error };
        }
      }));
      for (const result of results) {
        if (result.item === null) {
          excludedVersions.push(result.version);
          detailErrors.push(result.error);
        }
        else {
          items.push(result.item);
          fetchedAtValues.push(result.fetchedAt!);
        }
      }
    }
    if (items.length === 0) {
      const failure = detailErrors.find(
        (error) => error instanceof Dota2OfficialProviderError && error.reason === "rate_limited",
      ) ?? detailErrors[0];
      if (failure instanceof Dota2OfficialProviderError) throw failure;
      throw new Dota2OfficialProviderError(
        "network",
        "Dota 2 official patch details could not be loaded",
        true,
      );
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

  private async loadCurrentHeroCatalog(): Promise<CanonicalOfficialHeroCatalog> {
    const patchResponse = await this.requestPatchIndex();
    const officialVersion = patchResponse.index.items.at(-1)!.name;
    const listUrl = new URL("datafeed/herolist", this.baseUrl);
    listUrl.searchParams.set("language", OFFICIAL_LANGUAGE);
    const listResponse = await this.requestJson(listUrl);
    const data = normalizeOfficialEnvelope(listResponse.payload, "hero list");
    const rawHeroes = readArray(data.heroes, "hero list.heroes");
    if (rawHeroes.length === 0) providerError("hero list.heroes must not be empty");
    const candidates = rawHeroes.map((rawHero, index) => {
      const hero = readRecord(rawHero, `hero list.heroes[${index}]`);
      return {
        id: readPositiveId(hero.id, `hero list.heroes[${index}].id`),
        name: readString(hero.name, `hero list.heroes[${index}].name`),
      };
    });
    const seenIds = new Set<string>();
    for (const candidate of candidates) {
      if (seenIds.has(candidate.id)) providerError(`hero list contains duplicate ID ${candidate.id}`);
      seenIds.add(candidate.id);
    }

    const results = await mapWithConcurrency(candidates, MAX_DETAIL_CONCURRENCY, async (candidate) => {
      const detailUrl = new URL("datafeed/herodata", this.baseUrl);
      detailUrl.searchParams.set("hero_id", candidate.id);
      detailUrl.searchParams.set("language", OFFICIAL_LANGUAGE);
      try {
        const response = await this.requestJson(detailUrl);
        return {
          detail: normalizeHeroDetail(response.payload, candidate.id, officialVersion),
          fetchedAt: response.fetchedAt,
          error: null,
          candidate,
        };
      } catch (error) {
        return { detail: null, fetchedAt: null, error, candidate };
      }
    });

    const heroes: CanonicalHeroConstant[] = [];
    const heroAbilities: Record<string, CanonicalHeroAbilitySet> = {};
    const exclusions: CanonicalOfficialCatalogExclusion[] = [];
    const fetchedAtValues = [patchResponse.fetchedAt, listResponse.fetchedAt];
    let firstFailure: unknown;
    for (const result of results) {
      if (result.detail === null) {
        firstFailure ??= result.error;
        exclusions.push(exclusionFromError(
          "hero",
          result.candidate.id,
          result.candidate.name,
          result.error,
        ));
      } else {
        heroes.push(result.detail.hero);
        heroAbilities[result.detail.abilitySet.heroName] = result.detail.abilitySet;
        exclusions.push(...result.detail.exclusions);
        fetchedAtValues.push(result.fetchedAt!);
      }
    }
    if (heroes.length === 0) throw firstFailure;
    heroes.sort((left, right) => Number(left.id) - Number(right.id));
    const incomplete = exclusions.some((exclusion) =>
      exclusion.kind === "failed" || (
        exclusion.entityType === "ability" && (
          exclusion.reason === "localized_name_unavailable" ||
          exclusion.reason.startsWith("unresolved_template:")
        )
      )
    );
    const fetchedAt = fetchedAtValues.reduce(
      (latest, current) => current > latest ? current : latest,
    ).toISOString();
    const source = { source: "dota2_official" as const, fetchedAt };
    return {
      heroes: {
        items: heroes,
        officialVersion,
        quality: incomplete ? "partial" : "complete",
        exclusions,
        source,
      },
      abilities: {
        heroes: heroAbilities,
        officialVersion,
        quality: incomplete ? "partial" : "complete",
        exclusions,
        source,
      },
    };
  }

  private async requestPatchIndex(): Promise<{
    index: OfficialPatchIndex;
    fetchedAt: Date;
  }> {
    const listUrl = new URL("datafeed/patchnoteslist", this.baseUrl);
    listUrl.searchParams.set("language", OFFICIAL_LANGUAGE);
    const response = await this.requestJson(listUrl);
    return { index: normalizePatchIndex(response.payload), fetchedAt: response.fetchedAt };
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
