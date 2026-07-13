-- Force one catalog revalidation after adding structured hero/item effect fields.
-- Existing rows remain readable until StaticCatalogService atomically replaces them.
update dodo.static_snapshots
set
  payload = jsonb_set(
    payload,
    '{checkedAt}',
    to_jsonb('1970-01-01T00:00:00.000Z'::text),
    true
  ),
  updated_at = now()
where kind in ('hero', 'item')
  and payload ->> 'source' = 'dota2_official';
