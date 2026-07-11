# MVP Data Flow

```text
OpenDota / Steam / constants / curated map
  -> immutable raw object
  -> provider adapter
  -> canonical normalizer
  -> data quality gate
  -> match and player_match facts / versioned encyclopedia dimensions
  -> player aggregates
  -> REST API
  -> Next.js Web
```

## Storage policy

- MVP 运行时数据使用 Supabase PostgreSQL；本地与云端共用 `supabase/migrations`。
- 应用表位于不对 Supabase Data API 暴露的 `dodo` schema，只允许服务端 API 使用数据库凭据。
- 当前 canonical 文档以关系业务键和 JSONB 保存；高维 OLAP 事实在指标稳定后再拆分。
- Raw 对象只追加，以内容哈希去重。
- Canonical facts 以业务键幂等 upsert。
- 不同来源的值不互相静默覆盖；保留 provenance。
- 聚合是可删除、可重算的派生数据。
- 地图、英雄、物品和技能均绑定 Patch/快照版本。
- 新地图坐标不得解释旧版本 replay。

## Minimum entities

```text
raw_object
sync_job
player_profile
match
player_match
hero_version
ability_version
item_version
map_version
map_feature
player_overview_aggregate
player_hero_aggregate
```

## Deferred facts

```text
item_purchase
ability_upgrade
ward_event
death_event
position_snapshot
player_minute
```

这些事实依赖 replay 或第三方已解析 replay，不阻塞 MVP。
