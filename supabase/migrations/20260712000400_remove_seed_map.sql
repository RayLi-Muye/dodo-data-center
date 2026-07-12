delete from dodo.maps
where id = 'seed-map'
  and payload ->> 'patch' = 'seed-patch'
  and payload ->> 'sourceSnapshot' = 'curated-map://maps/seed-map';
