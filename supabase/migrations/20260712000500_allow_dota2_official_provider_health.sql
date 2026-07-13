alter table dodo.provider_health
  drop constraint if exists provider_health_source_check;

alter table dodo.provider_health
  add constraint provider_health_source_check check (
    source in (
      'opendota',
      'dota2_official',
      'steam',
      'dotaconstants',
      'curated_map',
      'seed'
    )
  );
