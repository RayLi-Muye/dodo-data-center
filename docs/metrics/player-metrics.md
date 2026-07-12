# Player Metric Catalog v1

所有玩家指标只描述 `eligible imported matches`，不代表完整生涯。

## Eligibility

首版合格比赛满足：

- 能确定 `match_id`、`start_time`、玩家英雄和胜负。
- 目标玩家具有公开 `account_id`。
- 比赛不是无法判定结果的异常记录。

排除原因必须计入 `excluded_count` 和 `exclusion_reasons`。

## Metrics

| Metric | Definition |
|---|---|
| `games` | 合格窗口内目标玩家比赛数 |
| `wins` | `is_win = true` 的比赛数 |
| `win_rate` | `wins / games`；`games = 0` 时为空 |
| `hero_games` | 窗口内使用该英雄的比赛数 |
| `usage_share` | `hero_games / games` |
| `kda_ratio` | `(sum(kills) + sum(assists)) / max(sum(deaths), 1)` |
| `avg_kills` | `sum(kills) / games` |
| `avg_deaths` | `sum(deaths) / games` |
| `avg_assists` | `sum(assists) / games` |
| `avg_gpm` | 有 GPM 的比赛均值；同时返回字段覆盖率 |
| `avg_xpm` | 有 XPM 的比赛均值；同时返回字段覆盖率 |
| `avg_last_hits` | 有补刀字段的比赛中 `sum(last_hits) / observed_count` |
| `avg_hero_damage` | 有英雄伤害字段的比赛中 `sum(hero_damage) / observed_count` |

## Windows

- `last_20`, `last_50`, `last_100`：先按 `start_time DESC, match_id DESC` 排序再截取。
- `all_imported`：只有在 UI 明确标注“全部已导入比赛”时可用。
- 不足 N 场时使用实际样本，不填充、不外推。
- `patch` 与窗口组合时，先按 Patch ID 过滤，再应用最近 N 场；不得先截取全局最近 N 场后再过滤。
- `all_imported + patch` 表示该版本内全部已导入的合格公开比赛。

## Required metadata

每个统计响应必须包含：

```text
sampleSize
eligibleCount
coverageRate
excludedCount
exclusionReasons
updatedAt
inputWatermark
metricVersion
filtersApplied
sources
quality
```

- `eligibleCount`：完成窗口排序和截取后、应用字段质量排除前的候选记录数。
- `sampleSize`：实际进入该聚合计算的记录数。
- `coverageRate = sampleSize / eligibleCount`；两者都为 0 时定义为 `1`，表示没有已知候选记录被排除，而不是声明历史完整。
- 玩家同步的“计划 100 场 vs 实际导入数量”由玩家资料和数据状态单独表达，不复用上述统计覆盖率。
- GPM/XPM 等可缺失指标必须各自返回 `observedCount` 与字段覆盖率。
- `inputWatermark` 是本次聚合实际包含的最新比赛时间，使用 UTC ISO-8601；无输入时为 `null`。

## Match detail completeness

- `detailStatus=summary`：只保证目标玩家摘要，不声称包含完整阵容。
- `detailStatus=enriched`：已请求并通过完整比赛详情质量门禁；玩家数组应包含上游可用的全部参赛者。
- `abilityBuildStatus=ordered`：只知道升级先后顺序；`heroLevel` 与 `gameTimeSeconds` 可以为空。
- `abilityBuildStatus=timed`：每条升级事件具有上游提供的真实游戏时间。
- `itemTimelineStatus=unavailable`：没有可靠交易日志；空数组不表示玩家没有购买物品。
- `itemTimelineStatus=partial`：只有部分交易类型或时间可用，例如只有购买日志而没有出售日志。
- `itemTimelineStatus=complete`：数据源明确提供完整购买和出售事件；不得通过最终装备差异推断。
