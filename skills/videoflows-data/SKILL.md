---
name: videoflows-data
description: Use when reading a published video's stats (day 3, day 7, 10-hour checks), deciding whether to boost with DOU+ or other paid promotion, analysing why a video underperformed, drafting replies to comments, or writing the weekly review, for VideoFlows cards in the data or reviewed stage.
---

# VideoFlows 数据和复盘

## 概览

发布后读数据、给投放建议、回评论、写周复盘，把学到的交回下一期选题。**花钱的事永远是用户自己下单（G8）；发出去的评论回复要用户点头（G9）。**

## 步骤

1. **采数据**：只在用户说「电脑开着」时，用用户自己的浏览器只读后台，按仓库 `AGENTS.md` 5.6 和 `adapters/<平台>/steps.md` 录 `h10`、`d3`、`d7`。读不到写进 `missing`，不估、不写 0。不设依赖用户电脑的定时任务。
2. **投放建议**（抖音 DOU+ 等）：先看看板算出的 `derived.douplus`，再按 `references/douplus.md` 判断。给用户一句话结论（投 / 不投 / 先小额测）、理由里的三个数、建议金额和这单的目的。**停在 G8**：用户自己下单，agent 不点任何付费按钮。用户下了单，录 `douplus` 字段，12 小时左右再看一次，按每粉成本建议追还是停。
3. **没跑起来时找原因**：和自己最近 8–10 条同时长的视频比开头留存（2 秒跳出、5 秒完播）、收藏率加分享率、自然播放加涨粉率，再看流量来源和观众在哪一秒跳走。给 2–3 条具体原因和下期能改的地方，交回选题。
4. **评论**：把评论分三类：要回的问题、可以做成选题的问题、不用回的。要回的起草回复（按档案口吻，一条一两句）。**停在 G9**：回复由用户自己发，agent 不在任何平台上点回复。好问题按 `videoflows-topic` 建灵感卡，`source: "comment"`。
5. **周复盘**：按 `AGENTS.md` 5.7 写 `reviews/<年>-W<周>.json`：最好、最差、1–3 条带数字的规律、下周改什么。`next_week` 会被下周选题读到。
6. **收尾**：所有必录平台的 `d7` 录完、复盘引用了这张卡，卡推到 `reviewed`。

## 规矩

- 数据只读：不点赞、不回复、不删、不改设置、不投放。
- 建议是建议：别写成「用户定的门槛」。数据证明建议错了就改，并告诉用户。
- 每单投放记 4 个数：花费、买到的播放、每粉成本、撬动的自然播放。

## 常见错误

| 错 | 对 |
|---|---|
| 读不到的指标写 0 | 写进 `missing` |
| 自然流衰退了还建议投 | 衰退几天的不投 |
| 复盘只写感受 | 每条规律带数字和对比 |
