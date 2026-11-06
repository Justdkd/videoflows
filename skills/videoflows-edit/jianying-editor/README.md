# jianying-editor（VideoFlows 改良版）

这里放生成剪映草稿的代码。它基于两个开源项目：

- jianying-editor-skill，作者 luoluoluo22，MIT 许可证
- pyJianYingDraft，作者 GuanYixuan，Apache-2.0 许可证（被上游内嵌并改过）

VideoFlows 在上面加了：用剪映自带的会员 BGM、音效、转场、画面特效、文字动画、花字、滤镜，以及按 `edit_plan.json` 一次重建草稿。逐条改动见 `CHANGES.md`。

两份上游许可证原文放在 `LICENSE`（MIT）和 `scripts/vendor/pyJianYingDraft/LICENSE`（Apache-2.0）；本目录的改动同样按 MIT 发布。pyJianYingDraft 保留在上游的 `scripts/vendor/` 位置，因为代码按这个路径 import。

## 安装

需要：macOS 或 Windows、剪映专业版、Python 3.12、ffmpeg 和 ffprobe（在 PATH 里；macOS 可 `brew install ffmpeg`）。

在仓库根目录：

```bash
cd skills/videoflows-edit/jianying-editor
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

`.venv/` 不进仓库。Windows 上把 `.venv/bin/` 换成 `.venv\Scripts\`。

## 入口命令

入口是 `scripts/rebuild.py`，按 `edit_plan.json` 重建草稿。格式见 [docs/edit-plan.md](docs/edit-plan.md)，改了什么见 [CHANGES.md](CHANGES.md)。在 `edit_plan.json` 所在目录运行：

```bash
PY=<仓库>/skills/videoflows-edit/jianying-editor/.venv/bin/python
R=<仓库>/skills/videoflows-edit/jianying-editor/scripts/rebuild.py

"$PY" "$R" validate edit_plan.json                 # 查结构、重叠、素材、音频超长
"$PY" "$R" clips edit_plan.json                    # 只渲染缓存里没有的 renders
"$PY" "$R" build edit_plan.json                    # 生成第一版 <name>-v1
"$PY" "$R" build edit_plan.json --hand-edited no   # 上一版用户没手改过：生成下一版
"$PY" "$R" build edit_plan.json --hand-edited yes  # 上一版用户手改过：只列改动清单，不建草稿
"$PY" "$R" changes edit_plan.json --base 2         # 和 v2 比
"$PY" "$R" library 吉他 --kind music                # 在剪映本机缓存里搜会员音乐 / 音效
"$PY" "$R" validate edit_plan.json --opened        # 草稿打开过后，列还没下载到本机的素材和替换
```

- `build` 默认写进剪映草稿目录（macOS：`~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft`），写之前要求剪映完全退出（含托盘）。剪映下次启动会自己登记新草稿。
- 环境变量：`JY_DRAFT_ROOT` 改草稿目录，`JY_USER_DATA` 改剪映数据目录（默认 `~/Movies/JianyingPro/User Data`，会员音频缓存从这里读），`JY_SKILL_ROOT` 改 jianying-editor 目录（默认本目录）。
- 测试时用 `build --root <临时目录>`，不写进真的草稿目录。
- 每版的 plan 和时间线快照存在 `edit_plan.json` 旁边的 `versions/`，并追加 `制作记录.md`。

上游原来的 `JyProject` 接口和脚本照旧可用，说明见 `docs/upstream-README.md`、`docs/api.md`。
