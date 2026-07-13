# HTTP Contract v1

所有 ID 在 JSON 和 URL 中均为字符串。成功响应使用 `{ data, meta }`；失败响应使用 `{ error, meta? }`。

## Player

```http
POST /v1/account-resolutions
POST /v1/players/{accountId}/sync
GET  /v1/sync-jobs/{jobId}
POST /v1/players/{accountId}/history-sync
GET  /v1/players/{accountId}/history-sync
GET  /v1/players/{accountId}/enrichment?scope=recent|all_imported
POST /v1/players/{accountId}/enrichment?scope=recent|all_imported
GET  /v1/players/{accountId}
GET  /v1/players/{accountId}/matches?cursor=&limit=&heroId=&patch=&outcome=&gameMode=&dateFrom=&dateTo=
GET  /v1/players/{accountId}/heroes?window=last_20|last_50|last_100|all_imported
GET  /v1/players/{accountId}/heroes/{heroId}?window=last_100
GET  /v1/matches/{matchId}
POST /v1/matches/{matchId}/enrichment
GET  /v1/patches?cursor=&limit=
GET  /v1/updates?cursor=&limit=
GET  /v1/updates/{version}
```

`POST /sync` 接收可选请求体 `{ "trigger": "automatic" | "manual" }`，省略时保持向后兼容并视为 `manual`。`automatic` 必须在服务端再次检查 30 分钟 freshness，新鲜的可读数据不得调用上游；`manual` 始终允许强制刷新。接口返回 `202` 和 `jobId`，不得让 HTTP 请求等待全量同步。

`POST /history-sync` 每次在后台导入一个有界历史批次，使用持久化 `nextOffset` 继续；重复请求不得重复计数。`GET /history-sync` 返回批次数、累计导入数、最早比赛、是否到达上游末端和错误状态。普通最新比赛同步必须追加/更新最近记录，不得删除历史回填得到的旧比赛。

`POST /account-resolutions` 接收判别联合 `{ kind, value }`，其中 `kind` 为 `account_id`、`steam_id64` 或 `steam_profile_url`。成功后返回 canonical `accountId`。首版只支持 `/profiles/<steamid64>` URL；vanity URL 返回 `UNSUPPORTED_ACCOUNT_REFERENCE`，Web 不自行解析。

默认窗口：玩家概览、英雄列表和玩家英雄详情均为 `last_100`。最近 N 场先按 `startTime DESC, id DESC` 稳定排序后截取。所有时间均为 UTC ISO-8601（`Z` 后缀）。

玩家概览、比赛列表、英雄列表与玩家英雄详情支持组合 `window=last_20|last_50|last_100|all_imported` 和 `patch=<official_version>`。存在 `patch` 时先按官方小版本筛选，再在该版本内部按稳定顺序截取窗口；`all_imported` 只表示本系统已导入的公开比赛，不声明完整职业生涯。

比赛浏览列表默认 `limit=30`、`window=all_imported`。`heroId`、`patch`、`outcome=win|loss`、`gameMode`、`lobbyType`、`dateFrom` 与 `dateTo` 必须先组合筛选，再按 `startTime DESC, id DESC` 排序和游标分页；因此“某英雄最近 30 场”表示先筛选该英雄，再取该结果集最新 30 场。Ranked/Normal 使用 `lobbyType`，Turbo 使用 `gameMode`，两者不得混为同一字段。日期使用 UTC 的 `YYYY-MM-DD` 且两端均包含。采集任务每批 100 场只是内部吞吐参数，不得成为前端展示上限。

`GET /v1/matches/{matchId}` 使用 `detailStatus=summary|enriched` 区分玩家比赛摘要与完整十人详情。`officialVersion` 由官方发布时间与比赛开始时间推定，`openDotaPatchId` 保留上游大版本 ID，`officialVersionSource` 必须标明推定或不可用。完整详情可以返回最终装备、背包、中立物品本体、中立强化项、技能升级序列和物品交易时间线。技能只有顺序而没有可靠等级/时间时使用 `abilityBuildStatus=ordered`；只有上游提供真实时间时使用 `timed`。物品购买或出售日志缺失时必须使用 `itemTimelineStatus=unavailable|partial`，不得从最终背包反推交易事件。

比赛详情的基础事实仍以 OpenDota 为主；STRATZ 只可增强加点时间与购买时间。使用 STRATZ 增强时，`enrichmentSources` 包含 `stratz`，响应 `meta.sources` 同时包含 `opendota` 与 `stratz`。`stratzEnrichment` 独立表达未请求、完成、计划重试、终止 partial/failed 与 provider blocked；来源归属不得再作为完成状态。STRATZ 只提供购买事件时，合法成功仍可为 match-level complete，而玩家 `itemTimelineStatus` 保持 partial，明确不含完整出售账本。STRATZ 缺失、限流或不可用时保留已有 OpenDota 数据，不得把现有时间线覆盖为空。STRATZ 的 `gameVersionId` 不得作为当前官方版本：当前英雄、物品与更新日志继续以 Dota 2 official current-data 为准。

批量增强进度必须返回 total、detail ready、complete、retry scheduled、terminal partial/failed、provider blocked、not requested 与当前 retry eligible 数量。统计 meta 的 `sampleSize`/`eligibleCount` 等于 scope 内比赛数，`coverageRate=completeCount/totalMatches`，`metricVersion=match-enrichment-v1`。每次 POST 最多处理 20 场，不得一次性扫描上游全历史。

## Outcome rules

- `public_complete`、`public_partial`：HTTP 200 成功响应；partial 必须带实际数据和 `quality=partial`。
- `history_private`、`profile_private`：玩家统计请求返回 HTTP 403 和对应错误码，不返回空统计；异步同步任务可将其作为终态。
- `source_rate_limited`：直接请求返回 HTTP 429；异步任务记录为可重试状态。
- `source_unavailable`：直接请求返回 HTTP 503；异步任务记录为可重试状态。
- `failed`：直接请求返回 HTTP 500；任务保留可诊断错误码。
- `not_found`：HTTP 404。
- 单场比赛的 `parse_pending` 仅限制 replay 派生能力，基础比赛详情仍可成功返回并明确 parse 状态。
- 玩家同步若因所有候选比赛缺少核心字段而进入 `parse_pending`，玩家统计请求返回 HTTP 409 `PARSE_PENDING`，不得返回 200 空统计；同步任务将同名错误码写入 `errorCode`。
- 当前没有经过来源验证的地图时，地图请求返回 HTTP 503 `MAP_UNAVAILABLE`；不得用 seed、空 geometry 或 complete meta 代替。
- 地图 `patch` 表示该快照明确复核对应的官方 Patch，不是抓取时间或 STRATZ game version。地图必须带不可变 `sourceSnapshot`、官方 `sourceUrls`、App 570 build/depot/resource/extractor/hash 修订和 coverage/exclusions；每个 feature 必须可回查资源实体。
- 地图 geometry 仅允许 `source2-world-units` 下的有限二维 Point、LineString、Polygon，并必须位于 bounds 内。lane 只接受提取的 waypoint topology；Roshan Point 表示 pit/spawner，不表示实时位置。无合法快照时继续 503。
- 地图响应是 operation meta，不是统计 meta。quality、updatedAt 和 sources 来自持久 map snapshot；不得因为存在 current row 就硬编码 complete。
- 已有成功快照后发生 timeout、429、5xx 或内部瞬时失败时，旧玩家数据继续返回 200，并通过 `quality=partial|stale`、同步任务与 provider health 表达失败。`PROFILE_PRIVATE`、`HISTORY_PRIVATE` 与 `NOT_FOUND` 不是可保留旧公开数据的瞬时失败，必须更新访问状态并阻断读取。

列表响应的 `data` 必须包含 `items` 与 `nextCursor`；无下一页时 `nextCursor=null`。`cursor` 是 opaque string，客户端不得解析。

公开 JSON、path/query 参数统一使用 `camelCase`。数据库和分析 SQL 可以内部使用 `snake_case`，但不得泄漏到 HTTP wire format。

列表排序在生成 cursor 前固定为：

- 玩家比赛：`startTime DESC, id DESC`。
- 玩家英雄：`games DESC, hero.id ASC`。
- 英雄百科：`localizedName ASC, id ASC`。
- 物品百科：`localizedName ASC, id ASC`。
- 地图地点：`type ASC, localizedName ASC, id ASC`。

统计响应使用 metric meta；账号解析、同步任务、原始比赛详情、静态百科和数据状态使用 operation meta，不伪造统计样本字段。

## Encyclopedia

```http
GET /v1/heroes?q=&patch=
GET /v1/heroes/{heroId}?patch=
GET /v1/items?q=&patch=
GET /v1/items/{itemId}?patch=
GET /v1/maps/current
GET /v1/maps/{mapVersionId}/features?type=
GET /v1/data-status
```

`GET /v1/heroes/{heroId}` 的 `hype`、`biography`、`complexity` 与 `baseStats` 使用 Dota 2 official current-data。`baseStats` 包括初始生命/魔法、恢复、护甲、魔抗、攻击、三维及成长、移速、攻击距离/间隔、弹道、转身和昼夜视野；历史 payload 缺少这些字段时返回空文本或 `null`，不得从比赛样本反推。`abilities` 使用比赛加点事件同一 numeric ability ID，并以 Dota 2 official current-data 为规则主源。普通技能保持官方编排顺序，天赋随后按等级顺序排列；隐藏技能不得公开。`facetsStatus=active|removed|unavailable` 区分当前启用、当前版本已移除和来源不足；deprecated facet 不得作为当前 facet 展示。无法映射 numeric ID 的技能不得伪造 ID，也不得用名称字符串替代公开 ID。

物品响应使用 `kind=item|recipe|neutral_item|neutral_enhancement` 区分定义类型，并返回 `availabilityStatus=verified_current|unverified`。官方 datafeed 中存在一条定义不能单独证明它当前可在商店购买；未建立独立可用性证据时必须返回 `unverified`，前端不得将其描述为“当前可购买”。

比赛详情展示技能名称时只能使用 `abilityBuild[].abilityId` 与英雄技能字典的精确 ID 匹配。未命中时保留 `技能 #<id>`，不能根据加点位置猜测技能。

`/v1/patches` 使用 Dota 2 官方 `patchnoteslist` 返回包含字母后缀的小版本目录；`/v1/updates` 返回同一官方版本的结构化改动正文。OpenDota major patch ID 只保留在比赛的 `openDotaPatchId` 中，不再作为面向用户的版本目录。

`GET /v1/updates/{version}` 返回通用、英雄、物品、中立物品与中立野怪分组。英雄技能与天赋分别使用 `ability`、`talent` subsection；无法安全转为纯文本的条目必须计入 `excludedNoteCount`，并将 `contentStatus` 标为 `partial`。公开响应不得包含上游 HTML，且必须保留 Dota 2 官方 `sourceUrl`。

## Error codes

```text
INVALID_ACCOUNT_ID
UNSUPPORTED_ACCOUNT_REFERENCE
NOT_FOUND
PROFILE_PRIVATE
HISTORY_PRIVATE
SOURCE_RATE_LIMITED
SOURCE_UNAVAILABLE
PARSE_PENDING
MAP_UNAVAILABLE
SYNC_IN_PROGRESS
VALIDATION_ERROR
INTERNAL_ERROR
```

错误响应可以携带轻量 `meta`，只用于来源、时间、请求状态和 retry 信息，不伪造统计样本字段。
