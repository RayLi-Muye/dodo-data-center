create table dodo.match_analysis (
  match_id text primary key,
  payload jsonb not null constraint match_analysis_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  provider_revision text not null,
  imported_at timestamptz not null,
  quality text not null,
  updated_at timestamptz not null default now(),
  constraint match_analysis_match_id_not_empty_check check (length(match_id) > 0),
  constraint match_analysis_provider_revision_not_empty_check
    check (length(provider_revision) > 0),
  constraint match_analysis_quality_check
    check (quality in ('complete', 'partial', 'stale')),
  constraint match_analysis_match_fk foreign key (match_id)
    references dodo.matches (id)
    on update cascade
    on delete cascade
);

revoke all on table dodo.match_analysis from anon, authenticated;
