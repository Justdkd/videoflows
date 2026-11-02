# YouTube：浏览器只读步骤

只在这条视频发了 YouTube（卡里有 youtube 的发布记录）时读。前提见 `adapter.json` 的 `needs`。通用规则见 `adapters/README.md`。

## 去哪读

1. 用用户的 Chrome 打开 YouTube Studio：`https://studio.youtube.com/`。
2. 「内容」列表里找到这条视频，点「数据分析」。概览页和「互动」页读数。时间范围选「自发布以来」。

## 对应表

| 后台显示 | 写到 metrics 的键 | 换算 |
| --- | --- | --- |
| 观看次数 / Views | plays | 整数 |
| 平均观看百分比 / Average percentage viewed | avg_watch_ratio | 百分数 ÷ 100 |
| 顶 / Likes | likes | 整数 |
| 评论 | comments | 整数 |
| 分享 | shares | 整数 |
| 获得的订阅者 / Subscribers gained | new_followers | 整数 |

## YouTube 特有

- 不点「编辑」「可见性」「推广」，不改任何设置。
- Shorts 的「观看 vs 划走」不是 5 秒完播，v1 不录。
