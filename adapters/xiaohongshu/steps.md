# 小红书：浏览器只读步骤

前提见 `adapter.json` 的 `needs`。通用规则见 `adapters/README.md`。

## 去哪读

1. 用用户的 Chrome 打开小红书创作服务平台：`https://creator.xiaohongshu.com/`。
2. 进「笔记管理」或「数据中心 → 笔记数据」，按发布时间或卡里的 `url` / `post_id` 找到这条笔记，打开它的数据详情。

## 对应表

| 后台显示 | 写到 metrics 的键 | 换算 |
| --- | --- | --- |
| 观看量 / 浏览量 | plays | 整数 |
| 点赞 | likes | 整数 |
| 评论 | comments | 整数 |
| 分享 | shares | 整数 |
| 收藏 | favorites | 整数 |
| 涨粉 | new_followers | 整数 |

## 小红书特有

- 后台如果显示完播率、平均观看时长占比、2 秒退出率这类比率，先在卡 `notes` 记下原名和数值，再提议把对应指标加进 `adapter.json` 的 `metrics`（改完要能通过 schema），不要直接写进 `metrics` 里——现在的 adapter 没有它们，写了 build-index 会报错。
- 不点「编辑」「删除」「置顶」「推广」「薯条」。
