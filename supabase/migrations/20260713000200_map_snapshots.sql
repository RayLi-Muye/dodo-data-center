alter table dodo.static_snapshots
  drop constraint static_snapshots_kind_check;

alter table dodo.static_snapshots
  add constraint static_snapshots_kind_check
  check (kind in ('hero', 'item', 'patch', 'update', 'map'));

alter table dodo.maps
  add constraint maps_payload_id_matches_check
  check (payload ? 'id' and payload ->> 'id' = id)
  not valid;

alter table dodo.maps
  validate constraint maps_payload_id_matches_check;
