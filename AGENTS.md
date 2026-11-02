# AGENTS.md

任何 AI agent 接进这个仓库，先读完这一份。这里只写文件、字段和步骤，不绑定任何工具；各工具自己的说明文件（如 CLAUDE.md）只写一行「先读 AGENTS.md」。

命令里的 `node` 指 Node.js 18 及以上，仓库零依赖，不用装包。

## 1. 这个仓库是什么

自媒体流水线看板的数据仓库：每条视频一张「卡」，从选题 → 文案 → 录制 → 剪辑 → 样片关卡 → 发布 → 数据 → 周复盘走完一条流水线。用户只看页面，不读文件；文件格式为 agent 和脚本优化。

页面（`site/`，读构建时生成的 `data.json`）有四个。页面上能点的按钮（回答 ask、定候选、搁置、DOU+ 拍板、记灵感、把归档的挪回来）经服务器上的 `/api/act` **直接改卡**：服务器按 `scripts/lib/actions.mjs` 的规则算出新卡，过了 schema 才在 `main` 上提交一次（提交信息 `[web] <动作>: <卡 id>`），不等 agent。网页上不收自由留言，要说别的去和 agent 的对话里说。agent 怎么接着做见 5.9。网站由 `node scripts/build-site.mjs` 生成到 `dist/`：先跑 build-index，再把 `site/` 和 `data.json`（index、归档摘要、config、原始卡片、复盘）放进去；部署到 Cloudflare Pages 的话，每次 push 自动跑这一步。页面地址后加 `?demo` 看示例数据。

| 页面 | 管什么 |
| --- | --- |
| 流水线（不带 hash） | 剪辑室：7 个工位一条传送带，一盘胶片一条视频；红 = 等你，黄 = 卡住。底部「N 件在等你」 |
| 视频详情 `#card-<id>` | 一张卡的全部：打分、素材、样片关卡、各平台数据和对比、DOU+ 判断、记录 |
| 选题池 `#pool` | 灵感 · 候选 · 已定 · 必拍 · 搁置五档，上周复盘要改的放最上面；候选等用户定这周拍哪几条 |
| 复盘 `#review`、`#review-<周>` | 本周数据、最好最差、规律、下周改什么、本周归档了什么 |

所有规则（卡住、到点采样、DOU+ 建议、平台对比、归档候选、相似选题、等你、工位排队、胶片上的短状态、agent 待办）都只在 `scripts/build-index.mjs` 里算。agent 不手算这些，只改源文件，然后跑脚本看结果。

## 2. 目录：哪些能改

| 路径 | agent 能不能改 |
| --- | --- |
| `cards/active/<id>.json` | 能。一张卡一个文件 |
| `cards/archive/<年>/<id>.json` | 能，但只做「挪进来 / 挪回去」，不删 |
| `reviews/<年>-W<周>.json` | 能。一周一份 |
| `config.json` | 能，但只在用户要求改阈值、平台时改 |
| `adapters/<平台>/` | 发现后台实际情况和说明不一致时可以改，提交信息写清楚 |
| `schema/` | 不能手改。字段要变先问用户 |
| `scripts/`、`tests/` | 只在用户要求改规则或修脚本时改，改完 `node tests/run.mjs` 要全过 |
| `index.json`、`index.archive.json` | 永远不手改、不提交。它们是脚本产物，已在 `.gitignore` |
| `site/` | 页面代码。只在用户要求改界面时改；改完 `node scripts/build-site.mjs` 能生成、`node tests/run.mjs` 要全过。`site/vendor/` 是第三方库原样拷贝，不改 |
| `dist/` | 构建产物，不提交（已在 `.gitignore`） |
| `functions/` | Cloudflare Pages 的服务器函数（`/api/act`）。同 `scripts/`，只在用户要求时改 |

卡的 id = 创建日期 + 英文短名，如 `2026-11-02-squat-form`，只用小写英文、数字和连字符，文件名就是 `<id>.json`。归档时换目录不换名。

卡的编号 `no` 是页面上胶片的号码：建卡时取所有卡（`cards/active/` 和 `cards/archive/` 全部）里最大的 `no` 再加 1，之后永远不改、不复用。`short_title` 是胶片头顶牌子上的短名，最多 6 个字，如「饮食」「Agent」。

## 3. 字段字典

完整定义在 `schema/card.schema.json`、`schema/review.schema.json`、`schema/config.schema.json`、`schema/adapter.schema.json`，每个字段的 description 就是说明。这里只列容易写错的：

- **所有字段都要写**，没有值就写 `null` 或 `[]`，不能省略键；也不能加 schema 里没有的键。唯一的例外是 `douplus.top_up_declined_at`：只有网页上点了「不加投」才会出现。
- **枚举**：
  - `kind`：`ai_talk` 口播 · `fitness` 健身 · `other` 其他（要换成自己的类型，改 `schema/card.schema.json` 里的枚举和 `site/app.js` 的 `KIND_NAME`）
  - `source`：`own_use` · `trend_douyin` · `trend_x` · `comment`
  - `tier`：`idea` 灵感 · `candidate` 候选 · `decided` 已定 · `must` 必拍 · `shelved` 搁置
  - `stage`：`topic` → `script` → `record` → `edit` → `sample_gate` → `publish` → `data` → `reviewed`
  - `samples[].point`：`h10` · `d3` · `d7` · `douplus_h12`；`samples[].source`：`api` · `browser` · `manual`
  - `sample_gate.result`：`pending` · `pass` · `fail`；`scores.*.score`：`0` · `1` · `2`
  - 平台 id：`douyin` · `xiaohongshu` · `x` · `youtube` · `bilibili`
- **比率存小数**：45% 写 `0.45`。计数写整数：1.2 万写 `12000`。
- **时间必须带时区**：`2026-11-06T19:00:00+08:00`。取当前时间用 `node scripts/now.mjs`，当前 ISO 周用 `node scripts/now.mjs --week`。
- **平台没有的指标不写键**，不写 0。适配器 `adapters/<平台>/adapter.json` 的 `metrics` 里有、但这次没读到的，写进 `missing`；不在适配器里的，既不写键也不进 `missing`。
- **JSON 里不能有注释和尾逗号**。用两个空格缩进、文件末尾留一个换行；对象写一行还是展开成多行都行，脚本不看格式。
- **条件必填**（schema 会拦）：`must` 要有 `deadline` 和 `why`；`decided` 要有 `conclusion`、`kind`、`plan_week`；`shelved` 要有 `shelved_reason`；`candidate` 四道筛都要有 `{score, why}`；`idea` 和 `candidate` 的 `stage` 固定 `topic`；进 `publish` 及之后 `sample_gate.result` 要是 `pass`（除非 `skipped` 里有 `sample_gate`）；进 `data` 要至少一条发布记录。
- 同一张卡每个平台只能有一条发布记录；非抖音的 `douplus` 写 `null`。
- `notes[]` 每条是 `{at, by, text}`，`at` 也带时区，`by` 写 `user` 或你的 agent 名。
- `next_action`：这张卡下一步做什么，胶片上没有别的状态时显示它。`{ "who": "agent" | "user", "text": "一句话", "sub": "补充，可为 null" }`，没想好写 `null`。
- `ask`：agent 要用户回一句话时写，见第 4 节。没在问就写 `null`。
- `blocked_on`：只写「在等时间或外部、不用用户回」的事，如「等周三晚上发」。要用户回答的不写这里，写 `ask`。

## 4. 只有用户能拍板的

只有两类，用户没明确说之前不写：

1. **定下哪条选题拍**：把 `tier` 改成 `decided` 或 `must`，`tier_decided_by` 写 `user`。用户只说了「拍这条」、没说哪周发时，`plan_week` 默认填当前 ISO 周（`node scripts/now.mjs --week`），不去问；用户说了别的周再改。具体字段见 5.3。
2. **DOU+ 投不投、投多少**：`publications[].douplus` 里的 `decision`、`amount`、`ordered_at`、`top_up`，`decided_by` 写 `user`。

其余判断 agent 直接做，不用问：样片过没过、灵感升候选、四道筛打分、搁置、归档、合并、复盘的规律和下周改什么。自己判断的写 `decided_by: "agent"` / `scored_by: "agent"` / `tier_decided_by: "agent"`。

拿不准就**不猜**，在这张卡写 `ask`，它会出现在流水线底部「等你」里，胶片变红：

```json
"ask": {
  "question": "开头用哪个案例",
  "context": "两个案例都录了，A 更短，B 更有冲突",
  "options": ["用 A", "用 B"],
  "if_no_answer": "用 A，然后继续剪",
  "asked_at": "2026-11-08T22:00:00+08:00",
  "default_at": "2026-11-09T22:00:00+08:00"
}
```

- `question` 最多 16 个字；`options` 1–3 个，写成用户点一下就能回答的短句（最多 20 个字）；`context` 一句背景，没有写 `null`。
- 用户在网页上点了选项，服务器当场改卡（5.9），不等 agent。所以**选项能直接写明「选了改什么」**：写成 `{ "label": "这周必拍", "set": { ... } }`，`set` 里只能放 `tier`（只能是 `decided` / `must` / `shelved`）、`plan_week`、`deadline`、`why`、`conclusion`、`kind`、`shelved_reason`、`blocked_on`、`next_action`，值写死（截止时间写具体时刻，不写「两周后」），改完的卡要能过 schema（比如改成 `must` 要同时带 `deadline`、`why`，卡上没有 `kind` 的还要带 `kind`），过不了服务器就不写、页面报错。改不了的事（换素材、改文案）写成一句话的选项就行：用户点了，服务器把 `ask` 收起来、`notes` 记一条「网页上回答「问题」：选项」、`next_action` 改成「照你选的「选项」接着做」，agent 下次开工照着做（5.9）。
- `if_no_answer` 必须写：用户不回时 agent 照做的默认动作，要具体到能直接执行。
- `asked_at` 写当前时间；`default_at` = `asked_at` + `config.json` 的 `ask.default_hours`（现在是 24）小时。
- 用户回答了：照做，`ask` 改回 `null`，`notes` 记一条用户选了什么。
- 到了 `default_at` 用户还没回（`index.json` 的 `asks[].past_default` 是 `true`，agent 待办里出现 `ask_default_due`）：照 `if_no_answer` 做，`ask` 改回 `null`，`notes` 记一条「没等到回复，按默认：…」。
- 第 4 节那两类（定选题、DOU+）不写 `ask`：脚本会自己把它们放进「等你」，默认永远是不做。
- 一张卡同一时间只挂一个 `ask`。归档前要先把 `ask` 处理掉。

原则：不需要用户参与的不问。

## 5. 常见任务

每个任务做完都要走第 6 节的收尾。下面「改哪些字段」不含 `last_touched`，它每次都要改。

「把卡往前推」分两种，看卡在哪一档：

| 卡现在是 | 往前推是指 | 谁能做 | 见 |
| --- | --- | --- | --- |
| `idea` 灵感 | 打四道筛，升 `candidate` | agent 直接做 | 5.2 |
| `candidate` 候选 | 升 `decided` / `must` | 只有用户说了才写 | 第 4 节、5.3 |
| `decided` / `must` | `stage` 往前走一格 | agent 直接做 | 5.4 |
| `shelved` 搁置 | 恢复到原来的档位 | 恢复到 `idea` / `candidate` agent 可做；恢复到 `decided` / `must` 要用户说 | — |

### 5.1 记一个灵感

1. 先查相似选题：跑 `node scripts/build-index.mjs`，看 `index.json` 里 `cards[].title` / `conclusion`，以及 `archive_candidates`、`index.archive.json`。明显是同一个题就不新建，在那张卡的 `notes` 加一条；拿不准就新建，脚本会在 `derived.similar` 里标出来。
2. 新建 `cards/active/<今天日期>-<英文短名>.json`，从下面的模板复制，填 `title`、`short_title`、`source`，有就填 `conclusion`、`why`、`kind`。`no` 取所有卡里最大的 `no` 加 1（见第 2 节）。`tier_since`、`stage_since`、`last_touched` 都写当前时间。

```json
{
  "schema_version": 2,
  "id": "2026-11-09-example-idea",
  "no": 14,
  "short_title": "示例",
  "title": "一句话写清这个选题",
  "conclusion": null,
  "kind": null,
  "source": "own_use",
  "tier": "idea",
  "tier_since": "2026-11-09T09:00:00+08:00",
  "tier_decided_by": "agent",
  "stage": "topic",
  "stage_since": "2026-11-09T09:00:00+08:00",
  "last_touched": "2026-11-09T09:00:00+08:00",
  "blocked_on": null,
  "next_action": null,
  "ask": null,
  "skipped": [],
  "plan_week": null,
  "deadline": null,
  "shelved_reason": null,
  "why": null,
  "scores": { "takeaway": null, "evidence": null, "framework": null, "search": null, "scored_by": null },
  "assets": { "script_doc": null, "script_version": null, "record_version": null, "local_project": null, "edit_version": null },
  "sample_gate": { "result": "pending", "note": null, "decided_by": null },
  "publications": [],
  "notes": [],
  "archived_at": null,
  "archive_reason": null,
  "merged_into": null
}
```

### 5.2 给候选打四道筛（灵感 → 候选）

灵感要往前推，下一步就是打分升候选（agent 可以直接做；升「已定」只有用户能定）。

- `scores.takeaway` / `evidence` / `framework` / `search`：各写 `{ "score": 0|1|2, "why": "一句理由" }`。四道筛的含义和 0/1/2 的标准在 `config.json` 的 `scoring.screens[].description`，照它打，理由里写出依据。
- `scores.scored_by`：`"agent"`（用户改过分就写 `"user"`）。
- `tier`：`"candidate"`；`tier_since`：当前时间；`tier_decided_by`：`"agent"`。
- 没有结论的顺手补 `conclusion`；`stage` 保持 `"topic"`。
- 最新定稿复盘的 `next_week`（`index.json` 的 `latest_next_week`）要改打分做法时，照着打。

### 5.3 用户定下选题之后（候选 → 已定 / 必拍）

只在用户明确说了「拍这条」之后做：

- `tier`：`"decided"`（用户说有外部截止就是 `"must"`）；`tier_since`：当前时间；`tier_decided_by`：`"user"`。
- `plan_week`：用户说了哪周就填哪周；没说就填当前 ISO 周（`node scripts/now.mjs --week`），不去问用户。
- `conclusion`、`kind` 没写的 agent 补上（这是 schema 对已定卡的要求，不算替用户拍板）。
- `must` 还要 `deadline`（用户说的截止时间，带时区）和 `why`（为什么必须赶）；用户没说截止时间就用 `ask` 问（第 4 节），`if_no_answer` 写「先按已定排，不当必拍」，截止时间拿到前 `tier` 先写 `decided`。
- `stage` 保持 `"topic"`，之后按 5.4 往前推。

### 5.4 推进阶段

只对 `tier` 是 `decided` 或 `must` 的卡。

- `stage` 只能往前走一格：`topic → script → record → edit → sample_gate → publish → data → reviewed`。要跳过的格（如健身视频不写文案）先写进 `skipped`，再跳。`skipped` 只能放 `script`、`record`、`edit`、`sample_gate`。
- 改 `stage` 必须同时改 `stage_since` 为当前时间。脚本会拿上一个提交比，跳格、忘改 `stage_since` 都会报错。
- 往回只允许一种：样片没过，`sample_gate` → `edit`（或 `record`），同时 `sample_gate` 写 `{ "result": "fail", "note": "为什么", "decided_by": "agent" }`，并在 `notes` 加一条原因。
- 每一格顺手补对应字段：`script` 填 `assets.script_doc` / `script_version`；`record` 填 `assets.record_version`；`edit` 填 `assets.local_project` / `edit_version`；`sample_gate` 审片后写 `sample_gate.result` / `note` / `decided_by`，过了才能进 `publish`；进 `data` 前先录发布记录（5.5）。
- 进 `reviewed` 要求：所有必录平台（`config.json` 里 `required: true` 的平台，默认是抖音、小红书、X）的 `d7` 都录了，并且有一份周复盘的 `cards` 引用了这张卡。

### 5.5 录发布记录

每发一个平台，在 `publications` 加一项：

```json
{ "platform": "douyin", "url": "https://...", "post_id": "...", "published_at": "2026-11-06T19:00:00+08:00", "title": "发布标题", "samples": [],
  "douplus": { "decision": null, "amount": null, "ordered_at": null, "top_up": null, "decided_by": null } }
```

非抖音平台 `douplus` 写 `null`。`config.json` 里 `required: true` 的平台每条都要发并录（默认抖音、小红书、X），其余平台（默认 YouTube、B 站）发了才录。录完第一条发布记录、卡在 `publish` 时，把 `stage` 推到 `data`。

### 5.6 采一次数据

只在用户说「电脑开着」之后做，不跑定时任务。

1. 跑 `node scripts/build-index.mjs`，在 `index.json` 里找到点和逾期的采样：`today`（agent 待办）里 `kind` 是 `sample_due` 的项，或各卡 `next_samples` 里 `status` 是 `due` / `overdue` 的项。一次全读完，抖音 h10 最先。`missed` 是补不回来的点（窗口关了又过了一个窗口宽度，或下一个点已经开窗），不读。
2. 按 `adapters/<平台>/steps.md` 用用户的浏览器只读后台，在对应发布记录的 `samples` 加一项：`{ point, taken_at, source: "browser", read_by: "<你的 agent 名>", metrics, missing }`。
3. 读不到的先重试一次，还不行写进 `missing`，不估、不写 0。用户口述或截图补的，`source` 写 `manual`，`read_by` 写 `user`。
4. 抖音 h10 录完后，DOU+ 建议出现在 `cards[].derived.douplus` 和流水线底部「等你」里，等用户拍板，agent 不下单。

### 5.7 起草周复盘

每周日写 `reviews/<年>-W<周>.json`（周号用 `node scripts/now.mjs --week`）。

- `cards`：本周发布的卡 id；`best` / `worst`：各 `{card, why}`。
- `patterns`：1–3 条 `{text, cards}`，每条 `text` 必须引用具体数字（如「2s 跳出 38%，比平时低 4 个点」），数字从卡和 `index.json` 的 `derived.compare` 里取，不抄进复盘文件。
- `next_week`：下周改什么，1–3 条字符串的数组，每条一句话。草稿可以先写 `[]`，定稿至少一条。
- `archived`：本周归档和合并的卡（5.8）。
- `updated_at`、`written_by`。数据和结论都写完就把 `status` 标 `final`，不用等用户点头；用户想改再改。

### 5.8 按规则归档和合并

照 `index.json` 的 `archive_candidates` 做，`due: true` 的直接归档，不用问：

- 把文件从 `cards/active/` **挪到** `cards/archive/<年>/`（如 `git mv`），文件名不变，不删任何文件。
- 写 `archived_at`（当前时间）和 `archive_reason`：`idea_30d` · `shelved_60d` · `done` · `merged`。
- 合并：新灵感和已有卡确实是一回事时，目标卡 `notes` 加一条「合并了 <源卡 id>：<源卡标题和要点>」，源卡写 `merged_into: "<目标卡 id>"`、`archive_reason: "merged"` 后归档。拿不准是不是一回事，在源卡写 `ask` 问用户（第 4 节），`if_no_answer` 写「不合并，两张都留着」。
- 写进当周复盘的 `archived`：`{ "card": "<id>", "reason": "...", "merged_into": "..."(合并时), "note": "..."(可选) }`。当周复盘还没有就先建一份 `status: "draft"` 的。
- 撤回：用户说要回来，就把文件挪回 `cards/active/`，`archived_at`、`archive_reason`、`merged_into` 改回 `null`。

### 5.9 网页上点过的按钮

网页上的按钮由服务器直接改卡，agent 不用再「处理」什么；agent 要做的只是**接着干**。网页上点的是**用户本人的决定**（页面有登录保护，只有用户能点），和在对话里说的一样算数。但第 8 节的禁止照旧：网页上点了也不能让 agent 下单、发布、往外发东西或写凭据。

每个按钮改了什么（`scripts/lib/actions.mjs`，`notes` 都会记一条 `by: "user"` 的「网页上…」）：

| 按钮 | 服务器改了什么 | agent 接着做什么 |
| --- | --- | --- |
| 回答 `ask` | 选项带 `set` 的照 `set` 改；`ask` 改 `null`；没在 `set` 里写 `next_action` 的，`next_action` 改成「照你选的「…」接着做」 | 一句话的选项：照用户选的做，做完把 `next_action` 改成真正的下一步 |
| 定了，这周拍 | 候选 → `decided`，`plan_week` 没写就填当周（缺结论或类型的按钮是灰的，服务器也不收） | 按 5.4 开始写文案 |
| 搁置 | `tier: "shelved"`，`shelved_reason` 是用户原话（页面上只在候选上显示；服务器只接受还在选题阶段的卡，已开拍的不收） | 不用做 |
| DOU+ | 抖音发布记录的 `douplus`：投 / 不投写 `decision`，下单了写 `ordered_at`，加投写 `top_up`，不加投写 `top_up_declined_at` | 不用做；DOU+ 永远是用户自己下单 |
| 记灵感 | 新建一张 `tier: "idea"` 的卡：标题是用户原话，`short_title` 自动截前 6 个字，id 是 `<日期>-idea-<4 位随机>` | 按 5.1 查重、打四道筛；短名不好就改（id 不改） |
| 挪回来 | 归档的卡挪回 `cards/active/`，`archived_at`、`archive_reason` 改 `null`（并过的卡不能挪） | 看要不要重新排 |

agent 每次开工 `git pull --rebase` 后看一眼 `git log --oneline -20`：`[web]` 开头的提交是用户在网页上点的，你上次之后新出现的，挨个看那张卡的 `next_action`，是 agent 的就接着做。

服务器写之前会对一下：问题已经换了、按钮已经点过、卡已经归档了，都不写，页面叫用户刷新。所以 agent 改卡时也照常改，不用怕和网页冲突；推送被拒就 `git pull --rebase` 再推（第 7 节）。

### 5.10 定时运行（配了定时任务时）

定时运行每次开一个新会话，没有人在旁边，按这个顺序做，做完就停：

1. `git pull --rebase`，读本文件和 `README.md`。
2. 跑 `node scripts/build-index.mjs`，看 `today`。
3. 看网页上新点过的（5.9），`next_action` 是 agent 的接着做。
4. 过了 `default_at` 的 `ask`（`ask_default_due`）照 `if_no_answer` 做（第 4 节）。
5. 周日：写本周复盘草稿（5.7）。
6. 跑 `node scripts/build-index.mjs` 和 `node tests/run.mjs` 确认都过，推送 `main`。网站会自己重新生成。
7. 有改动才汇报，一两句话说做了什么、有什么要用户回的；没改动就不出声。

定时运行不做的：读平台后台（要用户的浏览器，见 5.6）、登录任何网站、建或改任何密钥、下单、发布、往外发消息。要用户回的，写成卡上的 `ask`，它会出现在网页「等你」里，用户在网页上点一下就回了。

## 6. 每次写完必做

1. 改过的每张卡都把 `last_touched` 更新为当前时间（`node scripts/now.mjs`）。脚本会拿上一个提交比，改了卡没改 `last_touched` 会报错。顺手把 `next_action` 改成这张卡现在的下一步。
2. 跑 `node scripts/build-index.mjs`。它会报出哪个文件、哪个字段错了；有错就改到通过为止，通过前不提交。
3. 只提交源文件（`cards/`、`reviews/`、`config.json` 等），不提交 `index.json`、`index.archive.json`。
4. 提交信息：`[<agent 名>] <动作>: <卡 id>`。agent 名是你自己的固定简称（小写英文加连字符），同一个 agent 每次都用同一个，方便用户在历史里认出是谁改的。例如 `[agent-a] 新建灵感: 2026-11-09-example-idea`、`[agent-a] 推进到 edit: 2026-10-28-prompt-checklist`、`[agent-b] 采样 h10: 2026-10-27-daily-agent`。一次动了多张卡，id 用逗号隔开；只动复盘写周号。
5. 一次做了几步（如新建灵感再升候选）：每一步各跑一次 build-index、各提交一次。阶段流转是和上一个提交比的，分开提交历史最清楚，阶段时间线也准。
6. 改了 `scripts/` 或 `schema/`（经用户同意）时，另外跑 `node tests/run.mjs`，全过才提交。

## 7. 并发

几个 agent 可能同时写这个仓库。

- 动手前先拉最新（`git pull --rebase`），写完马上提交并推送，别攒着。用户在网页上点按钮也会随时往 `main` 提交（`[web]` 开头），推送被拒就再 `git pull --rebase` 一次。
- 冲突时两边的改动都保留：同一张卡不同字段的改动合在一起；同一字段两边都改了，以时间更晚的为准，并在 `notes` 记一条。合完重跑 build-index，通过再推。
- 不确定怎么合，就停下来问用户，不强推、不覆盖别人的提交。
- 仓库没有配远端，或用户这次说了不要推送：只在本地提交，最后告诉用户「已本地提交、没推送」。

## 8. 禁止

- 删任何文件（卡、复盘、适配器都不删；归档是挪）。
- 改只有用户能拍板的字段（第 4 节）而用户没明确说过。
- 在仓库里写账号、密码、验证码、cookie、token、密钥或任何凭据，包括写进 `notes`、`blocked_on`、适配器说明和提交信息。
- 自动发布视频或帖子。
- 自动下 DOU+ 单、加投、续投。
- 在任何平台后台做只读以外的操作：不点发布、删除、编辑、回复、置顶、推广、投放、充值、改设置、授权。
- 手改或提交 `index.json`、`index.archive.json`；为了让校验通过去改 `schema/` 或 `scripts/`。

## 9. 平台采集

见 `adapters/README.md`（所有平台通用的只读规则）和每个平台的 `adapters/<平台>/steps.md`（去哪个页面、读哪几个数、对应哪个字段）。`adapters/<平台>/adapter.json` 列出这个平台能读的指标，脚本会按它检查 `metrics` 和 `missing`。v1 全是浏览器只读，不接官方接口。
