create table dodo.patches (
  id text primary key,
  payload jsonb not null constraint patches_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  released_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint patches_id_not_empty_check check (length(id) > 0)
);

alter table dodo.static_snapshots
  drop constraint static_snapshots_kind_check;

alter table dodo.static_snapshots
  add constraint static_snapshots_kind_check check (kind in ('hero', 'item', 'patch'));

revoke all on table dodo.patches from anon, authenticated;
