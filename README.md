# Dodo Data Center

面向 Dota 2 玩家的公开比赛分析与版本化百科。

> A full-stack Dota 2 public match analytics and versioned encyclopedia project.

Dodo Data Center 的目标是把公开比赛数据整理成可解释、可筛选、带样本范围的数据产品：玩家可以查看最近比赛、英雄使用和表现趋势，也可以查询当前版本英雄与物品资料。地图资料只有在版本、来源和坐标均经过验证后才会公开。

项目目前处于 MVP 阶段。它不会绕过 Steam/Dota 2 的隐私设置，也不会把最近导入的公开比赛描述为玩家的完整职业生涯。

## 已实现

- 支持 Dota Account ID、SteamID64 和 Steam 个人主页 URL。
- 同步公开账号最近 100 场比赛。
- 玩家页支持手动刷新，并在数据超过 30 分钟时自动后台更新。
- 玩家页可按每批 100 场继续回填更早的公开比赛；进度、最早记录、限流和失败状态会持久保存并可断点续跑。
- 玩家概览与最近 20/50/100 场统计窗口。
- 玩家比赛与英雄统计支持“时间窗口 × Patch”组合筛选，并提供全部已导入范围。
- 比赛浏览默认每页 30 条，支持按英雄、官方小版本、胜负、Ranked/Normal lobby、Turbo/game mode 和 UTC 日期组合筛选后继续加载。
- 英雄使用、胜率、KDA、GPM、XPM、补刀和伤害概览。
- 最近比赛列表与单场比赛详情。
- 最近 20 场会后台补齐十人阵容、赛后指标、最终装备、技能加点顺序和可用的真实购买事件。
- 单场详情提供十人玩家选择器，可在技能加点与真实物品交易时间线之间切换。
- Dota 2 official current-data 驱动的英雄、技能、物品和官方小版本百科；物品定义与“当前商店可购买”使用不同的数据质量状态。
- 主导航包含“更新”Tab，可浏览最近 5 个 Dota 2 官方小版本的通用、英雄、物品、中立物品与中立生物改动。
- 地图数据没有可审计的当前快照时明确返回 unavailable，不用 seed 或空 geometry 冒充完整地图。
- Private、Partial、Rate limited、Unavailable 和 Failed 独立状态。
- 暗色响应式 Web，支持桌面与竖屏设备。
- Seed 与 OpenDota live 两种数据模式。
- Memory 与 Supabase PostgreSQL 两种仓储模式。
- 数据来源、样本量、覆盖率、指标版本和更新时间随统计返回。

## 当前边界

MVP 只分析可公开访问且通过质量检查的比赛。以下能力仍在路线图中：

- 完整 replay 下载与自研解析。
- 眼位、死亡和移动路径热图。
- 全量物品购买时间线与技能升级事件。
- 大规模英雄克制、配合和版本 Meta OLAP。
- React Native 客户端。

地图页当前返回 unavailable；版本化静态资料完成来源与坐标审计后才会开放。实时热图和推荐眼位不属于 MVP。

## 技术架构

```text
OpenDota public matches / Dota 2 official current-data / curated maps
        |
        v
provider adapters + quality gates
        |
        v
Fastify REST API
        |
        +---- Memory repository (seed/tests)
        |
        +---- Supabase PostgreSQL (persistent live data)
        |
        v
Next.js Web + same-origin BFF
```

主要技术：

- Node.js 22、TypeScript、pnpm workspace。
- Fastify API、Zod 公共契约。
- Next.js 16、React 19。
- Supabase PostgreSQL、SQL migrations、postgres.js。
- Vitest。

架构决策和数据口径见：

- [MVP PRD](docs/prd/mvp.md)
- [Dota 2 domain context](docs/prd/dota2-domain-context.md)
- [HTTP contract](docs/api/http-contract.md)
- [Player metrics](docs/metrics/player-metrics.md)
- [Data flow](docs/architecture/data-flow.md)
- [Supabase persistence ADR](docs/adr/0001-supabase-postgres-persistence.md)

## 仓库结构

```text
apps/api             Fastify REST API
apps/web             Next.js Web
packages/contracts   公共运行时契约与 TypeScript 类型
packages/dota-data   OpenDota 比赛与 Dota 2 official current-data 适配、账号解析和质量标准化
packages/db          Memory/PostgreSQL Repository
packages/ui          共享 Web 展示组件
supabase              本地配置、migration、seed 与数据库测试
docs                  PRD、指标、架构、API 和 ADR
```

## 快速开始：Seed 模式

Seed 模式不需要 API Key、数据库或 Docker，适合首次运行和前端开发。

```bash
git clone https://github.com/RayLi-Muye/dodo-data-center.git
cd dodo-data-center
corepack enable
pnpm install
cp .env.example .env
pnpm dev
```

默认地址：

- Web：`http://127.0.0.1:3000`
- API：`http://127.0.0.1:3001`

## 使用 Supabase PostgreSQL

本地 Supabase 需要 Docker。项目把数据库变更保存在 `supabase/migrations`，本地和云端使用同一套 migration。

```bash
pnpm supabase:start
pnpm supabase:reset
```

然后以 PostgreSQL + live 模式启动 API：

```bash
DODO_DATA_MODE=live \
DODO_REPOSITORY=postgres \
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
pnpm --filter @dodo/api dev

pnpm --filter @dodo/web dev
```

云端 Supabase 使用 Dashboard 提供的服务端连接串替换 `DATABASE_URL`。数据库密码、访问令牌和 service-role key 不得放入 `NEXT_PUBLIC_*` 环境变量，也不得提交到仓库。

应用表位于不对 Supabase Data API 暴露的 `dodo` schema；浏览器通过 Fastify API 访问数据。

## 环境变量

完整模板见 [.env.example](.env.example)。

| Variable | Default | Purpose |
|---|---|---|
| `DODO_DATA_MODE` | `seed` | `seed` 或 `live` 数据源 |
| `DODO_REPOSITORY` | `memory` | `memory` 或 `postgres` 仓储 |
| `DATABASE_URL` | local Supabase | 服务端 PostgreSQL 连接串 |
| `OPENDOTA_API_BASE_URL` | OpenDota API | OpenDota endpoint |
| `OPENDOTA_API_KEY` | empty | 可选的服务端 OpenDota Key |
| `API_BASE_URL` | local API | Next.js BFF 访问 API 的地址 |
| `NEXT_PUBLIC_API_BASE_URL` | local API | 显式浏览器端备用地址 |

## 海外部署

当前海外预览拓扑是 Vercel Web + Railway Singapore 常驻 API + Supabase Tokyo：

```text
Vercel CDN / Next.js BFF (preferredRegion: hnd1)
                |
                v
Fastify API (Railway Singapore, one always-running instance)
                |
                v
Supabase PostgreSQL (Tokyo)
```

- Web 预览：<https://web-git-codex-deploy-preview-rays-projects-f956e95b.vercel.app>
- API 预览：<https://api-production-1f7d.up.railway.app>
- Railway 使用仓库根目录的 [`railway.json`](railway.json) 构建同一 API 容器；Fly Tokyo 配置保留为后续迁移备选。
- API 容器、Fly 备选配置、secrets、migration、smoke 和 rollback 说明见 [`infra/fly`](infra/fly/README.md)。
- Vercel monorepo、东京区域和环境变量设置见 [`infra/vercel`](infra/vercel/README.md)。
- 当前同步任务在 HTTP 202 后继续运行，因此 API 必须使用常驻进程；在数据库任务队列完成前只运行一个 API 实例。
- 数据库 migration 是独立发布步骤，不随每次应用启动自动执行。

## 测试与质量门禁

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
node supabase/tests/static-schema-check.mjs
```

PostgreSQL 集成测试会清理目标数据库中的 `dodo.*` 表，因此必须使用专用测试库。测试具有双重保护：数据库名称必须包含 `test`，并且必须显式允许 reset。

```bash
DODO_ALLOW_TEST_DB_RESET=1 \
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/dodo_test \
pnpm --filter @dodo/db test
```

不要把开发库或生产库连接串用于 `TEST_DATABASE_URL`。

## 数据与隐私

- 只使用上游允许公开访问的数据。
- 不绕过隐藏比赛历史或私密资料。
- OpenDota Key 和数据库凭据只存在于服务端环境。
- 统计结果明确标注样本量、覆盖率、来源和更新时间。
- 第三方数据可能延迟、缺失或被上游限流，产品会显示对应状态。

## 参与开发

欢迎通过 Issue 提交数据口径、上游兼容性、可视化和无障碍方面的问题。提交修改前请运行类型检查、测试和构建，并避免在 fixture、日志或截图中包含非必要的个人数据或凭据。

## 声明

Dodo Data Center 是社区项目，与 Valve、Steam、Dota 2、OpenDota 或其运营方没有隶属或官方合作关系。Dota 2、Steam 及相关素材的商标和版权归各自权利人所有。
