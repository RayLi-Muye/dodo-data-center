-- Revalidate item snapshots after resolving official UI attribute tokens.
-- Existing item rows stay readable until the refreshed snapshot replaces them atomically.
update dodo.static_snapshots
set
  payload = jsonb_set(
    payload,
    '{checkedAt}',
    to_jsonb('1970-01-01T00:00:00.000Z'::text),
    true
  ),
  updated_at = now()
where kind = 'item'
  and payload ->> 'source' = 'dota2_official';
