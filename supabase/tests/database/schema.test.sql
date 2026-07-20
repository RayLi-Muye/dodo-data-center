begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(17);

select ok(
  exists (select 1 from information_schema.schemata where schema_name = 'dodo'),
  'dodo schema exists'
);

select is(
  (select count(*)::integer
   from information_schema.tables
   where table_schema = 'dodo'
     and table_name in (
       'heroes', 'items', 'maps', 'players', 'matches', 'match_analysis', 'player_matches',
       'sync_jobs', 'player_sync_batches', 'player_sync_failures',
       'provider_health', 'static_snapshots'
     )),
  12,
  'all MVP tables exist'
);

select is(
  (select count(*)::integer
   from information_schema.columns
   where table_schema = 'dodo'
     and column_name = 'payload'
     and is_nullable <> 'NO'),
  0,
  'all payload columns are not nullable'
);

select is(
  (select string_agg(kcu.column_name, ',' order by kcu.ordinal_position)
   from information_schema.table_constraints tc
   join information_schema.key_column_usage kcu
     on tc.constraint_name = kcu.constraint_name
    and tc.constraint_schema = kcu.constraint_schema
   where tc.table_schema = 'dodo'
     and tc.table_name = 'player_matches'
     and tc.constraint_type = 'PRIMARY KEY'),
  'account_id,match_id',
  'player_matches primary key is account_id plus match_id'
);

select ok(
  exists (
    select 1
    from information_schema.table_constraints
    where constraint_schema = 'dodo'
      and table_name = 'player_matches'
      and constraint_name = 'player_matches_match_fk'
      and constraint_type = 'FOREIGN KEY'
  ),
  'player_matches has its match foreign key'
);

select is(
  (select delete_rule
   from information_schema.referential_constraints
   where constraint_schema = 'dodo'
     and constraint_name = 'player_matches_match_fk'),
  'CASCADE',
  'deleting a match cascades to player_matches'
);

select ok(
  exists (
    select 1
    from information_schema.table_constraints
    where constraint_schema = 'dodo'
      and table_name = 'match_analysis'
      and constraint_name = 'match_analysis_match_fk'
      and constraint_type = 'FOREIGN KEY'
  ),
  'match analysis has its match foreign key'
);

select is(
  (select delete_rule
   from information_schema.referential_constraints
   where constraint_schema = 'dodo'
     and constraint_name = 'match_analysis_match_fk'),
  'CASCADE',
  'deleting a match cascades to match analysis'
);

select ok(
  exists (select 1 from pg_constraint where conname = 'match_analysis_quality_check'),
  'match analysis quality uses the canonical quality set'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'dodo'
      and indexname = 'player_matches_recent_idx'
      and indexdef like '%(account_id, start_time DESC, match_id DESC)%'
  ),
  'recent player matches have a stable descending index'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'dodo'
      and indexname = 'maps_one_current_idx'
      and indexdef like 'CREATE UNIQUE INDEX%'
      and indexdef like '%WHERE is_current%'
  ),
  'maps enforce at most one current row'
);

select ok(
  exists (select 1 from pg_constraint where conname = 'static_snapshots_kind_check'),
  'static snapshots restrict kind'
);

select ok(
  exists (select 1 from pg_constraint where conname = 'matches_source_check'),
  'match sources use the canonical source set'
);

select ok(
  exists (select 1 from pg_constraint where conname = 'matches_quality_check'),
  'match quality uses the canonical quality set'
);

select ok(
  exists (select 1 from pg_constraint where conname = 'provider_health_source_check'),
  'provider health sources use the canonical source set'
);

select ok(
  not has_schema_privilege('anon', 'dodo', 'USAGE'),
  'anon cannot use the dodo schema'
);

select ok(
  not has_schema_privilege('authenticated', 'dodo', 'USAGE'),
  'authenticated cannot use the dodo schema'
);

select * from finish();
rollback;
