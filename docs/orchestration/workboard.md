# Agent Workboard

## State machine

`READY -> RUNNING -> REVIEW -> ACCEPTED`

`RUNNING -> BLOCKED` 仅在有具体证据和最小所需决策时使用。Root 是唯一能将任务标记为 `ACCEPTED` 的角色。

## Active wave

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
