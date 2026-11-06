# edit_plan.json 格式

`scripts/rebuild.py` 读这个文件生成剪映草稿。下面只列它实际读的字段；没列的字段会被忽略。时间单位都是秒。

## 最小例子

在放 `edit_plan.json` 的目录里运行（`src` 的相对路径按当前目录算）：

```json
{
  "name": "demo-episode",
  "canvas": {"width": 1080, "height": 1920, "fps": 30},
  "tracks": [
    {"name": "VideoTrack", "type": "video", "clips": [
      {"id": "v1", "src": "footage/clip-01.mp4", "start": 0, "duration": 3,
       "transition": {"name": "倾斜拉开", "duration": 0.5}},
      {"id": "v2", "src": "footage/clip-02.mp4", "in": 1, "start": 3, "duration": 3}
    ]},
    {"name": "Subtitles", "type": "text", "clips": [
      {"id": "s1", "text": "第一句字幕", "start": 0, "duration": 3, "anim_in": "乱码故障"},
      {"id": "s2", "text": "花字示例", "start": 3, "duration": 3, "style_id": "7351316503771368713"}
    ]},
    {"name": "FilterTrack", "type": "filter", "clips": [
      {"id": "f1", "name": "春日暖阳", "start": 0, "duration": 6}
    ]}
  ]
}
```

```bash
python scripts/rebuild.py validate edit_plan.json
python scripts/rebuild.py build edit_plan.json --root /tmp/jy-test-drafts
```

## 顶层

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | 草稿名前缀，生成 `<name>-v1`、`<name>-v2`…… |
| `canvas` | 是 | `{width, height, fps}`，都要是正数，每期自己定（竖屏 1080×1920、4K 竖屏 2160×3840 等） |
| `tracks` | 是 | 轨道数组，见下 |
| `renders` | 否 | 剪映做不了、要用别的工具渲的短片段，见「renders」 |

## 轨道

`{"name": "...", "type": "...", "clips": [...]}`。`type` 只能是 `video`、`audio`、`text`、`effect`、`filter`。

- 音频轨的 `name` 只能是 `AudioTrack`（口播）、`BGM_Track`、`SFX_Track`。
- 文字轨叫 `Subtitles` 是字幕；别的名字会警告，标题轨加 `"role": "title"` 去掉警告。
- 同一轨上的片段不能重叠；每个片段的 `id` 全文件唯一，改动清单靠它比较。
- 所有片段都有 `id`、`start`（在时间线上的开始）、`duration`（大于 0）。

## video 片段

| 字段 | 说明 |
|---|---|
| `src` | 素材路径（绝对路径，或相对当前目录），或 `{"render": "<renders 里的名字>"}` |
| `in` | 从素材的第几秒开始用，默认 0 |
| `volume` | 原声音量，1.0 为原样 |
| `x`、`y`、`scale` | 位置和缩放 |
| `keyframes` | `{属性: [[片段内秒, 值], ...]}`，属性可用 `scale`、`x`、`y`、`alpha`、`rotation`、`volume` |
| `anim_in` / `anim_out` | 入场 / 出场动画名（pyJianYingDraft 元数据 `IntroType` / `OutroType` 里的名字），时长 `anim_in_dur` / `anim_out_dur`，默认 0.5 |
| `transition` | `{name, duration}`，接到下一个片段的转场，名字在 `TransitionType` 里，`duration` 默认 0.5 |

素材先转成 H.264、yuv420p，保持原分辨率和方向。

## audio 片段

`src`（本地音频）和 `library`（剪映库素材）二选一。

| 字段 | 说明 |
|---|---|
| `src` | 本地音频文件路径 |
| `library` | `{kind: "music" 或 "sound", id, title, duration}`；`id` 是剪映编号，用 `rebuild.py library <关键词>` 从本机缓存里搜；片段不能比 `duration` 长 |
| `volume` | 音量 |
| `keyframes.volume` | `[[片段内秒, 音量], ...]` |
| `fade_in` / `fade_out` | 淡入 / 淡出秒数 |

音频片段的结束不能晚于最后一个视频片段的结束。`library` 素材本机没缓存时先写静音占位，草稿里换成编号，剪映打开时要联网下载；`build` 结束会列出这些素材。

## text 片段

| 字段 | 说明 |
|---|---|
| `text` | 文字内容 |
| `size` | 字号，默认 5 |
| `bold` | 是否加粗 |
| `x`、`y` | 位置，`y` 默认 -0.4（约画面 70% 高度） |
| `color` | `#RRGGBB`，默认白色 |
| `wrap`、`max_width` | 自动换行和最大行宽（默认 0.82） |
| `border` | `{color, width, alpha}`；写 `null` 去掉描边 |
| `background` | `{color, alpha, round_radius, height, width, style}`，字幕底框 |
| `shadow` | `{color, alpha, diffuse, distance, angle}` |
| `hl` | `[{text, color}]`，把句子里的这些词单独上色 |
| `anim_in` / `anim_out` / `anim_loop` | 文字入场 / 出场 / 循环动画名（`TextIntro` / `TextOutro` / `TextLoopAnim`） |
| `style_id` | 花字编号（见 `data/cloud_text_styles.csv`）；用花字时只读 `text`、`size`、`bold`、`color`、`wrap`、`max_width`、`x`、`y`，不带动画和其他样式 |

## effect 和 filter 片段

`{id, name, start, duration}`。`effect` 的 `name` 在 `VideoSceneEffectType` 里，`filter` 的 `name` 在 `FilterType` 里。

能写的名字都在 `scripts/vendor/pyJianYingDraft/metadata/`；剪映里看得到、元数据里没有的写不进去。

## renders

```json
"renders": {
  "info-card": {"cmd": ["./render_card.sh", "{out}"], "inputs": ["render_card.sh", "assets/card.json"], "params": {"seed": 1}}
}
```

`cmd` 在 `edit_plan.json` 所在目录运行，`{out}` 换成输出路径。`inputs`（相对该目录）、`cmd`、`params`、`canvas` 任何一项变了才重渲，成品缓存在 `clips/<名字>-<哈希>.mp4`。成品必须是画布尺寸、H.264、yuv420p、画布帧率。视频片段用 `{"render": "info-card"}` 引用。
