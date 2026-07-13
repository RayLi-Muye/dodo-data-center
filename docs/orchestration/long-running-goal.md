# Long-running Goal Orchestration

本文件约束 Dodo 长时间开发 Goal 的执行、检查点和自动恢复行为。

## Active goal: hero and item encyclopedia foundation

地图真实快照激活暂缓，现有 `MAP_UNAVAILABLE` 与审计门禁保持不变。当前 Goal 按以下顺序推进：

1. Root 冻结英雄技能数值与实体更新历史契约。
2. Data Source Agent 从 Dota 2 official current-data 补齐可验证的技能效果字段，并对英雄、物品、更新实体 ID 做黄金样本对账。
3. Backend/API Agent 在现有更新快照上实现英雄/物品最近变更查询；不新增分析型数据库或运行时上游直查。
4. Web Agent 完善英雄与物品列表/详情，展示基础资料、价格、效果、合成与最近变更，并完成 390px 竖屏适配。
5. QA Agent 只读验证完整/partial/unavailable、当前版本、官方来源链接与无匹配更新语义。
6. Root 执行全仓门禁、真实生产数据对账和 Railway/Vercel 部署。

英雄胜率、英雄使用率、物品购买率、购买时间与胜率属于百科第二阶段，不进入当前静态资料切片。

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
