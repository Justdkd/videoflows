---
name: videoflows-edit
description: Use when editing a video into a JianYing / CapCut desktop (剪映专业版) draft - building or revising an edit plan, adding BGM, sound effects, transitions, 花字 or effects inside 剪映, cutting segment by segment, or reviewing a sample before publish, for a VideoFlows card in the edit or sample_gate stage.
---

# VideoFlows 剪辑（剪映草稿）

## 概览

**草稿一定出在剪映里，用户打开剪映就能看到、能手改。** 音频（BGM、音效）、转场、画面特效、文字动画、花字、滤镜：剪映有的都用剪映的。剪映做不了的（3D 动画、定制信息卡、数据动画）用别的工具做成视频片段，再放进草稿。

草稿由本目录下的 `jianying-editor/` 生成：它基于开源的 jianying-editor（MIT）和 pyJianYingDraft（Apache-2.0），加了用剪映自带音频、音效、花字等改动，改了什么见 `jianying-editor/CHANGES.md`。

需要：macOS 或 Windows 上的剪映专业版；用会员素材（会员 BGM、会员音效等）要用户自己的剪映会员。

## 步骤

1. **读输入**：`script-vN.md`（终稿）、`shotlist-vN.md`、`style/style.md`、`footage/`、私人档案的成片规格和剪辑偏好，以及 `references/edit-baseline.md`、`references/jianying-capabilities.md`。
2. **素材体检**：用 ffprobe 看每条素材的分辨率、帧率、编码。非 H.264 / yuv420p 的先统一转码，**保持原始分辨率和方向**（竖屏别被转成横屏加黑边）。口播先转写出带时间的字幕（以录音为准，不以稿子为准）。
3. **定制画面**：按 `style/style.md` 把剪映做不了的片段（M 编号）渲染成视频文件，放 `edit/assets/`，规格和成片一致。
4. **写 `edit/edit_plan.json`**：时间线上每个片段、字幕、BGM、音效、转场、特效、花字都写进去，格式见 `jianying-editor/docs/edit-plan.md`。
5. **分段生成草稿**：一段一段来（开头 → 每个章节 → 结尾），每段生成新草稿版本 `<卡 id>-vN`：

   ```bash
   PY=<仓库>/skills/videoflows-edit/jianying-editor/.venv/bin/python   # Python 3.12，安装见 jianying-editor/README.md
   R=<仓库>/skills/videoflows-edit/jianying-editor/scripts/rebuild.py
   cd <这期工作目录>/edit                               # edit_plan.json 所在目录
   "$PY" "$R" validate edit_plan.json
   "$PY" "$R" build edit_plan.json                      # 第一版
   "$PY" "$R" build edit_plan.json --hand-edited no     # 之后每版先问用户手改过没有，改过用 yes 只出改动清单
   ```

   `edit_plan.json` 的 `name` 写 `<卡 id>`，生成的草稿名就是 `<卡 id>-vN`。写之前剪映要完全退出。

   第一段生成后把卡上 `assets.local_project` 写成这期工作目录、`assets.edit_version` 写成草稿版本，之后每段更新版本号。每段做完告诉用户草稿名和这段的时间范围，等他在剪映里看完再做下一段。中间版本用户别手改：意见写回 `edit_plan.json` 再重建；手改只在最后一版做。
6. **自检**：对照 `references/edit-baseline.md` 逐条过；按时间抽帧拼一张联系表看节奏和版式；查草稿里没有临时路径残留。
7. **样片关卡（G5）**：整片拼好后，卡推到 `sample_gate`，告诉用户草稿名、改了什么、验证到哪一层（只查了结构 / 抽帧看过 / 剪映里打开过）。用户点头 `sample_gate` 写 `pass`、`decided_by: "user"`；不过写 `fail` 和原因，退回 `edit`。
8. **导出**：用户在剪映里自己导出成片（按档案规格，例如 4K）。agent 不点导出、不点任何付费按钮。

## 规矩

- 不覆盖已有草稿，改动另存 `-vN+1`。读剪映存过的草稿前先备份整个草稿文件夹；遇到加密草稿不解密，请用户在剪映里打开看。
- 分轨：口播 `AudioTrack`、字幕 `Subtitles`、BGM `BGM_Track`、音效 `SFX_Track`（一个音效一段）。BGM 和音效不放同一轨。改旧草稿沿用旧轨道名。
- 没在 `references/jianying-capabilities.md`「已验证」一栏的效果类别，用之前先做一条最小测试草稿给用户看。类别已验证（例如会员音效）的，同类里换一个具体效果不用另测。
- 剪映里实在没有的音效或素材：用写明可商用的免费素材库，逐条核许可，或请用户提供；放进对应轨道，出处记进 `notes.md`。
- 听不到声音：BGM、音效、音量要用户试听，回复里列出要听的点。
- 剪辑规矩写成文件：用户每提一条剪辑意见，问一句要不要写进档案的剪辑偏好，下期自动照做。

## 常见错误

| 错 | 对 |
|---|---|
| 渲染一个成片 mp4 交差 | 交剪映草稿，用户能改 |
| 音效用代码合成后塞进草稿 | 先用剪映自带音效，剪映没有的才另做 |
| 一口气生成整片 | 分段生成，每段让用户看 |
| 竖屏素材被转成 1920×1080 | 转码保持原分辨率和方向 |
