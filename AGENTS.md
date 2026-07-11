# Dodo Agent Contract

## Product boundary

MVP 是“公开账号最近比赛与英雄使用分析 + 当前版本英雄、物品、地图百科”。地图仅包含版本化静态资料；热图、移动路径、眼位推荐和自研 replay parser 不属于 MVP。

## Root-only ownership

以下文件只能由 Root Orchestrator 修改：

```text
AGENTS.md
.impeccable.md
README.md
package.json
pnpm-workspace.yaml
pnpm-lock.yaml
tsconfig.base.json
.env.example
docs/prd/**
docs/adr/**
docs/metrics/**
docs/api/**
docs/orchestration/**
packages/contracts/**
```

Worker 如果发现契约不足，必须报告 `CONTRACT_CHANGE_REQUEST`，不得自行扩展。

## Directory leases

- Data Source Agent: `packages/dota-data/**`
- Backend/API Agent: `apps/api/**`, `packages/db/**`
- Web Agent: `apps/web/**`, `packages/ui/**`
- Infra Agent: `infra/**`, `.github/workflows/**`
- QA Agent: 默认只读，不拥有写入目录

一个目录同一时间只能有一个写入者。禁止跨目录顺手修复、全仓格式化和修改共享 lockfile。

## Worker rules

- 禁止创建或委派子 Agent。
- 只执行 Root 明确授权的本地修改和验证；不得 push、merge、release 或部署。
- 不得新增产品范围、公共字段、错误码或依赖。
- 网络请求必须有超时、错误分类和可测试的 provider 边界。
- 不得在客户端暴露上游 API Key。
- 不得绕过 Dota/Steam 隐私设置。
- 不得把公开样本、已导入样本或已解析样本描述为全量玩家数据。
- 完成时报告修改文件、测试命令与结果、剩余风险和契约变更请求。

## Required gates

1. 只修改授权路径。
2. `pnpm typecheck` 与相关测试通过。
3. 导入和同步逻辑幂等。
4. Private、Partial、Rate limited、Unavailable 与 Failed 不得退化成空数据。
5. 所有统计返回 `sampleSize`、`eligibleCount`、`coverageRate`、`updatedAt`、`metricVersion` 和 `sources`。
6. Root 执行全仓验证和真实公开账号端到端验证。
7. QA 无 P0/P1 问题后才接受 MVP。
