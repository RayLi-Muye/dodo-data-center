insert into dodo.maps (id, payload, is_current, updated_at)
values (
  'seed-map',
  '{
    "id": "seed-map",
    "patch": "seed-patch",
    "coordinateSystem": "seed-normalized-0-100",
    "bounds": {"minX": 0, "minY": 0, "maxX": 100, "maxY": 100},
    "features": [],
    "sourceSnapshot": "curated-map://maps/seed-map",
    "verifiedAt": "2025-01-02T00:00:00.000Z"
  }'::jsonb,
  true,
  '2025-01-02T00:00:00.000Z'::timestamptz
)
on conflict (id) do update
set payload = excluded.payload,
    is_current = excluded.is_current,
    updated_at = excluded.updated_at;
