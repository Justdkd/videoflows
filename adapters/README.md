# 平台采集适配器

每个平台一个目录：`adapter.json`（机器读，用 `schema/adapter.schema.json` 校验）+ `steps.md`（写给 agent 的浏览器只读步骤）。

v1 全部是 `browser_readonly`：不接官方接口，不做定时任务，只在用户电脑开着、用户自己说了「可以读」时，用用户已登录的 Chrome 读后台。

## 所有平台通用的规则

1. **只读**。只打开页面、看数字。不点任何会改东西的按钮：发布、删除、编辑、置顶、回复、投放、下单、充值、改设置、授权、同意协议都不点。弹窗只点「关闭 / 取消 / 以后再说」。
2. **不碰凭据**。没登录就停下，在卡上写 `ask`（见 AGENTS.md 第 4 节）：`question`「<平台> 后台没登录」，`options` `["登好了"]`，`if_no_answer`「这次不读，下次电脑开着再读」。不输入账号、密码、验证码，不读 cookie。
3. **一次读完**。先跑 `node scripts/build-index.mjs`，从 `index.json` 的 `today`（agent 待办，`kind: sample_due`）和各卡 `next_samples`（`status` 为 `due` 或 `overdue`）里列出当天到点和逾期的全部采样，按平台分组，一个平台打开一次后台读完。
4. **读到什么写什么**。按本平台 `steps.md` 的对应表把数写进卡的 `publications[].samples[]`：
   - `point`：采样点；`taken_at`：读数时刻（带时区）；`source`：`browser`；`read_by`：agent 名。
   - `metrics`：只写读到的数。比率写小数（45.2% → 0.452），计数写整数（1.2 万 → 12000；后台只给约数时按显示值换算，并在卡的 `notes` 记一句「约数」）。
   - `missing`：`adapter.json` 的 `metrics` 里有、但这次没读到的指标。平台本来就没有的指标（不在 `adapter.json` 里）既不写键也不进 `missing`。
5. **读不到不编**。先刷新重试一次；还读不到就写进 `missing`，`index.json` 的 agent 待办会出现 `manual_fill`；在卡上写 `ask` 请用户补，`if_no_answer` 写「这个数先空着，不当 0 算」。整页都打不开时，这个采样先不写，在卡的 `blocked_on` 写原因。
6. **写完照 AGENTS.md 收尾**：更新 `last_touched` → 跑 build-index → 校验过才提交。

## 加一个平台或接口

- 加平台：在 `config.json` 的 `platforms` 加一项，新建 `adapters/<id>/adapter.json` 和 `steps.md`，`schema/` 里的平台枚举也要加（这一步改 schema，要用户同意），页面上的平台名在 `site/app.js` 的 `PLAY_CN` 里加。
- 以后接官方接口：同一目录加 `mode: "api"` 的实现，输出格式不变，卡和页面都不用改。

## 未验证的地方

各平台后台的菜单名和页面位置是按公开资料写的，没有实际登录核对过。第一次照着读时，发现和实际不一样就改 `steps.md`；发现后台确实有/没有某个指标，就改 `adapter.json` 的 `metrics`，并在提交信息里写清楚。
