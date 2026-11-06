# 和上游相比改了什么

上游：[jianying-editor-skill](https://github.com/luoluoluo22/jianying-editor-skill) 提交 `32c5692`（2026-09-11），MIT。内嵌的 pyJianYingDraft 在 `scripts/vendor/pyJianYingDraft/`，Apache-2.0。

上游的 `scripts/`、`scripts/vendor/`、`data/`、`docs/`、`rules/`、`references/`、`examples/`、`tools/`、`tests/` 原样拷贝（用 `diff -r` 对比过），只有一处例外：`tests/test_wrapper.py` 的 test_18 原本读上游的演示视频 `assets/video.mp4`，这里不带这个视频，改成没有时用 ffmpeg 现场生成 1 秒测试视频，没有 ffmpeg 就跳过。其余改动都在新增的 `scripts/rebuild.py` 里，运行时补丁也不改 vendor 文件。

## 新增

- `scripts/rebuild.py`：按 `edit_plan.json` 一次重建整份剪映草稿，每次出新版本 `<名字>-vN`，不覆盖旧稿；格式见 `docs/edit-plan.md`。
- 校验（`validate`）：查轨道类型和名字、片段重叠、素材不存在、音频比画面长、库素材时长不够。
- 会员 BGM、会员音效：`library` 字段按剪映编号引用，本机缓存有就用缓存文件，没有就写静音占位、保存后换成编号，剪映打开时联网下载。
- 会员曲库搜索（`library` 命令）：只读剪映本机缓存的列表副本，不调剪映云接口。
- 转场：视频片段写 `transition.name`。
- 视频入场、出场动画：视频片段写 `anim_in` / `anim_out`。
- 画面特效：`effect` 轨片段写 `name`。
- 滤镜：`filter` 轨片段写 `name`。
- 文字动画：文字片段写 `anim_in` / `anim_out` / `anim_loop`。
- 花字：文字片段写 `style_id`；运行时补上 vendor 素材集合不认花字（`TextEffect`）的问题，不改 vendor 文件。
- 文字样式：`color`、`border`、`background`、`shadow`、`hl`（关键词单独上色）、`wrap` + `max_width`（自动换行）。
- 关键帧：视频的 `scale`、`x`、`y`、`alpha`、`rotation`、`volume`；音频的音量关键帧和 `fade_in` / `fade_out`。
- 剪映做不了的短片段（`renders`）：按命令、参数、画布和输入文件内容的哈希缓存，只渲没缓存的，并检查规格。
- 版本记录：每版的 plan 和时间线快照存 `versions/`，`制作记录.md` 追加一条；`changes` 命令列出两版之间的手改清单。
- 打开前提示：列出剪映打开草稿时要联网下载的素材；`validate --opened` / `--missing` 按同类、相近时长给替换。
- 路径可配置：`JY_SKILL_ROOT`、`JY_USER_DATA`、`JY_DRAFT_ROOT` 环境变量，`build --root` 写到别的目录；没装剪映时不读缓存也能生成。

## 没有拷进来的上游文件

- `assets/`（演示视频、图片和特效包素材）、`docs/images/`、`index.html`（项目主页）。
- 仓库维护文件：`.github/`、`.editorconfig`、`.pre-commit-config.yaml`、`CONTRIBUTING.md`、`SECURITY.md`。
- 上游的 `README.md`、`SKILL.md` 改名为 `docs/upstream-README.md`、`docs/upstream-SKILL.md`，原文未改。
