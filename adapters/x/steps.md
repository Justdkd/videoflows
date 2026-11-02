# X：浏览器只读步骤

前提见 `adapter.json` 的 `needs`。通用规则见 `adapters/README.md`。

## 去哪读

1. 用用户的 Chrome 打开这条帖子（卡里的 `url`）。
2. 点帖子下方的数据图标（「View post analytics」/「查看帖子分析」），读弹出的分析页。只读，不点「Promote / 推广」。

## 对应表

| 后台显示 | 写到 metrics 的键 | 换算 |
| --- | --- | --- |
| Impressions / 曝光 | plays | 整数。注意：这是曝光，不是播放 |
| Likes / 喜欢 | likes | 整数 |
| Replies / 回复 | comments | 整数 |
| Reposts / 转帖 | shares | 整数（引用帖不单算） |
| Bookmarks / 书签 | favorites | 整数 |
| New follows / 新关注 | new_followers | 整数 |

## X 特有

- 帖子里的视频播放数（video views）和完播数据 v1 不录。
- X 的私有指标一般只在发布后一段时间内可看；看不到就进 `missing`，不估。
