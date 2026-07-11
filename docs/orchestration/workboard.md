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

## Wave 7: Player refresh experience

| Task | Owner | Scope | Depends on | State |
|---|---|---|---|---|
| WEB-006 manual and automatic player refresh | Web Agent | `apps/web/**` | Wave 6 | ACCEPTED |
| QA-006 sync workflow audit | QA Agent | read-only | WEB-006 | ACCEPTED |
| DEPLOY-007 refreshed Web preview | Root | commit、preview deploy、live smoke | WEB-006, QA-006 | RUNNING |

## Wave 7 evidence

- 玩家页提供手动刷新；数据超过 15 分钟时进入页面会自动后台同步，新鲜数据不重复请求。
- 首次账号查询等待同步任务到达终态后才导航，消除 202 后提前显示“记录不存在”的竞态。
- 同步轮询具有 8 秒单请求超时、180 秒总预算、75 次轮询上限和卸载取消机制。
- 隐私、限流、上游不可用、解析等待与失败均显示独立状态，不会退化为空数据或错误导航。
- 全仓 typecheck、生产 build 和 95 项常规测试通过；3 项专用测试数据库集成测试按设计跳过。
- QA-006 无 P0/P1/P2，未发现客户端凭据或自动更新循环。
