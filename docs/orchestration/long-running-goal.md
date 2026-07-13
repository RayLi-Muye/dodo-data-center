# Long-running Goal Orchestration

本文件约束 Dodo 长时间开发 Goal 的执行、检查点和自动恢复行为。

## Active goal: five-stage MVP hardening

当前 Goal 按以下顺序推进；前一阶段达到 Root 与 QA 门禁后才进入下一阶段，但不依赖同一上游的任务可以并行审计：

1. OpenDota 自动同步：有限重试、请求合并、30 分钟 freshness、无变化不写入，以及 `main` 自动部署基线。
2. STRATZ 自动增强：确认 Railway `403` 的服务端访问方案；不得使用代理绕过上游限制，未解决时保持 OpenDota 降级。
3. 英雄、物品和更新百科：清理 legacy rows、简中或双语、保留未完全解析天赋并扩展官方字段。
4. 比赛详情：加点、购买时间线、来源完整度与批量回填状态。
5. 地图百科：只接受版本化、可审计的静态地图快照；热图和 replay parser 仍不属于 MVP。

每阶段完成条件：相关包测试、全仓 typecheck、真实 PostgreSQL、生产 build、真实账号 `224328273`、QA 无 P0/P1、GitHub PR 与海外部署验证。

## Delivery loop

每个垂直切片都必须依次完成：

1. Root 冻结产品边界、公共合同和验收数据。
2. Worker 只在目录 lease 内实现，并运行包级测试。
3. Root 合并后执行全仓 typecheck、test、生产 build 和静态数据库检查。
4. Root 手工审查差异；结构化审查器可用时再执行 autoreview。
5. 提交并推送 `codex/deploy-preview`。
6. 部署海外预览，并使用真实公开账号或比赛验收。
7. 更新计划后进入下一个切片。

## Automatic stall recovery

- Worker 启动后 90 秒没有文件变化、测试输出或状态消息：Root 发送一次状态检查。
- 状态检查后再过 60 秒仍无可验证进展：Root 中断 Worker。
- Root 将任务缩小到一个更窄的目录和单一验收目标，并自动重试一次。
- 第二次仍没有进展：不再等待 Worker，由 Root 接管本地实现。
- 同一阻碍只有在连续三个 Goal turn 都无法绕过时，才把 Goal 标记为 `blocked`。

## Command and deployment timeouts

- 长命令必须返回 session/cell id，并以不超过 30 秒的间隔轮询。
- 禁止单次阻塞等待超过 60 秒。
- 构建或部署超时后先读取日志，再最多重试一次；不得盲目重复同一命令。
- 后台任务在部署前必须达到终态，或明确证明部署不会丢失 checkpoint。

## Checkpoint rules

- 一个提交只包含一个可解释的垂直切片或其阻断修复。
- 每次提交前工作树必须通过 `git diff --check`。
- 不得为了追求 Goal 连续运行而跳过隐私、数据质量、迁移或部署门禁。
- 上游缺失字段必须展示为 partial/unavailable，不得推断不存在的技能、物品或交易事件。
