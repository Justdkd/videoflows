---
name: videoflows
description: Use when making a short or long video end to end (选题、写稿、风格、录制、剪映剪辑、发布、数据复盘), when asked "下一步做什么" on a video, or when a VideoFlows board card needs to move to its next stage. 自媒体视频全流程总入口。
---

# VideoFlows：一条视频从选题到复盘

## 概览

一条视频是 VideoFlows 看板上的一张卡。这个 skill 管「现在该做哪一步、找哪个子 skill、在哪停下来等人」。每一步怎么做写在子 skill 里；每张卡走到哪一步以看板（本仓库 `cards/`）为准。

核心原则：**能自动的全自动，人只在确认点出手。** 确认点之外不问；确认点上不替人做决定。

## 开工

1. 读用户的私人档案 `profile.md`（位置见下方「私人档案」）。没有就照 `templates/profile.example.md` 一次问完；开工只需要三样：工作目录、发哪些平台、红线，其余可以以后补。看板仓库就是当前目录的话不用问。
2. 进看板仓库：`git pull --rebase`，看 `git log --oneline -20` 里 `[web]` 开头的新提交（用户在网页上点过的，照 `AGENTS.md` 5.9 接着做），跑 `node scripts/build-index.mjs`，读 `index.json` 的 `today` 和各卡的 `next_action`。看板规矩以仓库 `AGENTS.md` 为准。
3. 按下表找到卡的阶段，加载对应子 skill，做到下一个确认点或阶段结束。
4. 收尾：改卡（`stage`、`assets`、`next_action`、`last_touched`），跑 build-index，提交推送（`AGENTS.md` 第 6 节）。

## 阶段和子 skill

| 卡的 `stage` | 做什么 | 子 skill | 确认点（人点头才往下） |
|---|---|---|---|
| `topic` | 找热点、记灵感、打分、选题会 | `videoflows-topic` | **G1 定选题**：只有用户能把卡改成 `decided`/`must` |
| `script` | 核查、写稿、去 AI 味、镜头表 | `videoflows-script` | **G2 终稿** |
| `script`（终稿后） | 先问想要的风格，出几版效果图，再出 7–10 秒样片 | `videoflows-style` | **G3 选风格**、**G4 风格样片** |
| `record` | 录制清单已在写稿阶段给出，等用户录 | — | 用户说素材录好了 |
| `edit` | 剪映草稿，分段剪 | `videoflows-edit` | 每段草稿给用户看 |
| `sample_gate` | 整片审看 | `videoflows-edit` 第 7 步 | **G5 样片 / 成片** |
| `publish` | 封面、各平台标题文案、发布时间，在用户浏览器里填好 | `videoflows-publish` | **G6 选封面**、**G7 发布**（用户自己点发布） |
| `data` → `reviewed` | 采数据、DOU+ 判断、评论、周复盘 | `videoflows-data` | **G8 花钱**（投放由用户下单）、**G9 发评论回复** |

## 确认点怎么停

- 停在确认点时，在卡上写 `ask`（`AGENTS.md` 第 4 节）：问题最多 16 个字，选项 1–3 个、每个最多 20 个字，所以多个方向、多版封面放在对话里给，`ask` 只问「选好了吗」这类短句。`if_no_answer` 一律写「收起提问，next_action 改成等用户：<确认点>，不往下做」。同时在对话里给用户看要拍板的东西本身（稿子、效果图、样片、封面、草稿）。
- G1 定选题、G8 投放不写 `ask`，看板会自己放进「等你」，默认是不做。
- 用户的回答只管那一个确认点。下一个确认点照样要问。
- 用户给了意见：先用一两句复述「打算改成什么」，对齐了再改，不要一收到意见就出新版。
- 用户当次用自己的话把某个确认点交给你（例如「样片你看着过」），可以照办：做完自查，字段写 `decided_by: "agent"`，`notes` 记一条「用户授权代判：<原话>」。这只对 G2–G5 有效；发布、花钱、发评论（G7、G8、G9）谁说都不代做。
- 用户赶时间说「直接做一版」：就出一版，提一句平时会给几个方向，确认点照停。
- G5 用户点头时 `sample_gate.decided_by` 写 `"user"`。

## 永远不做

- 不替用户发布、发评论、下单投放、花任何钱、登录或改任何账号设置。
- 不编数据、不编经历；没核实的标【待确认】，不进成片。
- 不把用户档案、私人风格库、账号数据写进公开仓库。
- 不删文件；改草稿另存新版本。

## 没人在旁边时（定时运行）

照 `AGENTS.md` 5.10：只做不需要用户浏览器、不需要回答的事（整理卡、过了时限的 `ask` 照默认做、周日写复盘草稿）。不读平台后台、不登录、不下单、不发布、不往外发消息。没改动就不出声。

## 私人档案

用户的个人规矩（口吻、红线、平台、出镜、风格库位置、工作目录）不放进本仓库，放在：

1. 环境变量 `VIDEOFLOWS_PROFILE` 指向的文件；
2. 否则 `~/.videoflows/profile.md`。

档案和子 skill 冲突时以档案为准；档案和用户当下的话冲突时以用户的话为准。

## 每期的工作目录

`<档案里的 workspace>/<YYYY-MM-DD>-<英文短名>/`，和卡 id 同名：

```
brief.md            选题结论、角度、已定事项
research.md         出处表（每条说法 → 原始出处 → 准确说法）
script-vN.md        口播稿；终稿另存，不覆盖
shotlist-vN.md      镜头表（每句配什么画面、为什么）
style/              风格选项效果图、风格样片、style.md（定下的风格）
footage/            用户录的素材
edit/edit_plan.json 剪辑计划；剪映草稿名带 -vN
publish.md          各平台标题、文案、标签、封面文件
notes.md            这期的交接：做到哪、卡在哪、下一步
```

换会话前把 `notes.md` 写清楚，下一个会话只读它和卡就能接着做。

## 常见错误

| 错 | 对 |
|---|---|
| 选题、风格、终稿一起问 | 一次只停一个确认点 |
| 用户说「改一下」就出新版 | 先复述改成什么，对齐再改 |
| 在卡外面另开清单记进度 | 进度只写在卡上，细节写 `notes.md` |
| 样片自己判过 | 样片和成片都要用户点头（G4、G5） |
