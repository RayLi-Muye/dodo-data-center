# Agent Workboard

## State machine

`READY -> RUNNING -> REVIEW -> ACCEPTED`

`RUNNING -> BLOCKED` 仅在有具体证据和最小所需决策时使用。Root 是唯一能将任务标记为 `ACCEPTED` 的角色。

## Active wave

### Wave 13: Hero and item encyclopedia foundation

地图真实快照 `MAP-016B` 按产品决定暂缓；生产继续返回 `MAP_UNAVAILABLE`，不得用 seed、推断坐标或旧版数据替代。当前波只交付英雄/物品静态百科第一阶段，动态比赛聚合另开后续波次。

| Task | Owner | Scope | Depends on | State |
|---|---|---|---|---|
| ROOT-017 static encyclopedia contracts | Root | `packages/contracts/**`、PRD、API 与编排文档 | Wave 12 | ACCEPTED |
| DATA-017 official effect fields | Data Source Agent | `packages/dota-data/**`；技能结构化数值、实体 ID 与黄金 fixtures | ROOT-017 | ACCEPTED |
| API-017 entity update history | Backend/API Agent | `apps/api/**`、`packages/db/**`；最近更新筛选与状态语义 | ROOT-017 | ACCEPTED |
| WEB-017 hero/item reference pages | Web Agent | `apps/web/**`、`packages/ui/**`；基础资料、效果、最近更新、390px | ROOT-017, DATA-017, API-017 | ACCEPTED |
| QA-017 static encyclopedia acceptance | QA Agent | 只读；当前版本、字段完整度、partial/unavailable 与视觉回归 | DATA-017, API-017, WEB-017 | ACCEPTED |
| DEPLOY-017 overseas rollout | Root | 全仓门禁、真实数据、Railway/Vercel、生产 smoke | QA-017 | RUNNING |

验收目标：

- 英雄页展示当前官方版本、基础属性、定位、技能文本与官方结构化技能数值。
- 物品页展示当前官方版本、价格、类别、主动/被动效果数值和合成组件。
- 两类详情页展示最近 5 个已同步官方版本内的直接实体变更，保留版本、日期与官方链接。
- 更新目录 partial 时不得把空结果描述为“没有改动”；字段缺失不得从比赛数据推断。
- 390px 竖屏无横向溢出，完整/空/partial/unavailable 都有明确状态。

本地证据：官方 `special_values` 及魔法/生命/金币消耗、冷却、施法距离、前摇、持续施法、持续时间、伤害数组已结构化；全零占位不展示。英雄/物品实体更新只从持久化 release 过滤，不运行时直查上游。一次性迁移只将既有 official hero/item snapshot 的 `checkedAt` 标为过期，保留旧行直至刷新事务原子替换。全仓 typecheck、350 项常规测试、生产 build、43 项 schema 检查与真实 PostgreSQL 37/37 通过；QA P0/P1/P2 均为 0。当前浏览器运行时不可用，390px 已完成 CSS/源码审计但仍需在可用浏览器中补实际视觉 smoke。

### Wave 12: Five-stage MVP hardening

| Task | Owner | Scope | Depends on | State |
|---|---|---|---|---|
| DATA-012 OpenDota bounded retry | Data Source Agent | `packages/dota-data/**` | Wave 11 | ACCEPTED |
| API-012 sync coalescing and idempotency audit | Backend/API Agent | `apps/api/**`, `packages/db/**` | DATA-012 | ACCEPTED |
| QA-012 phase 1 reliability gate | QA Agent | read-only | DATA-012, API-012 | ACCEPTED |
| ROOT-012 main and automatic deployment baseline | Root | GitHub PR、Railway source、release evidence | QA-012 | ACCEPTED |
| DATA-013 STRATZ server access | Root / Data Source Agent | 上游授权或允许的运行出口 | API-012 | ACCEPTED |
| DATA-014 encyclopedia correctness | Data Source / Backend / Web Agents | 官方简中、legacy rows、天赋与字段 | DATA-013 may run in parallel | ACCEPTED |
| API-WEB-015 match detail completion | API / Web Agents | 时间线、来源、回填状态 | DATA-013, DATA-014 | ACCEPTED |
| MAP-016A audited static map foundation | Root / Data / API / Web Agents | 严格 geometry、审计哈希、原子存储与 honest UI | DATA-014 | ACCEPTED |
| MAP-016C conservative official-version invalidation | Root / Data / API Agents | latest raw Patch 与 current map 复核门禁 | MAP-016A | ACCEPTED |
| MAP-016B lawful current map snapshot | Root / Data Agents | 当前 App 570 地图快照与 manifest/resource 监测 | MAP-016A、MAP-016C、合法来源与下载授权 | BLOCKED |

### Wave 12 phase 2 checkpoint

- 同一 STRATZ token 在本地可读取已知公开比赛，但 Railway Singapore 返回 HTTP 403 / GraphQL `AUTHENTICATION: forbidden`；该差异按服务器访问授权问题处理，不解释为比赛不存在或玩家隐私。
- 不采用代理或更换出口绕过。Dodo 将申请/确认面向网站服务端的 Individual token，并在申请中明确 Railway 运行环境。
- 等待外部授权期间，OpenDota 继续作为完整 MVP 基线；STRATZ 只负责可选的带时间加点与购买事件增强。
- 第 2 阶段的内部门禁是错误分类、无损降级、来源归属、密钥边界和测试；真实 Railway 增强是外部授权门禁，不阻断 DATA-014。
- 第 2 阶段只承诺 opportunistic secondary enrichment；已落库但 partial 的 STRATZ 结果如何再次回填，归入 API-WEB-015，不以 `enrichmentSources` 误称完整。
- Railway 部署后真实账号 `224328273` 手动同步在约 5 秒内完成 `public_complete`，STRATZ health 于 `2026-07-13T02:59:58Z` 更新为 ready；最近 5 场全部同时标注 OpenDota/STRATZ，分别具有 66–156 个 timed ability events 与 246–416 个 item events。此前外部授权门禁已解除。

### Wave 12 phase 3 baseline

- 生产目录当前有 127 个英雄，全部为 7.41d；物品共有 518 行，其中 501 行为 7.41d、17 行 `officialVersion=null`。这 17 行不能整体盲删：仍在官方 index 但详情暂时失败的条目要保留，已移除或被官方标为无本地化名的 legacy 行应清理。
- 英雄、技能、物品与更新正文改用 Dota 2 official `schinese`；内部 ID、name、版本与数值字段不随语言改变。
- 有合法 ID 与本地化名称但说明模板未解析的技能、天赋或物品保留实体，说明保持空缺并把 snapshot 标为 partial；不得把原始模板或猜测数值直接展示给用户。
- 英雄详情扩展官方简中 `hype`、`biography`、`complexity` 与 `baseStats`；旧 JSONB 读取使用空值兼容，不从比赛或第三方推断规则数值。
- partial refresh 的 repository merge 必须基于本轮官方 universe 剪枝，而不是永久保留所有历史行；当前详情请求失败但仍在 universe 的旧记录继续保留。

### Wave 12 phase 3 local evidence

- 真实 Dota 2 official 冒烟：当前版本 7.41d、127 个英雄、507 个可展示物品；敌法师与闪烁匕首返回简中名称，7.41d/7.41c 更新正文返回简中。
- 6 个物品说明与 876 个英雄技能/天赋说明仍含上游模板缺口；实体被保留、说明置空、snapshot 明确为 partial，原始模板不会进入公开字段。
- 以生产基线 518 个物品计算，下一次对账会保留 507 个当前可展示实体并清理 11 个 removed/无本地化 legacy 行；该删除仍需部署后的只读计数复核。
- hero/item universe 由成功实体与当前 detail-failed ID 构成；filtered 与官方 index 外 ID 被剪枝，Memory/PostgreSQL 在同一替换操作中保持一致，重复 partial 刷新幂等。
- 官方 7.41d 全量英雄冒烟严格解析 127/127；敌法师返回简中玩法简介、398 字背景、复杂度 1 和完整基础属性，没有使用回退推断。
- 全仓 typecheck、生产 build、302 项常规测试、41 项 schema 检查与真实 PostgreSQL 29/29 通过；最终 QA 和海外部署待完成。
- 390×844 本地真实页面验证英雄资料默认为单列，页面与 body `scrollWidth=390`；英雄头图、玩法/背景、基础属性、技能与命石均可访问，无浏览器 console error/warning。
- 最终窄 QA 对新字段默认值、数值单位、API/Web 空值处理与 failed-universe 剪枝复核 PASS，P0/P1/P2 均为 0；海外预览与生产目录计数仍待部署后验收。
- Vercel main 部署 `web-g5pdrty2a-rays-projects-f956e95b.vercel.app` ready；Railway deployment `2d8a6994-c96f-4c0a-8bcd-a22b3268e686` success。
- 生产对账为 127 个 7.41d 英雄、507 个 7.41d 物品、0 个 stale item；敌法师简中简介/背景/复杂度/基础属性与 7.41d 简中更新正文可读。账号 `224328273` 最近 20 场仍返回 200、`sampleSize=20`、quality complete。
- 已知运维缺口：本次 main merge 未自动创建 Railway deployment，使用已合并同内容的受控 CLI deployment 完成发布；GitHub→Railway webhook/branch trigger 必须在下一运维切片修复，不能把手动发布当长期机制。

### Wave 12 phase 4 local evidence

- `stratzEnrichment` 持久状态与 `enrichmentSources` 来源归属分离；完整、计划重试、终止部分/失败和 provider blocked 均可区分，partial/empty 上游响应不会删除已有事件。
- 玩家页可选择最近 20 场或全部已导入比赛；每次 POST 只处理下一批最多 20 场，前端只轮询当前批次，绝不自动扫描上游全历史。单场比赛另有手动增强入口。
- OpenDota summary 先补成十人详情，再按状态尝试 STRATZ；同场和同账号 scope 在单实例内合并。OpenDota 限流或不可用立即停止当前批次，单场错误跳过，数据库/合并异常进入实际错误日志且不伪装为空数据。
- 本地玩家与单场交互验证通过：scope 切换有效、桌面无横向溢出；增强服务不可用时明确保留已有数据。部署前门禁包括全仓 typecheck、336 项常规测试、生产 build、41 项 schema 检查和真实 PostgreSQL 30/30；最终 QA P0/P1/P2 为 0。
- PR #5 与文案修正 PR #6 均通过 GitHub verify 和 Vercel Preview 后合并。Railway deployment `efa6be62-bb92-4426-937a-9738b61d74ba` success；Vercel production `web-e7ewntqqr-rays-projects-f956e95b.vercel.app` ready。
- Vercel Production 原先缺少 `API_BASE_URL`，导致主站无法连接 Railway；已补为生产 API 并重新部署。账号 `224328273` 的玩家页、增强控件与单场接口恢复可读，浏览器无 error/warning、桌面无横向溢出。
- 真实最近 20 场首批结束后：20 场详情均 ready，1 场 STRATZ complete、19 场因 partial response 计划重试、0 terminal/blocked/not-requested；立即再次 POST 不增加 attempt。赛事 `8894132397` 仍保留 timed ability 与 partial purchase timeline，来源为 OpenDota/STRATZ。
- 生产文案不再把计划重试误称为完成：显示“19 场已计划重试，尚未到再次请求时间”，按钮禁用为“等待计划重试”。最终 QA P0/P1/P2 均为 0，API-WEB-015 接受。

### Wave 12 phase 5 source gate

- Dota 2 official 7.41/7.41d 只能证明地图机制和相对变化，不提供机器可读坐标。`dotaconstants` 无地图坐标；已审计的 GameTracking mirror 无明确许可证且不含当前主地图实例，不能作为可直接发布的数据集。
- 本机 Steam library 没有 App 570 安装或 manifest。未获用户授权前不下载大体积 depot；未完成用途许可审查前不复制 minimap 或游戏资源。生产继续正确返回 `MAP_UNAVAILABLE`。
- Phase 5 先交付严格 geometry、来源 revision/hash、coverage/exclusion、幂等原子存储和 honest API/Web 状态。真实 current snapshot 只有在合法 App 570 build/depot/resource 提取与双重审计后才可设为 current。
- Coverage 契约要求全部 13 种已知地点类型恰好归入 included 或 exclusions；`complete` 必须全部纳入，`partial` 必须逐项说明遗漏，测试 fixture 不得伪装为完整地图。
- 官方 patch 索引刷新成功后，只要最新 raw 官方版本与 curated map 的已验证 `patch` 不同就原子撤销 current；历史行与审计 snapshot 保留，seed 豁免，重复执行幂等，官方请求失败不作为失效证据。该保守策略表示“需要重新验证”，不声称地图确实改变。
- 不受展示格式支持的新 hotfix 仍从公开 Patch 列表排除并将目录标为 partial，但会作为 `officialVersion` 触发上述失效。无 patch note 的 build-only hotfix 仍需未来 App 570 manifest/resource hash 监测；该能力与真实快照使用同一外部来源门禁。
- MAP-016C 本地门禁通过：全仓 typecheck、366 项常规测试、生产 build、43 项 schema 检查与真实 PostgreSQL 37/37；最终 QA P0/P1/P2 代码问题均为 0。剩余激活阻塞只有合法 App 570 快照与 build/depot manifest/resource-hash 监测。
- PR #10 的 GitHub verify 与 Vercel Preview 通过后合并。Railway deployment `11d386b1-7c3b-4ba8-acb8-b24f9fc971f4` success；Vercel production `web-h66l7xkxs-rays-projects-f956e95b.vercel.app` ready。生产 readiness 200、最新 Patch 7.41d、地图继续 503 `MAP_UNAVAILABLE`；账号 `224328273` 的 100 场 complete 统计仍为 200 且来源保留 OpenDota/STRATZ。MAP-016C 接受。
- MAP-016A 最终本地门禁通过：全仓 typecheck、358 项常规测试、生产 build、43 项 schema 检查及真实 PostgreSQL 35/35；修复后 QA P0/P1 均为 0。浏览器确认 seed 页面明确显示 `PARTIAL`、11 类逐项排除与 test-only 来源，console 无 error/warning。
- PR #8 的 GitHub verify 与 Vercel Preview 均通过后合并。Railway deployment `df59f6fa-270f-4d8c-829b-4ea331dcd023` success；Vercel production `web-n3mqu73ov-rays-projects-f956e95b.vercel.app` ready。
- 生产 API readiness 为 200，`/v1/maps/current` 明确返回 503 `MAP_UNAVAILABLE`；生产地图页显示“当前地图资料不可用”且说明不会用示例数据冒充。账号 `224328273` 仍可读取已导入比赛、100 场统计与英雄分布，地图页和账号页浏览器 console 均无 error/warning。MAP-016A 接受，MAP-016B 保持外部来源阻塞。

### Wave 12 phase 1 evidence

- OpenDota network、timeout、429 与 5xx 只执行一次有界重试；404、隐私与无效 payload 不重试，`Retry-After` 等待最多 10 秒。
- automatic/manual 请求语义从 Web、BFF 到 API 全链路传递；30 分钟内 automatic 返回既有终态，manual 仍启动强制刷新。
- 已有成功快照后的瞬时失败继续返回旧 overview/matches，并以 partial/stale、job、failure 与 provider health 表达；Private、History Private 与 Not Found 立即阻断旧数据。
- 同账号单进程请求合并；相同比赛内容不推进 `dodo.matches.imported_at/updated_at`。多实例 lease 留待扩容前实现，当前生产继续固定单实例。
- 全仓 typecheck、248 项常规测试、生产 build、41 项 schema 检查和专用 PostgreSQL 27/27 通过；QA P0/P1 为 0。
- GitHub Actions `verify` 与 Vercel Preview 首次真实运行成功；Railway deployment `5c44d337-d1e9-4b8a-a58f-2eb60b56eb75` ready。
- 真实账号 `224328273` 验证：瞬时失败后旧 20 场仍返回 200/stale；随后 manual 恢复 `public_complete`；fresh automatic 不调用上游并返回既有完成时间，manual 再次强制同步成功。

| Task | Owner | Paths | Depends on | State |
|---|---|---|---|---|
| ROOT-001 contracts and docs | Root | Root-only paths | none | ACCEPTED |
| DATA-001 provider and golden fixtures | Data Source Agent | `packages/dota-data/**` | ROOT-001 | ACCEPTED |
| API-001 deterministic seed API | Backend/API Agent | `apps/api/**`, `packages/db/**` | ROOT-001 | ACCEPTED |
| WEB-001 contract-driven shell | Web Agent | `apps/web/**`, `packages/ui/**` | ROOT-001, design context | ACCEPTED |
| QA-001 MVP review | QA Agent | read-only | Wave 1 integration | ACCEPTED |

## Next wave

| Task | Owner | Scope | Depends on | State |
|---|---|---|---|---|
| API-002 real sync and quality persistence | Backend/API Agent | 接入 `@dodo/dota-data` provider；持久化批次/比赛质量、排除原因与重试状态；从真实元数据生成 API meta | DATA-001, API-001 | ACCEPTED |
| WEB-001 contract-driven shell | Web Agent | 账号、玩家、比赛、英雄、物品、地图与状态页面 | design context, API-001 | ACCEPTED |
| WEB-QA responsive visual review | QA Agent | 390px 竖屏、数据状态、链接语义、图片与生产路由验证 | WEB-001 | ACCEPTED |

## Wave 2 evidence

- 全仓 `pnpm typecheck`、`pnpm test`、`pnpm build` 通过。
- 共 80 项测试通过：Web 16、DB 5、Data 31、API 28。
- 生产模式验证首页、玩家、比赛、英雄、物品、地图共 8 个页面路由，均返回 HTTP 200。
- BFF 账号解析返回 200，同步启动返回 202，非法输入返回 400。
- OpenDota 无 Key 公开账号同步最近 100 个候选，最终状态为 `public_complete`，20/50/100 窗口均精确覆盖。

## Worker completion report

```text
DONE
- Task:
- Changed files:
- Behavior:
- Tests and exact results:
- Live proof:
- CONTRACT_CHANGE_REQUEST:
- Risks / remaining work:
```

## Wave 3: Supabase persistence

| Task | Owner | Scope | Depends on | State |
|---|---|---|---|---|
| ROOT-003 persistence ADR and dependencies | Root | ADR、环境契约、锁文件、验收 | Wave 2 | ACCEPTED |
| INFRA-003 local Supabase and migrations | Infra Agent | `supabase/**` | ROOT-003 | ACCEPTED |
| API-003 asynchronous PostgreSQL repository | Backend/API Agent | `apps/api/**`, `packages/db/**` | ROOT-003, INFRA-003 schema | ACCEPTED |
| QA-003 persistence parity and restart audit | QA Agent | read-only | INFRA-003, API-003 | ACCEPTED |

## Wave 3 evidence

- `pnpm install --frozen-lockfile`、全仓 `pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过。
- 常规测试 83 项通过；专用 `dodo_test` PostgreSQL 集成套件 8 项通过。
- 初始 migration 在空白 PostgreSQL 17 数据库真实执行成功，创建 11 张表；静态 schema 33 项断言通过。
- 并发同账号窗口替换、共享比赛引用、英雄/物品目录原子刷新、仓储关闭后重连读取均通过真实数据库验证。
- 测试清库要求数据库名包含 `test` 且 `DODO_ALLOW_TEST_DB_RESET=1`，两种不安全配置均在连接前拒绝。
- 无 Key OpenDota 公开账号同步 100 场为 `public_complete`，`sampleSize=100`、`eligibleCount=100`、`coverageRate=1`。
- API 关闭并启动新进程后，玩家 100 场比赛、同步任务和批次仍可完整查询。
- QA 最终窄复核 PASS，无 P0/P1。

## Wave 4: Repository publication and hosted Supabase

| Task | Owner | Scope | Depends on | State |
|---|---|---|---|---|
| GH-004 publish repository | Root | Public GitHub repository、README、initial commit | Wave 3 | ACCEPTED |
| INFRA-004 hosted Supabase | Root | Create、link、migrate、seed、read-only verification | Wave 3 | ACCEPTED |

## Wave 4 evidence

- 公开 GitHub 仓库 `RayLi-Muye/dodo-data-center` 已创建，`main` 为默认分支。
- 面向用户的 README 已覆盖产品目的、已实现能力、边界、架构、快速开始、Supabase、测试和隐私说明。
- 独立 Supabase Nano 项目 `dodo-data-center` 已在东京区域创建并关联；未复用或修改账号中的其他项目。
- Dry-run 只包含 `20260711000100_initial_persistence.sql` 和无个人数据的 `supabase/seed.sql`，随后均成功推送。
- 远端 migration history 与本地一致；只读验证为 11 张 `dodo` 表、1 条 current map，`anon`/`authenticated` schema usage 均为 false。
- Fastify 通过 Supavisor session connection 启动成功，并从云端 PostgreSQL 读取 current map。
- 数据库随机密码仅保存于本机 Keychain，未写入 Git、README、环境模板或日志。

## Wave 5: Overseas deployment readiness

| Task | Owner | Scope | Depends on | State |
|---|---|---|---|---|
| ROOT-005 deployment ADR and release gates | Root | ADR、shared config、cloud auth、acceptance | Wave 4 | ACCEPTED |
| API-005 production lifecycle and health | Backend/API Agent | `apps/api/**` | ROOT-005 | ACCEPTED |
| INFRA-005 Fly and container configuration | Infra Agent | `infra/**` | ROOT-005, API-005 health contract | ACCEPTED |
| WEB-005 Vercel runtime readiness | Web Agent | `apps/web/**` | ROOT-005 | ACCEPTED |
| QA-005 deployment security and smoke audit | QA Agent | read-only | API-005, INFRA-005, WEB-005 | ACCEPTED |

## Wave 5 evidence

- API 新增独立 liveness/readiness，并在 repository 失败时返回无敏感信息的 503。
- SIGTERM/SIGINT 关闭处理幂等，沿既有 `onClose` 顺序等待同步任务后再关闭 repository。
- Fly 配置固定东京 `nrt`、单实例、120 秒关闭窗口、关闭 auto-stop，并使用 readiness health check。
- API 镜像使用 Node 22、非 root 用户、frozen pnpm install，并固定官方基础镜像 digest。
- Web 动态页面与 BFF 均标记东京 `hnd1`；浏览器运行时字体全部为本地 WOFF2，不访问 Google Fonts。
- 生产缺少 `API_BASE_URL` 时不再静默回退 localhost；客户端 bundle 未发现数据库或 OpenDota 凭据。
- 全仓 typecheck、生产 build、90 项常规测试通过；QA 无 P0/P1。
- 本机缺少 Docker，真实镜像构建留待远端 builder；Fly API 在当前网络发生 TLS handshake timeout。

## Wave 6: Preview deployment

| Task | Owner | Scope | Depends on | State |
|---|---|---|---|---|
| DEPLOY-006 API and Web preview | Root | cloud login、secrets、deploy、smoke、rollback record | Wave 5 | ACCEPTED |

## Wave 6 evidence

- Railway Singapore 单实例 API 部署成功，`/health/live` 与 `/health/ready` 均返回 200。
- Railway API 使用 Supabase Tokyo session pooler，数据库凭据只存在于服务端变量中。
- 公开账号 `86745912` 完成端到端同步，任务状态为 `public_complete`；玩家接口返回 200、100 场合格样本和 35 个英雄统计。
- Vercel `codex/deploy-preview` 分支预览构建状态为 `READY`，分支级 `API_BASE_URL` 指向 Railway API；SSO 预览保护已关闭。
- 浏览器从公开 Vercel 页面通过 BFF 读取该账号、英雄分布和比赛明细；Railway API 重部署后玩家数据仍可查询。
- Fly Tokyo 在当前网络下 TLS 握手超时，因此作为可迁移备选保留；MVP 预览采用 Railway Singapore。
- 当前为海外预览，不含自定义域名、大陆部署、ICP备案或多 API 副本。

## Wave 8: Enriched match details

| Task | Owner | Scope | Depends on | State |
|---|---|---|---|---|
| ROOT-008 match detail contracts and metric semantics | Root | contracts、PRD、API、metrics | Wave 7 | ACCEPTED |
| DATA-008 OpenDota detail normalization | Data Source Agent | `packages/dota-data/**` | ROOT-008 | ACCEPTED |
| API-008 recent-20 enrichment and persistence | Backend/API Agent | `apps/api/**`, `packages/db/**` | ROOT-008, DATA-008 | ACCEPTED |
| WEB-008 ten-player scoreboard and timelines | Web Agent | `apps/web/**` | ROOT-008 | ACCEPTED |
| QA-008 live enriched-match acceptance | Root / QA Agent | read-only | DATA-008, API-008, WEB-008 | ACCEPTED |
| DEPLOY-008 Railway and Vercel preview | Root | commit、deploy、smoke | QA-008 | ACCEPTED |

## Wave 8 local evidence

- 最近 20 场仅补齐尚未 enriched 的比赛，详情请求并发上限为 2；单场失败保留 summary。
- 完整详情包含上游可用的十人阵容、等级、GPM/XPM、补反、伤害、最终/背包/中立装备和比分。
- `ability_upgrades_arr` 只生成有证据的加点顺序；缺少真实等级或时间时保持为空。
- 物品时间线只使用真实 `purchase_log`；未知物品事件降级为 partial，出售事件不推断。
- Memory/PostgreSQL 按 player slot 合并，并在上游匿名详情中保留摘要已知 account ID，避免重复成 11 人。
- 全仓 typecheck、生产 build 和 104 项常规测试通过；3 项专用 PostgreSQL 测试按设计跳过。
- 旧 Supabase JSONB 通过读取时默认值兼容新契约；部署探针确认玩家接口由 500 恢复为 200，旧100场数据保留。
- 账号 `224328273` 最近20场全部达到 enriched、完整十人、已知 Patch/Region；200名参赛者的 GPM/XPM/补刀/伤害/加点覆盖率均为100%。
- 最终装备覆盖198/200；真实购买时间线覆盖110/200，其他记录明确标记 unavailable；出售事件仍不推断。
- Vercel `017531d` 与 Railway `ff71df82-010a-4002-8567-d6127734bf49` 均成功；浏览器确认真实比赛页包含10行玩家、双方完整阵容、技能加点、物品时间线和69个装备图标。

## Wave 9: Patch filtering foundation

| Task | Owner | Scope | Depends on | State |
|---|---|---|---|---|
| ROOT-009 patch/filter contracts and migration | Root | contracts、docs、Supabase migration | Wave 8 | ACCEPTED |
| DATA-009 OpenDota patch catalog | Data Source Agent | `packages/dota-data/**` | ROOT-009 | ACCEPTED |
| API-009 patch persistence and combined filters | Backend/API Agent | `apps/api/**`, `packages/db/**` | ROOT-009, DATA-009 | ACCEPTED |
| WEB-009 player filters and Update tab | Root | `apps/web/**` | API-009 | ACCEPTED |
| DEPLOY-009 patch migration and live smoke | Root | Supabase、Railway、Vercel | ROOT-009, API-009, WEB-009 | ACCEPTED |

## Wave 9 local evidence

- OpenDota `constants/patch` 真实冒烟返回 61 个版本，按发布时间和数值 ID 稳定排序。
- Overview、比赛、英雄列表与玩家英雄详情统一执行“先 Patch、再 recent N”，并支持 `all_imported`。
- `GET /v1/patches` 使用游标分页和最新版本优先；玩家 URL 保留 `window` 与 `patch`。
- “更新”主导航和 Patch 时间线已加入；本波只交付版本目录，改动正文属于下一纵切。
- 静态数据库35项断言、全仓 typecheck、生产 build 和113项常规测试通过；3项专用 PostgreSQL 测试按设计跳过。
- Supabase migration `20260712000100_patch_catalog` 已应用；Railway `7a8e11cf-4db8-4c43-926d-ccc387de1c2f` 与 Vercel `c5daf87` 均成功。
- 线上 Patch 目录返回61项，最新为 `7.41 / id 60`；账号 `224328273` 的 `last_20 + patch=60` 返回20场且版本集合仅为60。
- 浏览器确认“更新”导航、61行 Patch 时间线、7.41选中状态、20场样本和版本筛选URL持久化均正常。
- Patch 页面改为动态读取，避免构建时空目录缓存一小时。

## Wave 7: Player refresh experience

| Task | Owner | Scope | Depends on | State |
|---|---|---|---|---|
| WEB-006 manual and automatic player refresh | Web Agent | `apps/web/**` | Wave 6 | ACCEPTED |
| QA-006 sync workflow audit | QA Agent | read-only | WEB-006 | ACCEPTED |
| DEPLOY-007 refreshed Web preview | Root | commit、preview deploy、live smoke | WEB-006, QA-006 | ACCEPTED |

## Wave 7 evidence

- 玩家页提供手动刷新；数据超过 15 分钟时进入页面会自动后台同步，新鲜数据不重复请求。
- 首次账号查询等待同步任务到达终态后才导航，消除 202 后提前显示“记录不存在”的竞态。
- 同步轮询具有 8 秒单请求超时、180 秒总预算、75 次轮询上限和卸载取消机制。
- 隐私、限流、上游不可用、解析等待与失败均显示独立状态，不会退化为空数据或错误导航。
- 全仓 typecheck、生产 build 和 95 项常规测试通过；3 项专用测试数据库集成测试按设计跳过。
- QA-006 无 P0/P1/P2，未发现客户端凭据或自动更新循环。
- Vercel commit `b7adbb8` 预览为 `READY`；公开账号 `224328273` 进入页面后自动触发刷新，旧数据在同步期间保持可见。
- 首次自动刷新正确呈现 `source_unavailable` 且未清空旧数据；随后手动刷新恢复为 `public_complete`，验证了强制重试和轮询终态。

## Wave 10: Incremental synchronization and snapshot cache

| Task | Owner | Scope | Depends on | State |
|---|---|---|---|---|
| ROOT-010 cache semantics and ADR | Root | PostgreSQL 快照 TTL、内容哈希、增量写入语义 | Wave 9 | ACCEPTED |
| API-010 incremental player sync | Backend/API Agent | `apps/api/**`, `packages/db/**` | ROOT-010 | ACCEPTED |
| QA-010 concurrency and live performance audit | Root / QA Agent | read-only | API-010 | ACCEPTED |
| DEPLOY-010 Railway API rollout | Root | commit、deploy、真实账号连续同步 | QA-010 | ACCEPTED |

## Wave 10 evidence

- PostgreSQL 继续作为事实来源；本波不引入 Redis。英雄、物品和 Patch 快照 TTL 为 6 小时，官方更新 TTL 为 30 分钟。
- 快照使用稳定 SHA-256 内容哈希区分“已检查但未变化”和“内容已变化”；CAS touch 与目录替换共用 advisory lock，避免旧检查覆盖新快照。
- 最近比赛只写入新增或内容发生变化的记录；空差异不启动比赛写事务，目录和比赛批量写入改为 set-based SQL。
- 多账号共享比赛按全局排序获取 advisory lock；重复 match ID 在写入前合并，enriched 详情不会被 summary 降级，所有已知账号关联均保留。
- 全仓 typecheck、Web 生产 build、164 项常规测试与 17 项真实 PostgreSQL 测试通过，共 170 项不重复测试。
- Railway 部署 `cf06f58d-09d9-4929-8f6f-4ffc40fababc` 成功，健康检查为 ready。
- 公开账号 `224328273` 连续两次同步均为 `public_complete`：第一轮 7.268 秒，第二轮 5.617 秒；此前重复同步基线约 113.55 秒。
- 同步后 100 场统计 `coverageRate=1`；英雄、物品、更新与最新比赛接口均为 200，最新比赛详情保留 10 名玩家。

## Wave 11: Dota domain review

| Task | Owner | Scope | Depends on | State |
|---|---|---|---|---|
| ROOT-011 Dota domain and source audit | Root | 版本、英雄、物品、比赛、地图、数据可得性与 TTL 语义 | Wave 10 | ACCEPTED |
| DOMAIN-011 product semantics confirmation | Root / Product owner | 模式默认值、小版本归属、历史百科和地图范围 | ROOT-011 | ACCEPTED |
| DATA-011 official current-data provider | Data Source Agent | `packages/dota-data/**` | DOMAIN-011 | ACCEPTED |
| API-011 static catalog ownership and version semantics | Backend/API Agent | `apps/api/**`, `packages/db/**` | DATA-011 | ACCEPTED |
| WEB-011 data-quality and game-population UI | Web Agent | `apps/web/**`, `packages/ui/**` | API-011 | ACCEPTED |
| QA-011 Dota correctness gate | QA Agent | read-only | API-011, WEB-011 | ACCEPTED |

## Wave 11 evidence

- 官方 patch list、hero/item/ability datafeed、Steam match fields、OpenDota current constants 与真实比赛响应已完成交叉审计。
- 2024 年以来官方列表有 27 个版本记录，全部版本中位间隔约 29 天；不带字母的编号版本中位间隔约 99 天。
- OpenDota `patch=60` 只能表达 7.41 大版本族；具体 7.41a–d 需要用官方发布时间与比赛开始时间推导并标记来源。
- 7.41 已移除 facets，但生产英雄页仍展示 deprecated facets；当前英雄/物品版本为 unknown。
- 真实比赛存在 `item_neutral` 与 `item_neutral2`，当前 canonical 模型只保留前者。
- 生产地图仍为无真实地点的 seed map，却标记 complete；新功能开发暂停，等待领域口径确认与正确性修复。
- 产品已确认所有已导入公开模式作为个人历史默认范围，并提供独立的 Ranked/Normal lobby 与 Turbo game-mode 筛选。
- 静态规则数据迁移到 Dota 2 official current-data；玩家同步与静态目录刷新解耦，官方 Patch 哨兵 2 小时检查、完整目录按版本事件或 7 天哈希复核。
- 地图 seed 已从 seed 与迁移中移除；在交付可审计 geometry 前接口必须返回 `MAP_UNAVAILABLE`。
- Live 官方验证为 7.41d、127 个英雄和 501 个成功解析的物品定义；英雄与物品快照按未安全解析的模板/条目诚实标记 partial，物品可购买性统一为 unverified。
- 公开账号 `224328273` 的 100 场导入、7.41d 时间推定、Ranked lobby 筛选、十人详情和第二中立强化字段均完成 API 与浏览器对账。
- 全仓 typecheck、生产 build、190 项常规测试、24 项真实 PostgreSQL 测试和 41 项 schema 检查通过；QA-011 无 P0/P1。
- 390×844 竖屏验证无横向溢出；质量提示、Ranked/Normal/Turbo 选择、官方物品可用性声明与中立附魔均在真实页面可见。
- Supabase migrations 004/005 已应用：移除精确匹配的 seed map，并允许 `dota2_official` provider health；本地与远端 migration history 一致。
- 已知 P2：partial 目录 merge 仍可能保留 legacy row，列表级来源不能逐行表达；Patch 发布时间边界尚未细分低置信度窗口。
- 已导入的 legacy enriched 比赛若缺少第二中立强化字段，会在下一次玩家同步时只回填最新 20 场中的缺字段比赛；字段键落库后后续同步继续复用 enriched 详情，不恢复重复全量请求。
