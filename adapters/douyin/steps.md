# 抖音：浏览器只读步骤

前提见 `adapter.json` 的 `needs`。通用规则见 `adapters/README.md`，这里只写抖音特有的。

## 去哪读

1. 用用户的 Chrome 打开抖音创作者服务中心：`https://creator.douyin.com/`。
2. 进「数据中心」或「内容管理」里的作品列表，按发布时间或卡里的 `url` / `post_id` 找到这条视频，打开它的「作品数据」/「数据详情」。
3. 读「作品数据」概览和「观看分析」里的数。

## 对应表

| 后台显示 | 写到 metrics 的键 | 换算 |
| --- | --- | --- |
| 播放量 | plays | 整数 |
| 2s 跳出率 | bounce_2s | 百分数 ÷ 100 |
| 5s 完播率 | completion_5s | 百分数 ÷ 100 |
| 平均播放占比 | avg_watch_ratio | 百分数 ÷ 100 |
| 点赞 | likes | 整数 |
| 评论 | comments | 整数 |
| 分享 | shares | 整数 |
| 收藏 | favorites | 整数 |
| 作品涨粉 / 新增粉丝 | new_followers | 整数 |

## 抖音特有

- h10 最先读：DOU+ 首投建议要等它。读完跑 build-index，`derived.douplus.first` 会给出建议，出现在流水线底部「等你」里等用户拍板。
- 用户说投了 DOU+ 之后才写 `douplus.decision / amount / ordered_at`，`decided_by: "user"`。下单后 12 小时再读一次，`point` 写 `douplus_h12`。
- 只看 DOU+ 的数据页，不在 DOU+ 页面点「投放」「追加」「续投」。
- 数据有延迟时（后台写「数据更新于 X 时」），`taken_at` 仍写实际读数时刻，在卡 `notes` 记一句后台的更新时间。
