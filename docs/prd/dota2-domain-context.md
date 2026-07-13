# Dota 2 Domain Context

Status: research baseline, 2026-07-12

本文档记录会影响 Dodo 数据模型、指标口径和产品承诺的 Dota 2 领域事实。它不是面向玩家的游戏攻略，也不把第三方站点的展示方式视为事实来源。

## 1. Source hierarchy

按以下优先级解释冲突：

1. Valve/Dota 2 官方 datafeed、Patch 页面和 Steam Web API：当前规则、官方版本号、当前英雄/物品/技能定义和基础比赛事实。
2. OpenDota API 与 `odota/core`：公开玩家访问、标准化比赛数据和 replay 解析结果。OpenDota 是衍生数据源，不是游戏规则的最终权威。
3. 版本化的本项目 curated data：地图地点、坐标和官方接口未提供的解释性分类。必须记录来源、Patch、校验时间和覆盖边界。
4. Dotabuff、STRATZ、Max 等产品：只用于产品研究和交叉验证，不作为不可追溯事实的直接来源。

主要资料：

- [Dota 2 official patch list datafeed](https://www.dota2.com/datafeed/patchnoteslist?language=english)
- [Dota 2 official hero list datafeed](https://www.dota2.com/datafeed/herolist?language=english)
- [Dota 2 official Anti-Mage hero data example](https://www.dota2.com/datafeed/herodata?hero_id=1&language=english)
- [Dota 2 official item list datafeed](https://www.dota2.com/datafeed/itemlist?language=english)
- [Dota 2 official Blink Dagger data example](https://www.dota2.com/datafeed/itemdata?item_id=1&language=english)
- [Steamworks Web API overview](https://partner.steamgames.com/doc/webapi_overview)
- [Dota GetMatchDetails field reference](https://wiki.teamfortress.com/wiki/WebAPI/GetMatchDetails)
- [Dota GetMatchHistory field and privacy status reference](https://wiki.teamfortress.com/wiki/WebAPI/GetMatchHistory)
- [OpenDota core](https://github.com/odota/core)
- [OpenDota API documentation](https://docs.opendota.com/)

## 2. Identity model

### Player identity

- Steam Web API 使用 64-bit Steam ID 标识用户。
- Dota 比赛数据通常使用 32-bit `account_id`，也就是玩家看到的 Dota 好友码。
- `account_id` 与个人 SteamID64 可以确定性转换，但 Vanity URL 需要额外解析能力。
- 比赛中的 `account_id=0` 或缺失表示该参赛者没有向数据源公开身份；不得推断或补全。
- 通过目标玩家历史接口取得的目标账号可以保留已知身份，但不能借此恢复其他匿名玩家。

产品用语必须区分：

- `Steam ID64`：17 位 Steam 平台标识。
- `Dota Account ID / Friend ID`：Dota 32-bit 账号标识。
- `persona name`：可变化的显示名，不是稳定业务键。

### Match identity

- `match_id` 是比赛的稳定业务键。
- `match_seq_num` 表示比赛被记录的顺序，适合连续发现比赛，但不能替代 `match_id`。
- `start_time` 是 Unix 时间；`duration` 是从比赛开始计算的秒数。
- 比赛完成后的基础事实应视为不可变；后续变化通常是“数据源补齐 replay 解析结果”，而不是比赛本身变化。

### Team and player slot

- Dota 标准比赛有 Radiant 和 Dire 两队，通常各 5 名玩家。
- `player_slot` 是位编码：最高位区分 Radiant/Dire，低三位表示队内位置 0–4。
- 不能直接把数组顺序当作队伍或位置，也不能把 `player_slot` 当作账号 ID。

## 3. Version model

Dodo 需要同时保存三种不同的版本概念，不能继续只使用一个 `patch` 字段：

### Official gameplay version

官方版本是玩家理解的 `7.41`、`7.41a`、`7.41d`。官方 patch list 同时提供版本号和发布时间。

截至本次研究：

- 当前官方列表最新版本为 `7.41d`，发布时间为 2026-06-04。
- `7.41` 发布时间为 2026-03-24。
- 官方列表可以表达带字母的小版本。

### OpenDota patch ID

OpenDota 比赛中的 `patch` 是整数目录 ID。截至本次研究：

- ID `60` 对应 `7.41`。
- OpenDota 目录没有独立的 `7.41a`、`7.41b`、`7.41c`、`7.41d` ID。
- 因此 `match.patch=60` 只能证明比赛属于 7.41 大版本族，不能证明具体小版本。

### Static content snapshot

英雄、物品、技能和地图描述必须绑定一个真实的内容快照：

- `officialVersion`：抓取时检测到的官方版本。
- `contentHash`：规范化内容的稳定哈希。
- `checkedAt`：最近一次确认时间。
- `changedAt`：内容最近一次实际变化时间。
- `source`：Valve official、OpenDota 或 curated map。

当前值不能使用 `patch="unknown"` 后仍标为 complete。

### Small-patch assignment

个人比赛的小版本需要从官方版本发布时间与比赛 `start_time` 推导：

1. 找到不晚于比赛开始时间的最新官方 gameplay version。
2. 保存 `officialVersionInferred` 和推导依据。
3. 仍保留原始 `openDotaPatchId`。
4. Patch 发布时间附近或 Valve 分批部署期间标记较低置信度，不把推导值伪装成上游原始字段。

标准筛选应允许用户按 `7.41d` 查看比赛；内部仍可用 `openDotaPatchId=60` 做粗分桶和交叉校验。

## 4. Observed update cadence

基于官方 patch list 中 2024-01-01 之后的 27 个版本记录：

- 所有有编号版本之间的中位间隔约 29 天。
- 最短间隔为 3 天，最长为 91 天。
- 6 个不带字母的编号版本之间，中位间隔约 99 天，范围约 70–207 天。
- 带字母的小版本共 21 个；新大版本后数天内出现修正版本是正常情况。

这支持以下结论：

- 英雄、物品和技能完整目录不需要每 6 小时重抓。
- Patch 列表是轻量版本哨兵；它的轮询周期表达“允许更新页面晚多久”，不是 Valve 的发布周期。
- 未改变版本号的服务端 hotfix 或数据修正不能只靠 patch list 检测，因此仍需要低频内容哈希复核。

## 5. Current gameplay schema that affects the product

### Heroes

当前官方 hero data 可以提供：

- 稳定 hero ID、内部名、本地化名。
- 主属性、复杂度、攻击类型和基础属性。
- 技能、天赋、先天技能、Aghanim's Scepter/Shard 说明。
- 当前版本存在时的 facet 数据。

版本事实：

- Facets 在 7.36 时期存在。
- 官方 7.41 Patch 明确写明 `Facets removed from the game`。
- 当前官方 Anti-Mage hero data 的 `facets` 和 `facet_abilities` 为空，但仍有 innate ability。
- OpenDota `hero_abilities` 仍保留 `deprecated=true` 的历史 facets。

因此 facet 是版本化、可选的历史实体，不能被当作所有版本都有的当前英雄字段。解析器必须过滤 deprecated 数据，或明确将其保存到历史快照中。

### Abilities and talents

- `ability_id` 是比赛加点序列与百科技能之间的连接键。
- `ability_upgrades_arr` 通常只证明升级顺序，不能把数组索引直接解释为英雄等级或游戏时间。
- 隐藏技能（例如 `generic_hidden`）不能作为玩家可学习技能展示。
- 天赋文本中的 `{s:...}` 等模板 token 需要通过对应 special value 正确解析；不能直接暴露给用户。
- Innate 的等级机制会随版本变化。7.41 调整了 innate 的缩放规则，因此历史说明不能使用当前说明覆盖。

### Items

当前官方 item data 可以提供：

- item ID、内部名、本地化名、价格和品质。
- 主动/被动说明、施法距离、冷却、特殊数值。
- 合成、消耗品、商店物品和中立物品所需的分类原始数据。

需要区分：

- 普通可购买物品。
- 配方与合成结果。
- 消耗品和可叠加物品。
- 中立物品及其版本化机制。
- 已移除、隐藏或仅供内部使用的 item ability。

官方 item list 当前返回 544 条 `itemabilities`，不能直接把全部条目视作 544 个玩家可购买物品；必须建立分类和可见性质量门禁。

当前百科可见性采用同一 official snapshot 内的正向证据：推荐阶段标记或当前中立等级作为入口，递归纳入这些成品的配方组件；当前中立附魔使用官方 `item_enhancement_*` 定义；少数不进入推荐/配方图谱的独立商店物品必须经过黄金样本 allowlist 审计。`item_recipe_*`、`is_innate`、缺少本地化名称以及不在上述证据集合中的条目排除并记录原因。该规则不使用价格大于零作为可见性推断，也不运行时依赖版本落后的 STRATZ constants。

### Neutral items

7.38 官方更新重做了中立物品机制并引入用于制作独特中立物品的资源。当前 OpenDota 比赛玩家结构同时包含 `item_neutral` 与 `item_neutral2`。

真实比赛样本中可观察到：

- `item_neutral=2190` 可映射为 Dandelion Amulet。
- `item_neutral2=1592` 可映射为 Timeless。

当前 Dodo 只保存一个 `neutralItemId`，会丢失第二字段。第二字段在产品中应如何命名仍需用当前游戏 UI/官方数据进一步确认，但数据模型必须先允许两部分同时存在，不能把第二字段丢弃。

参考：[7.38 Wandering Waters official announcement](https://www.dota2.com/newsentry/737004388447420792?l=schinese)

### Map

地图不是稳定背景图片，而是版本化游戏实体。近年的大版本可能改变：

- 地图尺寸与地形。
- 河流、支流和移动机制。
- Roshan、Tormentor、Twin Gates、Watcher 等目标或地点。
- Wisdom Rune/Shrine 等资源点。
- 中立营地和高低地关系。

7.33 官方公告描述了约 40% 的地图扩张；7.38 又改变河流和 Wisdom 机制。旧版本坐标不能解释新版本 replay。

官方 Patch Notes 能证明地点或机制发生变化，但目前没有发现一个足以直接生成完整地图坐标的官方结构化 HTTP API。地图 MVP 只能选择：

- 基于可审计来源人工维护当前版本地点；或
- 从版本化游戏文件/地图资源提取，并建立坐标转换；或
- 在没有真实数据时明确返回 unavailable。

当前生产环境返回 `seed-map / seed-patch`、0 个地点，却标记为 complete。这是错误的数据质量状态，不是可接受的 MVP 地图实现。

参考：[7.33 New Frontiers official announcement](https://www.dota2.com/newsentry/5657125992547620671)

## 6. Match lifecycle and availability

### Discovery

- 玩家最近比赛接口用于发现某个公开账号的比赛。
- 一场比赛通常在结束并被上游记录后才会出现在历史中；不存在 Valve/OpenDota 提供的稳定“结束后 N 分钟必定出现”SLA。
- 30 分钟自动刷新是合理产品策略，但它是用户体验与成本决策，不是上游数据保证。

### Summary and enriched detail

- Summary 可以包含目标玩家、英雄、胜负、K/D/A、GPM/XPM 和最终装备。
- Enriched detail 应包含上游当前可用的全部参赛者，并保留解析状态。
- OpenDota 的原始数据来自 Valve WebAPI；高级事件依赖 replay 自动解析。
- replay 未解析时，购买日志、位置、视野、团战等字段可能不存在。

### Immutable and retryable states

- 已完成比赛的基础结果和最终比分应视为不可变。
- `summary -> enriched` 是允许的单向补全。
- `enriched -> summary` 是数据降级，禁止发生。
- `parse pending` 应使用带退避的重试，而不是保存为空数组并标 complete。
- 已 enriched 的比赛不需要随每次玩家刷新重复请求详情。

### Privacy and ambiguity

Steam GetMatchHistory 明确存在“用户未允许历史访问”的状态。OpenDota 空历史也可能无法区分：

- 私密历史。
- 新账号或确实没有比赛。
- 上游暂时没有该玩家记录。

因此 `Private`、`Empty` 和 `Unavailable` 不能被静默合并。只有来源明确提供证据时才能宣称 private 或 empty。

## 7. Game modes and statistical populations

Dota 具有 Ranked、Normal、Turbo、Captain's Mode、Ability Draft、赛事、机器人和历史活动模式。它们的时长、经济节奏、选人规则和物品价值不同。

必须遵守：

- 个人比赛历史可以默认展示所有已导入公开模式，但必须显示模式标签并支持筛选。
- “当前 Meta”不能把 Ranked All Pick、Turbo、赛事和 Ability Draft 混成一个总体胜率。
- 全局英雄/物品统计至少按 Patch、lobby type、game mode、rank bracket、region 和时间窗口分桶。
- 职业比赛、公开高分局和普通公开比赛是不同总体。
- OpenDota `publicMatches` 等集合具有选择偏差，不能描述为全量或无偏随机样本。

### Win rate and pick rate

- Hero win rate 的分母是该分桶内该英雄的合格选取场次。
- Pick rate 的分母依赖选人制度，必须先定义 `eligible matches`。
- Radiant/Dire、段位、模式和 Patch 是最低控制变量。

### Items

- “持有该物品时胜率”存在严重幸存者和经济领先偏差，不能解释为物品导致胜利。
- 购买率应区分最终背包、曾经购买、完整成装和组件。
- 购买时间只使用真实 purchase event；最终背包不能反推出买卖时间线。

### Matchups and synergy

- 原始 A vs B 胜率是描述性指标，不等于因果克制。
- 需要样本量、区间估计和 Patch/模式/段位/阵营分桶。
- 角色与分路若来自推断模型，必须返回推断版本和置信度。

## 8. Data availability matrix

| Capability | Preferred source | Current availability | Main limitation |
|---|---|---|---|
| Official small-patch list | Dota official datafeed | Available | 只记录有编号 Patch；无编号 hotfix 可能不可见 |
| Current hero list | Dota official datafeed | 127 heroes observed | 需要可见性和本地化规范化 |
| Current hero details | Dota official hero data | Available | 每英雄请求；HTML/token 需要安全解析 |
| Current item list | Dota official datafeed | 544 raw entries observed | 包含隐藏、配方和内部条目，不能直接公开 |
| Current item details | Dota official item data | Available | 每物品请求；描述含 HTML 和模板变量 |
| Player profile/history | OpenDota, later Steam fallback | Available for public accounts | 隐私、上游覆盖和刷新延迟 |
| Basic match facts | Valve-derived OpenDota data | Available | 不是所有字段都保证存在 |
| Parsed match events | OpenDota replay parser | Partial | 依赖 replay 可用性和解析完成度 |
| Exact sell timeline | replay event source | Not guaranteed | `purchase_log` 不证明出售日志完整 |
| Minor-patch match label | Official timestamps + match start | Inferable | Patch 发布边界有推导不确定性 |
| Current map facts | Curated/game-file extraction | Not implemented | 官方 Patch Notes 不提供完整坐标数据 |
| Historical exact encyclopedia | Versioned snapshots/game files | Not implemented | 官方 Patch Notes 是增量变更，不是完整历史快照 |

## 9. TTL and invalidation policy derived from the domain

TTL 表示允许缓存最多陈旧多久，不表示 Valve 多久更新一次。

| Data | Normal policy | Patch-watch policy | Invalidation |
|---|---|---|---|
| Player recent-match discovery | 30 minutes | unchanged | Manual refresh may bypass player TTL; per-account debounce still applies |
| Completed match summary | Indefinite after persisted | unchanged | Only replace on material source correction |
| Enriched match detail | Indefinite | unchanged | Never downgrade; retry only pending/partial details |
| Parse-pending detail | 15–60 minute backoff | unchanged | Stop after enriched or terminal unavailable |
| Official patch-list sentinel | Proposed 2 hours | 15 minutes for 48 hours after a new Patch | New official version starts patch watch |
| Hero/item/ability full catalog | Refresh on Patch event; 7-day reconciliation | Rehash after detected content changes | Official version change or content hash change |
| Official Patch detail | Immutable snapshot, recheck during first 48 hours | 15–60 minutes | Hash change records a corrected revision |
| Curated map | No periodic blind refresh | Review on major map Patch | New map version requires explicit verified snapshot |

最终数值是产品 freshness SLA，尚未冻结；但“玩家刷新触发全量静态目录刷新”应被明确禁止。

## 10. Current Dodo correctness findings

### P0

1. 当前 7.41 已移除 facets，但生产英雄页仍展示 OpenDota 中 `deprecated=true` 的旧 facets。
2. 英雄和物品响应使用 `patch="unknown"`，不应声称是版本化百科。
3. 生产地图是 `seed-map / seed-patch` 且没有真实地点，却返回 `quality=complete`。
4. 当前 Patch 筛选只使用 OpenDota major patch ID，无法实现用户期望的小版本筛选。

### P1

1. 当前物品详情可能为空，而官方 item data 已提供说明和特殊数值。
2. 当前模型丢弃 `item_neutral2`。
3. `generic_hidden` 被展示成普通技能。
4. 部分天赋文本直接暴露 `{s:...}` 模板 token。
5. 当前静态数据缓存由玩家同步触发，领域职责耦合错误。
6. 当前英雄/物品分类依赖 OpenDota constants，尚未与官方 current data 建立字段级一致性检查。

## 11. Development gates before new feature work

在恢复新功能开发前应完成：

1. 冻结 official version、OpenDota patch ID 和 static snapshot 三套版本语义。
2. 决定当前百科以 Dota official datafeed 为主源的迁移方案。
3. 将生产 `seed-map` 改为 unavailable，或交付真实可审计的当前地图快照。
4. 决定玩家页默认模式范围以及 Ranked/Turbo 的展示关系。
5. 决定小版本推导的 UI 标签和置信度表达。
6. 为英雄、物品、技能和比赛各建立一份当前版本 golden fixture。
7. 所有 current-data 页面必须显示官方版本、来源、检查时间和内容状态。

## 12. Recommended next vertical slices

按正确性优先排序：

1. `DOMAIN-011`：官方版本模型与小版本比赛归属。
2. `DATA-011`：Dota official hero/item/ability provider 与可见性门禁。
3. `API-011`：版本化静态 snapshot，移除 `unknown` 与 deprecated facets。
4. `MAP-011`：seed map 纠正为 unavailable，并制定真实地图采集方案。
5. `MATCH-011`：保留第二中立字段、模式/lobby 字典和显示标签。
6. `CACHE-011`：玩家 30 分钟刷新、Patch 哨兵和事件驱动目录失效。

在这些问题解决前，不继续开发全局英雄胜率、物品胜率、克制关系或热图。
