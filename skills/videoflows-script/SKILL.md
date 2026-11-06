---
name: videoflows-script
description: Use when fact-checking claims for a video, writing or revising a talking-head (口播) script, removing AI tone from a Chinese script, building a shot list (镜头表/分镜), or preparing a recording checklist for a VideoFlows card in the script or record stage.
---

# VideoFlows 写稿

## 概览

从选题结论到能录的终稿和镜头表。**终稿要用户点头（G2）**；录制由用户自己录。

## 步骤

1. **口吻**：读私人档案的「口吻」。没有的话，请用户给两三期自己录过的稿子或字幕，总结成档案里的口吻一节（开头、列举、口语词、别写的句式、结尾），写进档案，不写进仓库。
2. **核查**（写稿前）：稿子要用的每个数字、引语、产品说法找原始出处（论文、官方公告、原帖），写进 `research.md`：说法 → 出处链接 → 准确说法。没核实的标【待确认】，不进成片。和用户工作有关的只用公开信息。借来的方法记下作者，后面要给出处。
3. **写稿** `script-v1.md`：按 `references/script-checklist.md` 写；沿用 `research.md` 和 `brief.md` 的结论，不另起炉灶。用户给了开头原句的原样保留。
4. **去 AI 味**：用 lieflat-less-ai-tone（需要单独安装，见仓库 `skills/README.md`）：跑检测 → 照建议改 → 再测，交稿时给用户改前改后对照。没装就按 `references/script-checklist.md` 第二节逐句自查，并告诉用户没跑工具。
5. **交稿，停在 G2**：给用户整份稿子、改动对照和【待确认】清单。用户提意见先复述要改成什么，对齐再改；新版另存 `script-vN.md`。用户说定了，终稿版本写进卡 `assets.script_version`；稿子有在线文档链接的写 `assets.script_doc`，没有写 `null`。
6. **镜头表和录制清单**：终稿后写 `shotlist-vN.md`，每句一行：`段 | 口播原句 | 画面 | 画面来源 | 为什么配这个画面`。画面来源只用：真人出镜、录屏（编号 R）、动效（编号 M）、剪映素材、生成图。附录制清单：每条录什么、机位和构图（等风格定了按 `style/style.md` 写人在画面哪边、留白在哪）、要关的通知和要打码的东西。风格还没定就先去 `videoflows-style`。
7. **推进卡**：终稿和风格样片（`videoflows-style` 的 G4）都定了，卡推到 `record`；用户说素材录好、放进 `footage/` 了，推到 `edit`，`assets.record_version` 写录音稿版本。

## 常见错误

| 错 | 对 |
|---|---|
| 为了顺嘴编个数字 | 标【待确认】，交稿时列出来 |
| 核查结论没进稿子 | 稿子里每个事实都能在 `research.md` 找到 |
| 去 AI 味后直接覆盖原稿 | 另存新版，给前后对照 |
| 镜头表只写画面不写理由 | 每个画面写它支持哪句话、为什么 |
