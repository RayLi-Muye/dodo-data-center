# HTTP Contract v1

所有 ID 在 JSON 和 URL 中均为字符串。成功响应使用 `{ data, meta }`；失败响应使用 `{ error, meta? }`。

## Player

```http
POST /v1/account-resolutions
POST /v1/players/{accountId}/sync
GET  /v1/sync-jobs/{jobId}
POST /v1/players/{accountId}/history-sync
GET  /v1/players/{accountId}/history-sync
GET  /v1/players/{accountId}
GET  /v1/players/{accountId}/matches?cursor=&limit=&heroId=&patch=&outcome=&gameMode=&dateFrom=&dateTo=
GET  /v1/players/{accountId}/heroes?window=last_20|last_50|last_100|all_imported
GET  /v1/players/{accountId}/heroes/{heroId}?window=last_100
GET  /v1/matches/{matchId}
GET  /v1/patches?cursor=&limit=
GET  /v1/updates?cursor=&limit=
GET  /v1/updates/{version}
```

`POST /sync` 返回 `202` 和 `jobId`，不得让 HTTP 请求等待全量同步。

`POST /history-sync` 每次在后台导入一个有界历史批次，使用持久化 `nextOffset` 继续；重复请求不得重复计数。`GET /history-sync` 返回批次数、累计导入数、最早比赛、是否到达上游末端和错误状态。普通最新比赛同步必须追加/更新最近记录，不得删除历史回填得到的旧比赛。

`POST /account-resolutions` 接收判别联合 `{ kind, value }`，其中 `kind` 为 `account_id`、`steam_id64` 或 `steam_profile_url`。成功后返回 canonical `accountId`。首版只支持 `/profiles/<steamid64>` URL；vanity URL 返回 `UNSUPPORTED_ACCOUNT_REFERENCE`，Web 不自行解析。

默认窗口：玩家概览、英雄列表和玩家英雄详情均为 `last_100`。最近 N 场先按 `startTime DESC, id DESC` 稳定排序后截取。所有时间均为 UTC ISO-8601（`Z` 后缀）。

玩家概览、比赛列表、英雄列表与玩家英雄详情支持组合 `window=last_20|last_50|last_100|all_imported` 和 `patch=<official_version>`。存在 `patch` 时先按官方小版本筛选，再在该版本内部按稳定顺序截取窗口；`all_imported` 只表示本系统已导入的公开比赛，不声明完整职业生涯。

比赛浏览列表默认 `limit=30`、`window=all_imported`。`heroId`、`patch`、`outcome=win|loss`、`gameMode`、`lobbyType`、`dateFrom` 与 `dateTo` 必须先组合筛选，再按 `startTime DESC, id DESC` 排序和游标分页；因此“某英雄最近 30 场”表示先筛选该英雄，再取该结果集最新 30 场。Ranked/Normal 使用 `lobbyType`，Turbo 使用 `gameMode`，两者不得混为同一字段。日期使用 UTC 的 `YYYY-MM-DD` 且两端均包含。采集任务每批 100 场只是内部吞吐参数，不得成为前端展示上限。

`GET /v1/matches/{matchId}` 使用 `detailStatus=summary|enriched` 区分玩家比赛摘要与完整十人详情。`officialVersion` 由官方发布时间与比赛开始时间推定，`openDotaPatchId` 保留上游大版本 ID，`officialVersionSource` 必须标明推定或不可用。完整详情可以返回最终装备、背包、中立物品本体、中立强化项、技能升级序列和物品交易时间线。技能只有顺序而没有可靠等级/时间时使用 `abilityBuildStatus=ordered`；只有上游提供真实时间时使用 `timed`。物品购买或出售日志缺失时必须使用 `itemTimelineStatus=unavailable|partial`，不得从最终背包反推交易事件。

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

`GET /v1/heroes/{heroId}` 的 `abilities` 使用比赛加点事件同一 numeric ability ID，并以 Dota 2 official current-data 为规则主源。普通技能保持官方编排顺序，天赋随后按等级顺序排列；隐藏技能不得公开。`facetsStatus=active|removed|unavailable` 区分当前启用、当前版本已移除和来源不足；deprecated facet 不得作为当前 facet 展示。无法映射 numeric ID 的技能不得伪造 ID，也不得用名称字符串替代公开 ID。

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
