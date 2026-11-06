# VideoFlows Skills

中文 | [English](#english)

一套给 AI agent（Claude Code 等）用的 skill：一条视频从选题、写稿、定风格、剪映剪辑、发布到数据复盘，整条流程照着跑。看板管「每条视频到哪一步」，skill 管「每一步怎么做」，两样是一套。

## 流程和确认点

| 阶段 | skill | 人要点头的地方 |
|---|---|---|
| 选题 | `videoflows-topic` | G1 定哪条拍 |
| 写稿 | `videoflows-script` | G2 终稿 |
| 定风格 | `videoflows-style` | G3 选方向、G4 7–10 秒样片 |
| 剪辑 | `videoflows-edit` | 每段草稿、G5 样片 / 成片 |
| 发布 | `videoflows-publish` | G6 选封面、G7 你自己点发布 |
| 数据 | `videoflows-data` | G8 花钱投放、G9 发评论回复 |

总入口是 `videoflows`：它看看板上每张卡在哪一步，调对应的 skill，做到确认点就停下来问你。确认点之外不问。agent 永远不替你发布、下单、花钱、发评论。

## 安装

1. 把这个仓库当看板用（见仓库根目录 `README.md`）。
2. 把 `skills/` 下的目录拷到或软链到 `~/.claude/skills/`（只在本仓库里用的话，放到仓库的 `.claude/skills/`）：

   ```bash
   mkdir -p ~/.claude/skills
   for d in skills/videoflows*; do ln -s "$PWD/$d" ~/.claude/skills/; done
   ```

3. 写你的私人档案：复制 `skills/videoflows/templates/profile.example.md` 到 `~/.videoflows/profile.md` 再改。档案只放在你自己电脑上。
4. 剪映部分：按 `skills/videoflows-edit/jianying-editor/README.md` 装好环境。需要剪映专业版；用会员素材要你自己的剪映会员。
5. 去 AI 味（可选，推荐）：另外安装 [lieflat-less-ai-tone](https://github.com/larashero3-dotcom/lieflat-less-ai-tone)。它是 CC BY-NC 4.0（署名、非商业），所以没有放进本仓库，只在写稿时调用。

然后对 agent 说「用 videoflows 看看下一步做什么」。

## 致谢

- 剪映草稿生成：[jianying-editor-skill](https://github.com/luoluoluo22/jianying-editor-skill)（luoluoluo22，MIT；2026-11 起这个地址打不开，本仓库带的是它 `32c5692` 提交的副本，许可证原文见 `skills/videoflows-edit/jianying-editor/LICENSE`），以及它内嵌的 [pyJianYingDraft](https://github.com/GuanYixuan/pyJianYingDraft)（GuanYixuan，Apache-2.0）。本仓库带的是改良版，改动见 `skills/videoflows-edit/jianying-editor/CHANGES.md`。
- 去 AI 味：[lieflat-less-ai-tone](https://github.com/larashero3-dotcom/lieflat-less-ai-tone)（shiujan，CC BY-NC 4.0），外部依赖。
- 「给剪辑写镜头表」「把意见写成规矩」的做法受 YouTube 频道 Render with me《I Stopped Editing My Videos. Claude Does It Now (Full Workflow)》启发。

## 许可证

本目录按仓库的 MIT 许可证发布；`skills/videoflows-edit/jianying-editor/scripts/vendor/pyJianYingDraft/` 保留它自己的 Apache-2.0 许可证。

---

## English

A set of agent skills (for Claude Code and similar agents) that run one video end to end: topic, script, visual style, editing in JianYing (剪映 / CapCut desktop, Chinese version), publishing, and data review. The VideoFlows board tracks where each video is; the skills say how to do each step.

| Stage | Skill | Human sign-off |
|---|---|---|
| Topic | `videoflows-topic` | G1 pick what to shoot |
| Script | `videoflows-script` | G2 final script |
| Style | `videoflows-style` | G3 pick a direction, G4 7–10 s sample |
| Edit | `videoflows-edit` | each draft segment, G5 sample / final cut |
| Publish | `videoflows-publish` | G6 cover, G7 you press Publish |
| Data | `videoflows-data` | G8 any paid promotion, G9 comment replies |

Start with `videoflows`: it reads the board, picks the right skill for each card, and stops at each sign-off. The agent never publishes, pays, places ads or posts comments for you.

**Install**: symlink `skills/videoflows*` into `~/.claude/skills/`, copy `skills/videoflows/templates/profile.example.md` to `~/.videoflows/profile.md` and fill it in (keep it private), set up `skills/videoflows-edit/jianying-editor/` per its README, and optionally install [lieflat-less-ai-tone](https://github.com/larashero3-dotcom/lieflat-less-ai-tone) (CC BY-NC 4.0, not bundled).

**Credits**: [jianying-editor-skill](https://github.com/luoluoluo22/jianying-editor-skill) by luoluoluo22 (MIT; the link has been unreachable since 2026-11, the bundled copy is from upstream commit `32c5692` with its LICENSE kept) and [pyJianYingDraft](https://github.com/GuanYixuan/pyJianYingDraft) by GuanYixuan (Apache-2.0), bundled here in modified form; [lieflat-less-ai-tone](https://github.com/larashero3-dotcom/lieflat-less-ai-tone) by shiujan (CC BY-NC 4.0), external; shot-list and editing-rulebook ideas from the Render with me YouTube channel.

**License**: MIT, as the rest of the repo; `skills/videoflows-edit/jianying-editor/scripts/vendor/pyJianYingDraft/` keeps its own Apache-2.0 license.
