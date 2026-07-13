create table dodo.update_releases (
  version text primary key,
  payload jsonb not null constraint update_releases_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  released_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint update_releases_version_not_empty_check check (length(version) > 0)
);

alter table dodo.static_snapshots
  drop constraint static_snapshots_kind_check;

alter table dodo.static_snapshots
  add constraint static_snapshots_kind_check check (kind in ('hero', 'item', 'patch', 'update'));

revoke all on table dodo.update_releases from anon, authenticated;
