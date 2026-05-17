# 股票长期追踪与散户活跃度雷达制度 v0.1

日期：2026-05-12

## 1. 制度目标

建立一套由猫之鼻、猫之眼、猫之耳共同维护的股票标的长期追踪制度，通过情绪面、消息面、基本面三条线索，形成“雷达亮区/暗区”，帮助闪电猫更早发现值得关注的标的、更好识别过热风险，并为后续交易计划提供结构化输入。

本制度用于研究和决策支持，不直接产生交易指令。

## 0. 会议治理不变量

所有与本制度相关的正式会议，默认遵守以下规则：

```text
猫之脑 main 必须参加。
猫之脑 main 是默认主持人。
猫之脑负责会议排版、议程推进、结束讨论和形成会议结论。
猫之脑负责决定是否进入下一流程。
猫之脑负责向闪电猫汇报和传达会议结果。
```

## 2. 基本原则

```text
三面分离：情绪面、消息面、基本面分别独立记录。
证据优先：任何评分必须有来源、时间戳和解释。
分歧保留：不同维度冲突时，不强行合并为单一结论。
长期追踪：关注趋势变化，而不是单日噪音。
交易隔离：雷达亮区不等于买入，暗区不等于机会，必须经过后续交易流程。
```

## 3. 标的池分层

### 3.1 Core Watchlist

长期重点追踪标的。

条件：

```text
基本面有长期研究价值
流动性足够
有明确行业位置
有反复出现的催化或分歧
```

### 3.2 Active Radar

近期进入高频观察的标的。

条件：

```text
散户活跃度显著变化
消息面出现催化
基本面出现边际变化
价格/成交量异常
```

### 3.3 Dark Radar

低关注但可能值得提前研究的标的。

条件：

```text
散户活跃度低
基本面或消息面出现早期改善
估值或市场关注度可能存在错配
```

### 3.4 Risk / Avoid

风险过高或暂不适合交易的标的。

条件：

```text
情绪过热
基本面恶化
消息面风险未消化
流动性不足
财务或治理风险突出
```

## 4. 三面分析职责

### 4.1 猫之鼻：情绪面与散户活跃度

核心问题：

```text
散户是否正在明显关注这个标的？
这种关注是理性分歧、趋势共识，还是情绪过热？
散户活跃度是刚启动、持续升温、高潮，还是退潮？
```

建议指标：

```text
讨论量
讨论量环比变化
搜索热度
社区帖子/评论增长
看多/看空比例
极端情绪词频
散户常用平台热榜
短线资金和题材传播速度
分歧度
```

输出：

```text
RetailHeatScore
SentimentDirection
SentimentStage = cold | warming | hot | euphoric | cooling
DisagreementScore
EmotionRiskFlags
```

### 4.2 猫之眼：消息面与事件雷达

核心问题：

```text
有什么新消息？
消息是否可靠？
消息影响多大？
市场是否已经反应？
是否存在后续事件节点？
```

建议事件分类：

```text
earnings
guidance
policy
industry
product
management
capital_operation
litigation
regulatory
rumor
black_swan
```

输出：

```text
NewsCatalystScore
EventType
SourceReliability
EventTimeline
AffectedTickers
CatalystWindow
UnverifiedRumorFlags
```

### 4.3 猫之耳：基本面与长期 thesis

核心问题：

```text
公司质量如何？
基本面是改善、稳定，还是恶化？
估值是否反映了当前基本面？
市场分歧的本质是什么？
哪些条件会证伪 thesis？
```

建议指标：

```text
收入增长
利润增长
毛利率
经营利润率
现金流质量
ROE / ROIC
负债压力
行业份额
估值分位
同业比较
管理层质量
```

输出：

```text
FundamentalScore
FundamentalTrend = improving | stable | deteriorating
ValuationState = cheap | fair | expensive | bubble
ThesisSummary
FalsificationTriggers
KeyMetricsToWatch
```

## 5. 雷达区域定义

### 5.1 亮区

```text
RetailHeatScore >= 70
且 NewsCatalystScore >= 60 或 FundamentalScore >= 60
```

含义：

市场关注度已经明显提升，且至少有一条可验证支撑线索。

动作：

```text
高频观察
创建或更新 EvidencePack
必要时进入投研会
满足条件时进入交易计划会
```

### 5.2 暗区

```text
RetailHeatScore <= 35
且 FundamentalScore 或 NewsCatalystScore 出现边际改善
```

含义：

市场关注度低，但存在提前研究价值。

动作：

```text
中频深度研究
寻找催化剂
确认流动性
建立 thesis 和反证条件
```

### 5.3 过热区

```text
RetailHeatScore >= 85
且 FundamentalScore < 50
或 RiskFlagScore >= 70
```

含义：

散户情绪可能过热，价格和叙事可能脱离基本面。

动作：

```text
风险提示
禁止直接因热度买入
如进入交易流程，猫之尾提高风控要求
```

### 5.4 死水区

```text
RetailHeatScore <= 35
NewsCatalystScore <= 35
FundamentalScore 无改善
```

含义：

短期缺少研究优先级。

动作：

```text
降低追踪频率
仅保留事件触发器
```

## 6. 标的追踪卡模板

```markdown
# Stock Tracking Card

- ticker:
- name:
- market:
- sector:
- watchlist_layer:
- last_updated:
- owner:

## Scores

- RetailHeatScore:
- NewsCatalystScore:
- FundamentalScore:
- DisagreementScore:
- RiskFlagScore:
- RadarPriorityScore:
- RadarZone:

## 猫之鼻：情绪面

## 猫之眼：消息面

## 猫之耳：基本面

## Thesis

## Falsification Triggers

## Key Dates

## Action Items

## Related Artifacts
```

## 7. 追踪节奏

### 日度

```text
Active Radar / 亮区 / 过热区
检查情绪、消息、价格异动和风险事件。
```

### 周度

```text
Core Watchlist / Dark Radar
更新基本面、催化剂和分歧。
```

### 月度

```text
全股票池
重新分层，清理死水区，复盘雷达命中率。
```

## 8. 进入交易流程的触发条件

满足以下条件之一，可以由猫之脑创建交易计划会，但不自动交易：

```text
亮区标的出现明确催化，且基本面或消息面支持。
暗区标的出现催化验证，散户活跃度开始升温。
过热区出现反转或风险释放，需要讨论减仓/避险/反向观察。
Core Watchlist 出现 thesis 关键证据变化。
```

进入交易计划会后：

```text
猫之心形成 TradeProposal 或 no-trade 结论。
猫之尾执行 RiskDecision。
猫之剑/盾/枪只执行已批准计划。
```

## 9. 第一阶段缺口

需要后续补充：

```text
具体数据源
评分计算公式
股票池初始名单
自动化采集脚本
Telegram 摘要格式
历史回测和复盘方法
```
