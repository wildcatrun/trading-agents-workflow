# 消息面事件雷达输入草案 v0.1

- meeting_id: research-20260512-stock-retail-radar
- owner: cat_eyes
- source: cat_eyes prior meeting reply collected by main
- status: draft_artifact
- trade_boundary: 本文件只建立消息催化评分框架，不形成交易指令。

## 1. NewsCatalystScore：事件分类与评分维度

### 事件分类

- `regulatory_policy`：监管、政策、交易所规则、产业扶持/限制。
- `company_disclosure`：公告、财报、业绩预告、更正、问询回复。
- `capital_operation`：并购、重组、定增、回购、减持、股权激励。
- `business_operation`：大单、订单、产能、产品发布、渠道突破、出海进展。
- `governance_management`：高管变动、实控人变化、治理问题。
- `industry_chain`：上游原料、价格、供需、行业景气度变化。
- `risk_negative`：诉讼、处罚、停产、事故、违约、退市风险。
- `market_microstructure`：异动停牌、监管关注、融资融券、指数纳入剔除。
- `rumor_unverified`：传闻、聊天记录、二手截图、未证实爆料。

### 评分维度

- `materiality`：对利润、现金流、估值框架影响大小。
- `scope`：影响公司自身、子行业、全行业或跨市场。
- `certainty`：事实是否已确认，是否可落地执行。
- `novelty`：是否为市场新增信息，而非旧闻重炒。
- `timeliness`：信息距首次披露多久，是否已被充分交易。
- `persistence`：一次性冲击还是可持续催化。
- `traceability`：是否可回溯到原始出处。
- `market_signal`：市场是否出现量价、波动、板块联动响应。

初始权重建议：materiality 25%，certainty 20%，persistence 15%，novelty 15%，timeliness 10%，traceability 10%，market_signal 5%。单项可先 0-5 分，再归一到 0-100。

## 2. SourceReliability 分层

| 等级 | 来源 | 用法 |
| --- | --- | --- |
| S | 交易所公告、监管部门、法院文书、正式政策文件 | 可进入正式事件池 |
| A | 公司公告、财报、业绩会纪要原文、公司官网/官微正式发布 | 可进入正式事件池 |
| B | 主流财经媒体、权威行业协会、核心卖方公开材料 | 可进入观察池，尽量追原文 |
| C | 垂直行业媒体、自媒体深度稿、二次转述纪要 | 仅作线索，不直接形成高分催化 |
| D | 社交平台帖子、股吧、微信群截图、匿名爆料、未证实传闻 | 必须挂 UnverifiedRumorFlags |

## 3. EventTimeline 模板

```text
EventTimeline
- event_id:
- ticker:
- event_type:
- first_occurred_at:
- first_disclosed_at:
- first_seen_by_system_at:
- primary_source:
- source_reliability:
- summary:
- market_reaction_day0:
- market_reaction_day1_3:
- follow_up_nodes:
  - 财报/问询/审批/落地/交付/复牌/电话会
- status: pending / confirmed / partially_confirmed / disproved / expired
- notes:
```

## 4. UnverifiedRumorFlags 规则

标记条件：无原始出处；只有截图/转述/匿名消息；关键细节无法交叉验证；与公告、监管、公司口径冲突。

处理规则：

- 单独放入 `rumor_quarantine`。
- 不进入强结论，不直接推高 NewsCatalystScore。
- 分数上限建议 <=35。
- 必须写明传闻内容、首次出现时间、传播路径、已验证/未验证点、证伪触发条件。
- 若 24-72 小时内无高可信来源确认，优先降权而不是继续扩散。

## 5. CatalystWindow 初始定义

- `short_term`：0-5 个交易日，适合突发公告、监管动作、订单公告、异动触发。
- `mid_term`：1-8 周，适合业绩预告、产业催化、产品验证、景气度变化。
- `long_term`：2-4 个季度，适合产能释放、治理改善、行业周期反转、长期政策方向。

规则：每个事件至少绑定一个主窗口；可同时有副窗口，但不能把短线脉冲硬包装成长期逻辑。

## 6. 与猫之鼻、猫之耳冲突时如何保留分歧

分歧记录格式：

- `eyes_view`：消息面判断。
- `nose_view`：情绪面判断。
- `ears_view`：基本面判断。
- `conflict_type`：消息强/情绪弱；情绪热/基本面弱；基本面强/消息空窗。
- `resolution_status`：unresolved / watch / resolved。

原则：不强行合并单一结论；保留“三面并列”。若消息强但基本面未证实，进入事件观察，不升级为高确信 thesis；若情绪极热但消息弱，标记传播强于事实；若基本面强但消息空窗，可放入暗区，不因缺新闻否定研究价值。
