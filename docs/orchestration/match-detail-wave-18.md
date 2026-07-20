# Wave 18: Parsed match facts

## Objective

把 OpenDota 已解析公开比赛中的高级事实无损带到 Dodo 单局详情，并重组为适合桌面和竖屏浏览的五页签工作台。第一阶段不自研 replay parser，也不发布无法说明总体样本的 benchmark、胜率预测或 MVP。

## Delivery order

1. Root 冻结公开合同、状态语义和兼容默认值。
2. Data Source Agent 以黄金 fixture 驱动 OpenDota 规范化。
3. Backend/API Agent 接通转换、JSONB 读取和 richer-data merge。
4. Web Agent 只消费一次页面请求取得的 MatchDetail，建立共享玩家选择与五页签。
5. Root 跑真实公开比赛 smoke；QA 独立检查缺失语义和 390px。

## First-slice fields

- 玩家累计快照：时间、经济、经验、补刀、反补。
- 阵营优势：每分钟天辉经济优势、经验优势，正值表示天辉领先。
- 击杀日志：击杀方 player slot、时间、上游目标实体 key。
- 伤害拆分：对实体造成、从实体承受、按来源造成、按来源承受。
- 目标事件：上游事件类型、时间、实体 key、单位、玩家和队伍引用。
- 团战摘要：开始、结束、最后死亡、死亡数以及每名玩家的死亡、买活、伤害、治疗、经济和经验变化。

## Data truth rules

- 高级区块完全缺失时为 `unavailable`；有有效数据但字段/事件缺失或被排除时为 `partial`；只在该区块所需输入完整有效时为 `complete`。
- `parseStatus=parsed` 不等于所有区块 complete。
- 无效嵌套记录只降低所属区块质量，不得让核心比赛详情失败，也不得污染其他区块。
- 玩家快照使用上游 `times`；其他数组按同一索引对齐，缺失项为 `null`，不得造值。
- 阵营优势没有独立上游时间轴，使用 `index * 60` 时公开 `axis=inferred_60s`。
- `kills_log.key`、伤害 map key 和 objective key 是上游实体标识，不承诺一定是英雄。
- 数组为空只有在区块 complete 时才能解释为已知没有事件；partial/unavailable 必须显示数据不足。
- 首轮只展示真实 XP 曲线；没有版本化升级经验表或 replay 等级事件时，不从 XP 武断派生等级变化。

## Verification

- Data tests：完整、部分、全缺失、错位数组、坏嵌套记录、匿名/排除玩家。
- DB tests：legacy default、summary 不覆盖 enriched、较弱 section 不覆盖 richer section、重复导入不变。
- Web tests：五页签、共享玩家选择、无额外 fetch、partial/unavailable 文案、390px 局部滚动。
- Full gates：`pnpm typecheck`、`pnpm test`、`pnpm build`、schema check、PostgreSQL integration。
- Live proof：公开账号 `224328273` 的已解析比赛，核对 API 与 OpenDota 源数据的样本长度、符号、事件数和页面展示。
