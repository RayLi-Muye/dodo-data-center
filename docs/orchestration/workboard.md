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
