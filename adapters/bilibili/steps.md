# B 站：浏览器只读步骤

只在这条视频发了 B 站（卡里有 bilibili 的发布记录）时读。前提见 `adapter.json` 的 `needs`。通用规则见 `adapters/README.md`。

## 去哪读

1. 用用户的 Chrome 打开 B 站创作中心：`https://member.bilibili.com/`。
2. 「内容管理 → 稿件管理」找到这条稿件，打开「数据」或进「数据中心 → 稿件分析」。

## 对应表

| 后台显示 | 写到 metrics 的键 | 换算 |
| --- | --- | --- |
| 播放 | plays | 整数 |
| 点赞 | likes | 整数 |
| 评论 | comments | 整数 |
| 分享 | shares | 整数 |
| 收藏 | favorites | 整数 |
| 涨粉 | new_followers | 整数 |

## B 站特有

- 投币、弹幕 v1 不录（schema 里没有这两个指标）；有意思的话在卡 `notes` 记一句。
- 不点「编辑」「删除」「推广 / 起飞」。
