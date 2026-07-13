import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationsUrl = new URL("../migrations/", import.meta.url);
const sql = readdirSync(fileURLToPath(migrationsUrl))
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(fileURLToPath(new URL(name, migrationsUrl)), "utf8"))
  .join("\n");
const config = readFileSync(fileURLToPath(new URL("../config.toml", import.meta.url)), "utf8");

const requiredTables = [
  "heroes",
  "items",
  "maps",
  "players",
  "matches",
  "player_matches",
  "sync_jobs",
  "player_sync_batches",
  "player_sync_failures",
  "provider_health",
  "static_snapshots",
  "patches",
  "update_releases",
  "player_history_sync",
];

const requiredColumns = {
  heroes: ["id", "payload", "updated_at"],
  items: ["id", "payload", "updated_at"],
  maps: ["id", "payload", "is_current", "updated_at"],
  players: ["account_id", "payload", "updated_at"],
  matches: ["id", "payload", "start_time", "imported_at", "source", "quality", "updated_at"],
  player_matches: ["account_id", "match_id", "start_time"],
  sync_jobs: ["job_id", "payload", "updated_at"],
  player_sync_batches: ["account_id", "payload", "updated_at"],
  player_sync_failures: ["account_id", "payload", "checked_at", "updated_at"],
  provider_health: ["source", "payload", "checked_at", "updated_at"],
  static_snapshots: ["kind", "payload", "updated_at"],
  patches: ["id", "payload", "released_at", "updated_at"],
  update_releases: ["version", "payload", "released_at", "updated_at"],
  player_history_sync: ["account_id", "payload", "updated_at"],
};

const checks = [
  ["private schema", /create schema if not exists dodo;/i],
  ...requiredTables.map((table) => [
    `table dodo.${table}`,
    new RegExp(`create table dodo\\.${table} \\(`, "i"),
  ]),
  ["single current map", /create unique index maps_one_current_idx[\s\S]*where is_current;/i],
  [
    "player match key",
    /create table dodo\.player_matches[\s\S]*primary key \(account_id, match_id\)/i,
  ],
  [
    "cascading match foreign key",
    /foreign key \(match_id\)[\s\S]*references dodo\.matches \(id\)[\s\S]*on delete cascade/i,
  ],
  [
    "stable recent index",
    /on dodo\.player_matches \(account_id, start_time desc, match_id desc\)/i,
  ],
  ["static snapshot map kind", /check \(kind in \('hero', 'item', 'patch', 'update', 'map'\)\)/i],
  [
    "map payload id matches business key",
    /constraint maps_payload_id_matches_check[\s\S]*payload \? 'id'[\s\S]*payload ->> 'id' = id/i,
  ],
  [
    "map payload id constraint is validated",
    /validate constraint maps_payload_id_matches_check/i,
  ],
  ["official provider health source", /source in \([\s\S]*'dota2_official'[\s\S]*\)/i],
  ["seed map removal", /delete from dodo\.maps[\s\S]*id = 'seed-map'/i],
  ["anon schema revoke", /revoke all on schema dodo from anon;/i],
  ["authenticated schema revoke", /revoke all on schema dodo from authenticated;/i],
];

const missing = checks.filter(([, pattern]) => !pattern.test(sql)).map(([name]) => name);
const tableDefinitions = [...sql.matchAll(/create table dodo\.(\w+) \(([\s\S]*?)\n\);/gi)];
const payloadTables = tableDefinitions
  .filter((match) => /\bpayload jsonb not null\b/i.test(match[0]))
  .map((match) => match[1]);

for (const [table, columns] of Object.entries(requiredColumns)) {
  const definition = tableDefinitions.find((match) => match[1] === table)?.[2] ?? "";
  const actualColumns = definition
    .split("\n")
    .map((line) => line.trim().match(/^([a-z_]+)\s+(?:text|jsonb|boolean|timestamptz)\b/i)?.[1])
    .filter(Boolean);
  if (actualColumns.join(",") !== columns.join(",")) {
    missing.push(`${table} columns: expected ${columns.join(",")}, found ${actualColumns.join(",")}`);
  }
}

if (payloadTables.length !== 13) {
  missing.push(`expected 13 non-null payload tables, found ${payloadTables.length}`);
}

if (!/schemas = \["public", "graphql_public"\]/.test(config) || /schemas = \[[^\]]*"dodo"/.test(config)) {
  missing.push("dodo schema must not be exposed by the local Data API");
}

if (!/\[db\.seed\][\s\S]*enabled = true[\s\S]*sql_paths = \["\.\/seed\.sql"\]/.test(config)) {
  missing.push("local seed configuration");
}

if (missing.length > 0) {
  throw new Error(`Static schema checks failed: ${missing.join(", ")}`);
}

console.log(
  `Static schema checks passed (${checks.length + Object.keys(requiredColumns).length + 3} assertions).`,
);
