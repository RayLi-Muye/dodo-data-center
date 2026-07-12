create table dodo.player_history_sync (
  account_id text primary key,
  payload jsonb not null constraint player_history_sync_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now(),
  constraint player_history_sync_account_id_not_empty_check check (length(account_id) > 0)
);

revoke all on table dodo.player_history_sync from anon, authenticated;
