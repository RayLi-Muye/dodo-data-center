create schema if not exists dodo;

revoke all on schema dodo from public;
revoke all on schema dodo from anon;
revoke all on schema dodo from authenticated;

alter default privileges in schema dodo revoke all on tables from anon, authenticated;
alter default privileges in schema dodo revoke all on sequences from anon, authenticated;
alter default privileges in schema dodo revoke all on functions from anon, authenticated;

create table dodo.heroes (
  id text primary key,
  payload jsonb not null constraint heroes_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now(),
  constraint heroes_id_not_empty_check check (length(id) > 0)
);

create table dodo.items (
  id text primary key,
  payload jsonb not null constraint items_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now(),
  constraint items_id_not_empty_check check (length(id) > 0)
);

create table dodo.maps (
  id text primary key,
  payload jsonb not null constraint maps_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  is_current boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint maps_id_not_empty_check check (length(id) > 0)
);

create unique index maps_one_current_idx
  on dodo.maps (is_current)
  where is_current;

create table dodo.players (
  account_id text primary key,
  payload jsonb not null constraint players_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now(),
  constraint players_account_id_not_empty_check check (length(account_id) > 0)
);

create table dodo.matches (
  id text primary key,
  payload jsonb not null constraint matches_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  start_time timestamptz not null,
  imported_at timestamptz not null,
  source text not null,
  quality text not null,
  updated_at timestamptz not null default now(),
  constraint matches_id_not_empty_check check (length(id) > 0),
  constraint matches_source_check check (
    source in ('opendota', 'steam', 'dotaconstants', 'curated_map', 'seed')
  ),
  constraint matches_quality_check check (quality in ('complete', 'partial', 'stale'))
);

create table dodo.player_matches (
  account_id text not null,
  match_id text not null,
  start_time timestamptz not null,
  primary key (account_id, match_id),
  constraint player_matches_account_id_not_empty_check check (length(account_id) > 0),
  constraint player_matches_match_fk foreign key (match_id)
    references dodo.matches (id)
    on update cascade
    on delete cascade
);

create index player_matches_recent_idx
  on dodo.player_matches (account_id, start_time desc, match_id desc);

create table dodo.sync_jobs (
  job_id text primary key,
  payload jsonb not null constraint sync_jobs_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now(),
  constraint sync_jobs_job_id_not_empty_check check (length(job_id) > 0)
);

create table dodo.player_sync_batches (
  account_id text primary key,
  payload jsonb not null constraint player_sync_batches_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now(),
  constraint player_sync_batches_account_id_not_empty_check check (length(account_id) > 0)
);

create table dodo.player_sync_failures (
  account_id text primary key,
  payload jsonb not null constraint player_sync_failures_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  checked_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint player_sync_failures_account_id_not_empty_check check (length(account_id) > 0)
);

create table dodo.provider_health (
  source text primary key,
  payload jsonb not null constraint provider_health_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  checked_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint provider_health_source_check check (
    source in ('opendota', 'steam', 'dotaconstants', 'curated_map', 'seed')
  )
);

create table dodo.static_snapshots (
  kind text primary key,
  payload jsonb not null constraint static_snapshots_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now(),
  constraint static_snapshots_kind_check check (kind in ('hero', 'item'))
);

revoke all on all tables in schema dodo from anon, authenticated;
revoke all on all sequences in schema dodo from anon, authenticated;
revoke all on all functions in schema dodo from anon, authenticated;
