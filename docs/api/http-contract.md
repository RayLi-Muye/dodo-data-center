# HTTP Contract v1

所有 ID 在 JSON 和 URL 中均为字符串。成功响应使用 `{ data, meta }`；失败响应使用 `{ error, meta? }`。

## Player

```http
POST /v1/account-resolutions
POST /v1/players/{accountId}/sync
GET  /v1/sync-jobs/{jobId}
GET  /v1/players/{accountId}
GET  /v1/players/{accountId}/matches?cursor=&limit=&heroId=
GET  /v1/players/{accountId}/heroes?window=last_20|last_50|last_100|all_imported
GET  /v1/players/{accountId}/heroes/{heroId}?window=last_100
GET  /v1/matches/{matchId}
```

`POST /sync` 返回 `202` 和 `jobId`，不得让 HTTP 请求等待全量同步。

`POST /account-resolutions` 接收判别联合 `{ kind, value }`，其中 `kind` 为 `account_id`、`steam_id64` 或 `steam_profile_url`。成功后返回 canonical `accountId`。首版只支持 `/profiles/<steamid64>` URL；vanity URL 返回 `UNSUPPORTED_ACCOUNT_REFERENCE`，Web 不自行解析。

默认窗口：玩家概览、英雄列表和玩家英雄详情均为 `last_100`。最近 N 场先按 `startTime DESC, id DESC` 稳定排序后截取。所有时间均为 UTC ISO-8601（`Z` 后缀）。

## Outcome rules

- `public_complete`、`public_partial`：HTTP 200 成功响应；partial 必须带实际数据和 `quality=partial`。
- `history_private`、`profile_private`：玩家统计请求返回 HTTP 403 和对应错误码，不返回空统计；异步同步任务可将其作为终态。
- `source_rate_limited`：直接请求返回 HTTP 429；异步任务记录为可重试状态。
- `source_unavailable`：直接请求返回 HTTP 503；异步任务记录为可重试状态。
- `failed`：直接请求返回 HTTP 500；任务保留可诊断错误码。
- `not_found`：HTTP 404。
- 单场比赛的 `parse_pending` 仅限制 replay 派生能力，基础比赛详情仍可成功返回并明确 parse 状态。
- 玩家同步若因所有候选比赛缺少核心字段而进入 `parse_pending`，玩家统计请求返回 HTTP 409 `PARSE_PENDING`，不得返回 200 空统计；同步任务将同名错误码写入 `errorCode`。

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
SYNC_IN_PROGRESS
VALIDATION_ERROR
INTERNAL_ERROR
```

错误响应可以携带轻量 `meta`，只用于来源、时间、请求状态和 retry 信息，不伪造统计样本字段。
