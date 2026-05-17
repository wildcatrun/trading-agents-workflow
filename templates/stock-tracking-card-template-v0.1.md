# 股票长期追踪卡模板 v0.1

- meeting_id: research-20260512-stock-retail-radar
- owner: main
- source_artifacts:
  - retail-heat-score-v0.1.md
  - news-catalyst-score-v0.1.md
  - fundamental-score-v0.1.md
- trade_boundary: 本模板用于研究追踪，不形成交易指令。

## 1. 基本信息

```yaml
ticker:
name:
industry:
theme_tags: []
research_state: core | active_radar | dark_radar | avoid
last_updated:
owner_agents:
  nose: cat_nose
  eyes: cat_eyes
  ears: cat_ears
```

## 2. 三面评分摘要

| 模块 | 字段 | 分数/状态 | 置信度 | 更新时间 |
| --- | --- | --- | --- | --- |
| 情绪面 | RetailHeatScore | 0-100 | high/medium/low | |
| 情绪面 | SentimentStage | cold/warming/hot/euphoric/cooling | | |
| 情绪面 | DisagreementScore | 0-100 | | |
| 消息面 | NewsCatalystScore | 0-100 | | |
| 消息面 | SourceReliability | S/A/B/C/D | | |
| 消息面 | CatalystWindow | short_term/mid_term/long_term | | |
| 基本面 | FundamentalScore | 0-100 | | |
| 基本面 | FundamentalTrend | improving/stable/deteriorating | | |
| 基本面 | ValuationState | cheap/fair/expensive/bubble | | |

## 3. EvidencePack

```text
EvidenceLinks:
- source:
  reliability:
  captured_at:
  summary:
  supports:
  conflicts:
```

证据要求：

- 消息面尽量追溯到 S/A/B 级来源。
- 情绪面优先使用聚合指标，不无边界保存全文。
- 基本面必须写明财务/经营指标来源和口径。
- 未经证实传闻单独进入 rumor_quarantine。

## 4. ThesisSummary

```text
1. 长期逻辑：
2. 当前核心证据：
3. 市场可能低估/高估之处：
4. 未来 2-4 个季度验证点：
5. 反证条件：
```

## 5. RadarZone 判定

```yaml
radar_zone: bright | dark | overheated | dead_water | watch_only
zone_reason:
required_followups:
  - cat_nose:
  - cat_eyes:
  - cat_ears:
```

## 6. ConflictRecord

当三面信号冲突时，必须保留分歧：

```text
nose_view:
eyes_view:
ears_view:
conflict_type:
resolution_status: unresolved | watch | resolved
next_check_date:
```

## 7. FalsificationTriggers

- 连续 2 个季度收入/利润低于 thesis 路径。
- 毛利率持续下滑且无法解释。
- 经营现金流长期劣于利润。
- 关键订单、产能、新品、政策催化未兑现。
- 情绪热度由未证实传闻驱动且被证伪。
- 估值进入 bubble 但业绩无法兑现。

## 8. Action Items

| owner | action | due | status | evidence_required |
| --- | --- | --- | --- | --- |
| cat_nose | 更新情绪指标 | | pending | 聚合热度/分歧/风险 flags |
| cat_eyes | 更新事件时间线 | | pending | 原始来源和可靠性 |
| cat_ears | 更新基本面验证点 | | pending | 财务/经营证据 |
| main | 汇总并决定下一流程 | | pending | 三面输入均已落盘 |

## 9. 禁止项

- 本卡不是交易指令。
- 不得用单一热度、单一新闻、单一估值指标直接推出买卖结论。
- 不得绕过猫之尾风控和 human gate。
