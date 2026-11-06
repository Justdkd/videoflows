#!/usr/bin/env python3
"""按 edit_plan.json 重建剪映草稿：只出新版本，不覆盖旧稿，不整片渲染。

命令：validate / clips / build / changes / library，用法见 ../README.md，edit_plan.json 格式见 ../docs/edit-plan.md。
只用 jianying-editor 写草稿；不调剪映云接口，不解密任何草稿。
"""
import argparse
import datetime
import glob
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile

# 默认用本文件所在的 jianying-editor 目录；剪映数据目录默认是 macOS 剪映专业版的位置，可用环境变量改
SKILL_ROOT = os.environ.get("JY_SKILL_ROOT", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
USER_DATA = os.path.expanduser(os.environ.get("JY_USER_DATA", "~/Movies/JianyingPro/User Data"))
DRAFT_ROOT = os.path.expanduser(os.environ.get("JY_DRAFT_ROOT", os.path.join(USER_DATA, "Projects/com.lveditor.draft")))
MUSIC_CACHE = os.path.join(USER_DATA, "Cache/music")
S = 1_000_000
TRACK_TYPES = {"video", "audio", "text", "effect", "filter"}
AUDIO_TRACKS = {"AudioTrack", "BGM_Track", "SFX_Track"}
UNVERIFIED = {}  # 2026-11-03 滤镜已在剪映里验证；新类型未验证时再加回这里


class PlanError(Exception):
    pass


def us(seconds):
    return int(round(float(seconds) * S))


def load_plan(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def clip_end(clip):
    return float(clip["start"]) + float(clip["duration"])


def validate(plan):
    """返回警告列表；有结构错误直接抛 PlanError。"""
    errors, warnings = [], []
    canvas = plan.get("canvas") or {}
    if not plan.get("name"):
        errors.append("缺 name")
    if not all(isinstance(canvas.get(k), (int, float)) and canvas[k] > 0 for k in ("width", "height", "fps")):
        errors.append("canvas 必须写 width、height、fps（每期定，不写死）")
    ids, end = set(), 0.0
    for t in plan.get("tracks", []):
        kind, name = t.get("type"), t.get("name")
        if kind not in TRACK_TYPES or not name:
            errors.append(f"轨道 {name!r} 的 type 或 name 不对")
            continue
        if kind == "audio" and name not in AUDIO_TRACKS:
            errors.append(f"音频轨只能叫 {sorted(AUDIO_TRACKS)}，现在是 {name}")
        if kind == "text" and name != "Subtitles" and t.get("role") != "title":
            warnings.append(f"文字轨 {name} 不是 Subtitles，确认它是标题轨")
        if kind in UNVERIFIED:
            warnings.append(f"{name}：{UNVERIFIED[kind]}")
        prev = None
        for c in sorted(t.get("clips", []), key=lambda x: float(x.get("start", 0))):
            cid = c.get("id")
            if not cid or cid in ids:
                errors.append(f"轨道 {name} 有片段缺 id 或 id 重复：{cid!r}")
            ids.add(cid)
            if "start" not in c or "duration" not in c or float(c["duration"]) <= 0:
                errors.append(f"{cid}：缺 start 或 duration")
                continue
            if prev is not None and float(c["start"]) < clip_end(prev) - 1e-6:
                errors.append(f"{cid}：和 {prev.get('id')} 在 {name} 上重叠")
            prev = c
            if kind == "video":
                end = max(end, clip_end(c))
                src = c.get("src")
                if isinstance(src, dict):
                    if src.get("render") not in plan.get("renders", {}):
                        errors.append(f"{cid}：引用的 render {src.get('render')!r} 不存在")
                elif not src or not os.path.exists(src):
                    errors.append(f"{cid}：素材不存在 {src}")
            if kind == "audio":
                lib = c.get("library")
                if not c.get("src") and not lib:
                    errors.append(f"{cid}：音频要写 src 或 library")
                if lib and (lib.get("kind") not in ("music", "sound") or not lib.get("id") or not lib.get("title")):
                    errors.append(f"{cid}：library 要写 kind（music/sound）、id、title")
                if lib and lib.get("duration") and float(c["duration"]) > float(lib["duration"]) + 1e-6:
                    errors.append(f"{cid}：片段 {c['duration']}s 比素材 {lib['duration']}s 长")
    for t in plan.get("tracks", []):
        if t.get("type") == "audio":
            for c in t.get("clips", []):
                if "start" in c and "duration" in c and clip_end(c) > end + 1e-6:
                    errors.append(f"{c.get('id')}：音频超出画面结束（{end:.3f}s），导出会多黑屏")
    if errors:
        raise PlanError("\n".join(errors))
    return warnings


# ---------- 剪映做不到的短 clip：按内容哈希缓存 ----------

def sha_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def render_key(spec, canvas, base):
    files = [os.path.join(base, p) for p in spec.get("inputs", [])]
    missing = [p for p in files if not os.path.exists(p)]
    if missing:
        raise PlanError(f"render 输入不存在：{missing}")
    payload = {"cmd": spec["cmd"], "params": spec.get("params", {}), "canvas": canvas,
               "inputs": [(os.path.relpath(p, base), sha_file(p)) for p in files]}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]


def check_clip(path, canvas):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=codec_name,width,height,pix_fmt,r_frame_rate", "-of", "json", path],
                         capture_output=True, text=True, check=True)
    st = json.loads(out.stdout)["streams"][0]
    num, den = st["r_frame_rate"].split("/")
    got = (st["codec_name"], st["width"], st["height"], st["pix_fmt"], round(int(num) / int(den), 3))
    want = ("h264", int(canvas["width"]), int(canvas["height"]), "yuv420p", float(canvas["fps"]))
    if got != want:
        raise PlanError(f"{path} 规格不对：{got}，应为 {want}")


def render_clips(plan, base):
    """只渲染缓存里没有的 clip；返回 {render 名: 文件路径}。"""
    out, cache = {}, os.path.join(base, "clips")
    for name, spec in plan.get("renders", {}).items():
        path = os.path.join(cache, f"{name}-{render_key(spec, plan['canvas'], base)}.mp4")
        if os.path.exists(path):
            print(f"缓存命中 {name}")
        else:
            os.makedirs(cache, exist_ok=True)
            tmp = path + ".tmp.mp4"
            print(f"渲染 {name}")
            subprocess.run([a.replace("{out}", tmp) for a in spec["cmd"]], cwd=base, check=True)
            check_clip(tmp, plan["canvas"])
            os.replace(tmp, path)
        out[name] = path
    return out


# ---------- 会员库音频：只读本机缓存 ----------

def music_index():
    cfg = os.path.join(MUSIC_CACHE, "downLoadcfg")
    if not os.path.exists(cfg):  # 没装剪映或没下载过会员音频
        return {}
    with open(cfg, encoding="utf-8") as f:
        rows = json.load(f)["list"]
    return {r["resourceId"]: os.path.join(MUSIC_CACHE, r["path"]) for r in rows
            if r.get("resourceId") and r["path"].endswith(".mp3")}


def audio_catalog():
    """从 rp.db 的副本里读剪映缓存过的曲库列表：浏览过的音乐和音效都算，不要求已下载。"""
    index = music_index()
    found = {}

    def walk(o):
        if isinstance(o, dict):
            attr = o.get("common_attr")
            if isinstance(attr, dict) and isinstance(o.get("audio_effect"), dict) and attr.get("id"):
                rid = str(attr["id"])
                m = re.search(r'paid_type\\*":\\*"(\w+)', json.dumps(attr, ensure_ascii=False))
                found[rid] = {"id": rid, "kind": "sound", "title": attr.get("title") or attr.get("name"), "paid": m.group(1) if m else None,
                              "scope": None, "duration": o["audio_effect"].get("duration_ms", 0) / 1000, "local": rid in index}
            if "commercial_scope" in o and o.get("id"):
                rid = str(o["id"])
                found[rid] = {"id": rid, "kind": "music", "title": o.get("title"), "paid": o.get("paid_type"), "scope": o.get("commercial_scope"),
                              "duration": o.get("duration"), "local": rid in index}
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
        elif isinstance(o, str) and o[:1] in "{[" and len(o) > 40:
            try:
                walk(json.loads(o))
            except ValueError:
                pass

    with tempfile.TemporaryDirectory(prefix="jy-rp-") as tmp:
        for db in glob.glob(os.path.join(USER_DATA, "Cache/ressdk_db/*/rp.db")):
            copy = os.path.join(tmp, "rp.db")
            for suffix in ("", "-wal", "-shm"):
                if os.path.exists(db + suffix):
                    shutil.copy2(db + suffix, copy + suffix)
            con = sqlite3.connect(copy)
            try:
                rows = con.execute("select response_body from http_cache").fetchall()
            except sqlite3.OperationalError:
                rows = []
            con.close()
            for (body,) in rows:
                try:
                    walk(json.loads(body))
                except ValueError:
                    pass
    return list(found.values())


# ---------- 需要下载的素材和替换 ----------

def draft_lib():
    sys.path.insert(0, os.path.join(SKILL_ROOT, "scripts", "vendor"))
    import pyJianYingDraft
    return pyJianYingDraft


def find_member(enum, name):
    for m in enum:
        v = m.value
        if m.name == name or getattr(v, "name", None) == name or getattr(v, "title", None) == name:
            return m
    raise PlanError(f"{enum.__name__} 里没有「{name}」")


def member_duration(v):
    d = getattr(v, "duration", None) or getattr(v, "default_duration", None)
    return float(d) / S if d else None


def plan_resources(plan):
    """列出 plan 里所有剪映库素材：片段、类型、名字、编号、时长、本机有没有。"""
    d = draft_lib()
    index = music_index()
    effect_cache = os.path.join(USER_DATA, "Cache/effect")
    on_disk = set(os.listdir(effect_cache)) if os.path.isdir(effect_cache) else set()

    def from_enum(cid, label, enum, name):
        v = find_member(enum, name).value
        return {"clip": cid, "label": label, "enum": enum, "name": name, "id": str(v.resource_id), "duration": member_duration(v),
                "vip": v.is_vip, "local": str(v.resource_id) in on_disk or str(v.effect_id) in on_disk}

    out = []
    for t in plan["tracks"]:
        for c in t["clips"]:
            cid = c["id"]
            if t["type"] == "video" and c.get("transition"):
                out.append(from_enum(cid, "转场", d.TransitionType, c["transition"]["name"]))
            elif t["type"] == "text":
                for key, label, enum in (("anim_in", "文字入场", d.TextIntro), ("anim_out", "文字出场", d.TextOutro), ("anim_loop", "文字循环", d.TextLoopAnim)):
                    if c.get(key):
                        out.append(from_enum(cid, label, enum, c[key]))
            elif t["type"] == "effect":
                out.append(from_enum(cid, "特效", d.VideoSceneEffectType, c["name"]))
            elif t["type"] == "filter":
                out.append(from_enum(cid, "滤镜", d.FilterType, c["name"]))
            elif t["type"] == "audio" and c.get("library"):
                lib = c["library"]
                out.append({"clip": cid, "label": "音乐" if lib["kind"] == "music" else "音效", "kind": lib["kind"], "name": lib["title"],
                            "id": str(lib["id"]), "duration": float(lib.get("duration") or c["duration"]),
                            "need": float(c["duration"]), "local": str(lib["id"]) in index})
    return out


def replacements(res, plan, catalog):
    """按同类、相近时长给 2 个替换；音频的时长不能短于片段。"""
    used = {r["id"] for r in plan_resources(plan)}
    if "enum" in res:
        rows = [m.value for m in res["enum"] if m.value.is_vip == res["vip"] and str(m.value.resource_id) not in used]
        target = res["duration"]
        rows.sort(key=lambda v: abs((member_duration(v) or 0) - (target or 0)))
        return [{"name": getattr(v, "name", None) or v.title, "id": str(v.resource_id), "duration": member_duration(v)} for v in rows[:2]]
    rows = [r for r in catalog if r["kind"] == res["kind"] and r["id"] not in used and (r["duration"] or 0) >= res["need"]]
    rows.sort(key=lambda r: (abs((r["duration"] or 0) - res["duration"]), not r["local"]))
    return [{"name": r["title"], "id": r["id"], "duration": r["duration"]} for r in rows[:2]]


def print_download_list(plan):
    pending = [r for r in plan_resources(plan) if not r["local"]]
    if not pending:
        print("本次素材都在本机，打开时不用下载")
        return
    print(f"打开草稿时剪映要联网下载 {len(pending)} 项：")
    for r in pending:
        print(f"  {r['label']}｜{r['name']}｜{r['id']}｜片段 {r['clip']}")


def report_missing(plan, ids, opened):
    resources = plan_resources(plan)
    targets = [r for r in resources if r["clip"] in ids or (opened and not r["local"])]
    unknown = ids - {r["clip"] for r in resources}
    if unknown:
        raise PlanError(f"这些片段没有剪映库素材：{sorted(unknown)}")
    if not targets:
        print("没有疑似丢失的素材")
        return
    catalog = audio_catalog() if any("kind" in r for r in targets) else []
    for r in targets:
        print(f"疑似丢失：{r['label']}｜{r['name']}｜{r['id']}｜片段 {r['clip']}")
        for alt in replacements(r, plan, catalog):
            print(f"  替换：{alt['name']}｜{alt['id']}｜时长 {alt['duration']}")


# ---------- 写草稿 ----------

def allow_flower_text(material_cls):
    """vendor 的素材集合 __contains__ 不认花字（TextEffect 不是 Filter 子类），保存时会报 TypeError。
    这里在运行时补上按 global_id 查找，不改 vendor 文件。"""
    from pyJianYingDraft.text_segment import TextBubble
    if getattr(material_cls, "_flower_text_ok", False):
        return
    original = material_cls.__contains__

    def contains(self, item):
        if isinstance(item, TextBubble):
            return item.global_id in [f.global_id for f in self.filters]
        return original(self, item)

    material_cls.__contains__ = contains
    material_cls._flower_text_ok = True


def build_draft(plan, draft_name, root, clips):
    sys.path.insert(0, os.path.join(SKILL_ROOT, "scripts"))
    from jy_wrapper import JyProject
    import pyJianYingDraft as draft
    from pyJianYingDraft import KeyframeProperty as KP, trange

    canvas = plan["canvas"]
    staging = tempfile.mkdtemp(prefix="jy-build-", dir=os.path.dirname(os.path.abspath(root)))
    props = {"scale": KP.uniform_scale, "x": KP.position_x, "y": KP.position_y, "alpha": KP.alpha,
             "rotation": KP.rotation, "volume": KP.volume}
    index = music_index()
    library = {}

    def placeholder(lib, seconds):
        """未下载的音频写一段静音占位，保存后换成编号，剪映打开时按编号下载。"""
        path = os.path.join(staging, f"{lib['id']}.mp3")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", str(seconds),
                        "-c:a", "libmp3lame", path], check=True)
        return path

    longest = {}
    for t in plan["tracks"]:
        for c in t["clips"]:
            lib = c.get("library")
            if lib:
                longest[str(lib["id"])] = max(longest.get(str(lib["id"]), 0), float(lib.get("duration") or 0), float(c["duration"]))
    try:
        p = JyProject(draft_name, width=int(canvas["width"]), height=int(canvas["height"]),
                      drafts_root=staging, overwrite=False)
        allow_flower_text(type(p.script.materials))
        for t in plan["tracks"]:
            kind, name = t["type"], t["name"]
            clips_sorted = sorted(t["clips"], key=lambda c: float(c["start"]))
            if kind in ("effect", "filter"):
                p.script.add_track(draft.TrackType[kind], name)
            for c in clips_sorted:
                start, dur = us(c["start"]), us(c["duration"])
                if kind == "video":
                    src = clips[c["src"]["render"]] if isinstance(c["src"], dict) else c["src"]
                    seg = p.add_media_safe(src, start_time=start, duration=dur, track_name=name,
                                           source_start=us(c.get("in", 0)))
                    if seg is None:
                        raise PlanError(f"{c['id']}：写入失败")
                    if "volume" in c:
                        seg.volume = float(c["volume"])
                    for key, attr in (("x", "transform_x"), ("y", "transform_y"), ("scale", "scale_x"), ("scale", "scale_y")):
                        if key in c:
                            setattr(seg.clip_settings, attr, float(c[key]))
                    for prop, points in (c.get("keyframes") or {}).items():
                        for at, value in points:
                            seg.add_keyframe(props[prop], us(at), float(value))
                    # 2026-11-03 加：视频片段入场 / 出场动画（可选，名字见 metadata 的 IntroType / OutroType）
                    if c.get("anim_in"):
                        seg.add_animation(find_member(draft.IntroType, c["anim_in"]), duration=us(c.get("anim_in_dur", 0.5)))
                    if c.get("anim_out"):
                        seg.add_animation(find_member(draft.OutroType, c["anim_out"]), duration=us(c.get("anim_out_dur", 0.5)))
                    if c.get("transition"):
                        tr = c["transition"]
                        seg.add_transition(find_member(draft.TransitionType, tr["name"]), duration=us(tr.get("duration", 0.5)))
                elif kind == "audio":
                    lib = c.get("library")
                    src = c.get("src")
                    if lib:
                        src = index.get(str(lib["id"]))
                        if not src or not os.path.exists(src):
                            src = os.path.join(staging, f"{lib['id']}.mp3")
                            if not os.path.exists(src):
                                src = placeholder(lib, longest[str(lib["id"])])
                        library[os.path.basename(src)] = lib
                    seg = p.add_audio_safe(src, start_time=start, duration=dur, track_name=name)
                    if seg is None:
                        raise PlanError(f"{c['id']}：写入失败")
                    if "volume" in c:
                        seg.volume = float(c["volume"])
                    # 2026-11-03 加：音频音量关键帧 [[片段内秒, 音量], ...]，和淡入淡出 fade_in / fade_out（秒）
                    for at, value in (c.get("keyframes") or {}).get("volume", []):
                        seg.add_keyframe(us(at), float(value))
                    if c.get("fade_in") or c.get("fade_out"):
                        seg.add_fade(us(c.get("fade_in", 0)), us(c.get("fade_out", 0)))
                elif kind == "text":
                    # 2026-11-03 加：可选 color / wrap / border / background / shadow / hl，不写时和以前一样
                    rgb = lambda h: tuple(int(h.lstrip("#")[i:i + 2], 16) / 255 for i in (0, 2, 4))
                    style = draft.TextStyle(size=float(c.get("size", 5)), bold=bool(c.get("bold")), align=1,
                                            color=rgb(c["color"]) if c.get("color") else (1.0, 1.0, 1.0),
                                            auto_wrapping=bool(c.get("wrap")), max_line_width=float(c.get("max_width", 0.82)))
                    cs = draft.ClipSettings(transform_x=float(c.get("x", 0)), transform_y=float(c.get("y", -0.4)))
                    extra = {}
                    if "border" in c:
                        b = c["border"]
                        extra["border"] = draft.TextBorder(color=rgb(b.get("color", "#000000")), alpha=float(b.get("alpha", 1.0)), width=float(b.get("width", 40.0))) if b else None
                    if c.get("background"):
                        g = c["background"]
                        extra["background"] = draft.TextBackground(color=g.get("color", "#FFFFFF"), style=int(g.get("style", 1)), alpha=float(g.get("alpha", 1.0)),
                                                                   round_radius=float(g.get("round_radius", 0.0)), height=float(g.get("height", 0.14)), width=float(g.get("width", 0.14)))
                    if c.get("shadow"):
                        s = c["shadow"]
                        extra["shadow"] = draft.TextShadow(color=rgb(s.get("color", "#000000")), alpha=float(s.get("alpha", 0.5)), diffuse=float(s.get("diffuse", 15.0)),
                                                           distance=float(s.get("distance", 5.0)), angle=float(s.get("angle", -45.0)))
                    if c.get("hl"):  # 关键词上色：[{"text": "越累", "color": "#A44A28"}]
                        # vendor 有 rich_spans 时只导出这些区间，没盖到的字会丢样式，所以整段按区间切满
                        base = rgb(c["color"]) if c.get("color") else (1.0, 1.0, 1.0)
                        marks = sorted((i, i + len(h["text"]), rgb(h.get("color", "#A44A28"))) for h in c["hl"]
                                       for i in [c["text"].find(h["text"])] if i >= 0)
                        spans, pos = [], 0
                        for a, b, col in marks:
                            if a < pos:
                                continue
                            if a > pos:
                                spans.append(draft.RichTextSpan(pos, a, color=base))
                            spans.append(draft.RichTextSpan(a, b, color=col)); pos = b
                        if spans:
                            if pos < len(c["text"]):
                                spans.append(draft.RichTextSpan(pos, len(c["text"]), color=base))
                            extra["rich_spans"] = spans
                    if c.get("style_id"):
                        # 花字：TextSegment.add_effect 要在入轨前调用，add_text_simple 做不到，所以手动组装。不带入场动画。
                        p._ensure_track(draft.TrackType.text, name)
                        seg = draft.TextSegment(c["text"], trange(start, dur), style=style, clip_settings=cs,
                                                border=draft.TextBorder(color=(0.0, 0.0, 0.0), alpha=1.0, width=40.0))
                        seg.add_effect(str(c["style_id"]))
                        p.script.add_segment(seg, name)
                    else:
                        seg = p.add_text_simple(c["text"], start_time=start, duration=dur, track_name=name, style=style, clip_settings=cs,
                                                anim_in=c.get("anim_in"), anim_out=c.get("anim_out"), anim_loop=c.get("anim_loop"), **extra)
                    if seg is None:
                        raise PlanError(f"{c['id']}：写入失败")
                elif kind == "effect":
                    p.script.add_effect(find_member(draft.VideoSceneEffectType, c["name"]), trange(start, dur), track_name=name)
                else:
                    p.script.add_filter(find_member(draft.FilterType, c["name"]), trange(start, dur), track_name=name)
        p.save()
        src_dir = os.path.join(staging, draft_name)
        final = os.path.join(root, draft_name)
        if os.path.exists(final):
            raise PlanError(f"{final} 已存在")
        info_path = os.path.join(src_dir, "draft_info.json")
        with open(info_path, encoding="utf-8") as f:
            info = f.read().replace(src_dir, final)
        data = json.loads(info)
        for mat in data["materials"].get("audios", []):
            lib = library.get(os.path.basename(mat.get("path", ""))) or library.get(mat.get("name", ""))
            if lib:
                path = index.get(str(lib["id"])) or os.path.join(MUSIC_CACHE, f"{lib['id']}.mp3")
                mat.update(type=lib["kind"], music_id=str(lib["id"]), name=lib["title"], path=path, source_platform=1)
        with open(info_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        shutil.move(src_dir, final)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    return final


# ---------- 版本和改动清单 ----------

def versions_dir(plan_path):
    return os.path.join(os.path.dirname(os.path.abspath(plan_path)), "versions")


def saved_versions(plan_path):
    found = []
    for f in glob.glob(os.path.join(versions_dir(plan_path), "edit_plan.v*.json")):
        m = re.search(r"\.v(\d+)\.json$", f)
        if m:
            found.append(int(m.group(1)))
    return sorted(found)


def next_version(plan, plan_path, root):
    used = list(saved_versions(plan_path))
    pat = re.compile(re.escape(plan["name"]) + r"-v(\d+)$")
    used += [int(m.group(1)) for m in map(pat.match, os.listdir(root)) if m]
    return max(used, default=0) + 1


def fmt_time(seconds):
    m, s = divmod(float(seconds), 60)
    return f"{int(m):02d}:{s:06.3f}"


def flat_clips(plan):
    out = {}
    for t in plan.get("tracks", []):
        for c in t.get("clips", []):
            out[c["id"]] = (t["name"], c)
    return out


def change_list(old, new):
    """比较两版 plan，生成给用户在剪映里手改的清单。"""
    a, b = flat_clips(old), flat_clips(new)
    rows = []
    for cid in sorted(set(a) | set(b), key=lambda k: float((b.get(k) or a[k])[1]["start"])):
        if cid not in a:
            track, c = b[cid]
            rows.append((fmt_time(c["start"]), track, cid, "新增", "—", json.dumps(c, ensure_ascii=False), "在这个时间点加这段"))
        elif cid not in b:
            track, c = a[cid]
            rows.append((fmt_time(c["start"]), track, cid, "删除", json.dumps(c, ensure_ascii=False), "—", "删掉这段"))
        else:
            track, oc = a[cid]
            _, nc = b[cid]
            for key in sorted(set(oc) | set(nc)):
                if oc.get(key) != nc.get(key):
                    rows.append((fmt_time(nc["start"]), track, cid, key, json.dumps(oc.get(key), ensure_ascii=False),
                                 json.dumps(nc.get(key), ensure_ascii=False), f"把 {key} 改成新值"))
    head = ["| 时间码 | 轨道 | 片段 | 项目 | 原值 | 新值 | 操作 |", "|---|---|---|---|---|---|---|"]
    return "\n".join(head + ["| " + " | ".join(str(x).replace("|", "\\|") for x in r) + " |" for r in rows]), len(rows)


def write_records(plan, plan_path, version, draft_name, final):
    vdir = versions_dir(plan_path)
    os.makedirs(vdir, exist_ok=True)
    shutil.copy2(plan_path, os.path.join(vdir, f"edit_plan.v{version}.json"))
    timeline = [{"track": t["name"], "id": c["id"], "start": c["start"], "duration": c["duration"]}
                for t in plan["tracks"] for c in t["clips"]]
    with open(os.path.join(vdir, f"timeline.v{version}.json"), "w", encoding="utf-8") as f:
        json.dump(timeline, f, ensure_ascii=False, indent=1)
    record = os.path.join(os.path.dirname(os.path.abspath(plan_path)), "制作记录.md")
    with open(record, "a", encoding="utf-8") as f:
        f.write(f"\n## {datetime.date.today()} {draft_name}\n\n- 依据：`versions/edit_plan.v{version}.json`\n- 草稿：`{final}`\n"
                "- 草稿结构已核；剪映内未打开；未导出\n")


def jianying_running():
    return subprocess.run(["pgrep", "-i", "videofusion"], capture_output=True).returncode == 0


def cmd_validate(a):
    plan = load_plan(a.plan)
    for w in validate(plan):
        print("警告：", w)
    print("plan 通过")
    ids = {x for x in (a.missing or "").split(",") if x}
    if ids or a.opened:
        report_missing(plan, ids, a.opened)


def cmd_clips(a):
    plan = load_plan(a.plan)
    validate(plan)
    print(json.dumps(render_clips(plan, os.path.dirname(os.path.abspath(a.plan))), ensure_ascii=False, indent=1))


def cmd_changes(a):
    plan = load_plan(a.plan)
    prior = a.base or (saved_versions(a.plan) or [None])[-1]
    if prior is None:
        raise PlanError("还没有已生成的版本，没有可比较的底稿")
    old = load_plan(os.path.join(versions_dir(a.plan), f"edit_plan.v{prior}.json"))
    print(f"# 改动清单（相对 {plan['name']}-v{prior}）\n")
    print(change_list(old, plan)[0])


def cmd_build(a):
    plan = load_plan(a.plan)
    for w in validate(plan):
        print("警告：", w)
    prior = saved_versions(a.plan)
    if prior and a.hand_edited is None:
        raise PlanError(f"v{prior[-1]} 已交付：先问用户手改过没有，再传 --hand-edited yes 或 no")
    if prior and a.hand_edited == "yes":
        return cmd_changes(argparse.Namespace(plan=a.plan, base=prior[-1]))
    root = os.path.abspath(a.root) if a.root else DRAFT_ROOT
    if not a.root and jianying_running():
        raise PlanError("剪映还开着（含托盘进程），先完全退出")
    version = next_version(plan, a.plan, root)
    draft_name = f"{plan['name']}-v{version}"
    clips = render_clips(plan, os.path.dirname(os.path.abspath(a.plan)))
    final = build_draft(plan, draft_name, root, clips)
    write_records(plan, a.plan, version, draft_name, final)
    print(final)
    print_download_list(plan)


def cmd_library(a):
    rows = [r for r in audio_catalog() if a.keyword.lower() in (r["title"] or "").lower() and (not a.kind or r["kind"] == a.kind)]
    rows.sort(key=lambda r: not r["local"])
    for r in rows[:a.limit]:
        print(json.dumps(r, ensure_ascii=False))
    print(f"共 {len(rows)} 条，显示 {min(len(rows), a.limit)} 条", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("validate")
    p.add_argument("plan")
    p.add_argument("--opened", action="store_true", help="草稿打开过之后：列出还没下载到本机的素材和替换")
    p.add_argument("--missing", help="用户报告媒体丢失的片段 id，逗号分隔")
    p.set_defaults(fn=cmd_validate)
    p = sub.add_parser("clips")
    p.add_argument("plan")
    p.set_defaults(fn=cmd_clips)
    p = sub.add_parser("build")
    p.add_argument("plan")
    p.add_argument("--hand-edited", choices=["yes", "no"])
    p.add_argument("--root", help="草稿写到这个目录（测试用；默认 JY_DRAFT_ROOT 或剪映草稿目录）")
    p.set_defaults(fn=cmd_build)
    p = sub.add_parser("changes")
    p.add_argument("plan")
    p.add_argument("--base", type=int)
    p.set_defaults(fn=cmd_changes)
    p = sub.add_parser("library")
    p.add_argument("keyword")
    p.add_argument("--kind", choices=["music", "sound"])
    p.add_argument("--limit", type=int, default=30)
    p.set_defaults(fn=cmd_library)
    a = ap.parse_args()
    os.environ["PATH"] = "/opt/homebrew/bin:" + os.environ["PATH"]
    try:
        a.fn(a)
    except PlanError as e:
        print(f"停止：{e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
