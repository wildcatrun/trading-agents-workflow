# 雷达亮区 / 暗区 / 过热区 / 死水区判定规则 v0.1

- meeting_id: research-20260512-stock-retail-radar
- owner: main
- source_artifacts:
  - retail-heat-score-v0.1.md
  - news-catalyst-score-v0.1.md
  - fundamental-score-v0.1.md
- trade_boundary: 本规则只决定研究/观察优先级，不形成交易指令。

## 1. 核心输入

```text
RetailHeatScore       0-100  散户活跃度
NewsCatalystScore     0-100  消息催化强度
FundamentalScore      0-100  基本面质量/改善
DisagreementScore     0-100  市场分歧度
RiskFlagScore         0-100  风险警报强度
SentimentStage        cold / warming / hot / euphoric / cooling
FundamentalTrend      improving / stable / deteriorating
ValuationState        cheap / fair / expensive / bubble
SourceReliability     S / A / B / C / D
```

## 2. 亮区 bright

定义：散户活跃度明显上升，消息面或基本面也出现可验证变化。

初始触发：

- RetailHeatScore >= 70；
- NewsCatalystScore >= 55 或 FundamentalScore >= 65；
- SourceReliability 不低于 B，或基本面证据可验证；
- RiskFlagScore 未明显压倒正面信号。

动作：

- 进入高频观察；
- 猫之眼核查催化来源和后续节点；
- 猫之耳确认基本面是否支持；
- 猫之鼻持续观察是否从 hot 进入 euphoric；
- 不自动进入交易，只可进入后续 `trade_planning` 候选。

## 3. 暗区 dark

定义：散户活跃度低，但基本面或消息面出现早期改善迹象。

初始触发：

- RetailHeatScore <= 35；
- FundamentalTrend = improving 或 NewsCatalystScore >= 45；
- 存在未来 2-4 个季度可验证催化；
- 流动性、财务质量、治理风险不构成明显死水陷阱。

动作：

- 进入中频深度研究；
- 优先寻找催化剂和反证条件；
- 要求猫之耳判断“提前研究价值 vs 死水陷阱”；
- 不因低关注度本身形成交易结论。

## 4. 过热区 overheated

定义：散户活跃度极高，但基本面或消息面无法支撑，或风险旗帜明显上升。

初始触发：

- RetailHeatScore >= 85；
- SentimentStage = euphoric；
- FundamentalScore < 60 或 ValuationState = expensive/bubble；
- 出现 `one_sided_bullish`、`rumor_driven_heat`、`fade_after_spike` 等 EmotionRiskFlags。

动作：

- 升级风险观察；
- 猫之尾后续如进入交易流程必须提高风险约束；
- 不把过热直接解释为做空信号；
- 优先检查传闻、兑现、拥挤和反身性风险。

## 5. 死水区 dead_water

定义：散户活跃度低，消息面弱，基本面弱或缺少变化。

初始触发：

- RetailHeatScore <= 35；
- NewsCatalystScore <= 35；
- FundamentalTrend = stable/deteriorating 且缺少可验证改善；
- 流动性差、治理差、行业长期衰退或无明确催化。

动作：

- 降低追踪频率；
- 仅保留关键事件触发器；
- 不因“便宜”或“没人看”自动进入暗区。

## 6. 冲突处理

### 情绪热 / 消息弱 / 基本面弱

标记为 `overheated_or_rumor_driven`，需要猫之眼核查传闻，猫之耳检查估值和基本面脆弱点。

### 基本面强 / 情绪冷 / 消息空窗

标记为 `dark_candidate`，需要明确 2-4 个季度验证点和潜在催化。

### 消息强 / 基本面未证实

标记为 `event_watch`，不得直接升级为长期 thesis。

### 三面均强

标记为 `bright_high_priority`，但仍只进入研究/计划候选，不形成执行。

## 7. 与交易流程的边界

- 雷达区域只决定研究优先级。
- `bright` 不等于买入。
- `dark` 不等于潜伏。
- `overheated` 不等于做空。
- 进入交易必须另开 `trade_planning`，再过 `risk_review` 和 human gate。
