#!/usr/bin/env node
// build-index：读 config、卡、复盘、适配器 → 校验 → 算派生字段 → 排首页的「等你」、每站带子和胶片上的字，再排 agent 待办 → 写 index.json 和 index.archive.json。
// 这是仓库里唯一算东西的地方。任何一个文件校验不过就停，不写半份索引。
//
// 用法：node scripts/build-index.mjs [--root 目录] [--now 时间] [--check] [--no-git] [--base 提交] [--range 起..止]
//   --root    数据所在目录（config.json、cards/、reviews/、adapters/），默认仓库根目录
//   --now     把「现在」固定成某个带时区的时间，测试用
//   --check   只校验，不写文件
//   --no-git  不读 git 历史（跳过阶段流转检查和阶段时间线）
//   --base    工作区里的卡和这个提交比阶段流转。不传时：cards/ 有未提交改动就比 HEAD，工作区干净就比 HEAD~1
//   --range   逐个检查区间里的每个提交：它改动的卡和它的父提交比（CI 用，如 --range abc123..HEAD）

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validate } from './lib/validate.mjs';
import { askLabels } from './lib/actions.mjs';
import { HOUR, DAY, parseTime, formatTime, localMidnight, localDate, addDays, isoWeekday, isoWeek, isoWeekMonday, daysBetween } from './lib/time.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGES = ['topic', 'script', 'record', 'edit', 'sample_gate', 'publish', 'data', 'reviewed'];
const IN_PRODUCTION = new Set(['topic', 'script', 'record', 'edit', 'sample_gate', 'publish']);
const STATIONS = ['topic', 'script', 'record', 'edit', 'sample_gate', 'publish', 'data']; // 首页七个工位；已复盘的不上带
const PUBLISH_POINTS = ['h10', 'd3', 'd7'];
const SCREENS = ['takeaway', 'evidence', 'framework', 'search'];
const RATES = ['like_rate', 'comment_rate', 'favorite_rate', 'followers_per_1k', 'completion_5s', 'avg_watch_ratio', 'bounce_2s'];
const SUM_METRICS = ['plays', 'likes', 'comments', 'favorites', 'new_followers'];

// ---------- 参数 ----------
function parseArgs(argv) {
  const o = { root: REPO, now: null, check: false, git: true, base: null, range: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') o.root = path.resolve(argv[++i]);
    else if (a === '--now') o.now = argv[++i];
    else if (a === '--check') o.check = true;
    else if (a === '--no-git') o.git = false;
    else if (a === '--base') o.base = argv[++i];
    else if (a === '--range') o.range = argv[++i];
    else { console.error(`不认识的参数：${a}`); process.exit(2); }
  }
  return o;
}

// ---------- 错误收集 ----------
class Problems {
  constructor() { this.errors = []; this.warnings = []; }
  error(file, field, message) { this.errors.push({ file, field, message }); }
  warn(file, message, card = null) { this.warnings.push({ file, card, message }); }
}

// ---------- 读文件 ----------
function readJson(root, rel, problems, hashes) {
  const abs = path.join(root, rel);
  const raw = fs.readFileSync(abs, 'utf8');
  hashes[rel] = crypto.createHash('sha256').update(raw).digest('hex');
  try {
    return JSON.parse(raw);
  } catch (e) {
    problems.error(rel, '(整个文件)', `不是合法 JSON：${e.message}（JSON 里不能有注释和尾逗号）`);
    return undefined;
  }
}

function listJson(root, dir, problems) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const name of fs.readdirSync(abs).sort()) {
    if (name.startsWith('.')) continue;
    const rel = path.posix.join(dir, name);
    if (fs.statSync(path.join(root, rel)).isDirectory()) continue;
    if (!name.endsWith('.json')) { problems.error(rel, '(文件名)', '这个目录只能放 .json 文件'); continue; }
    out.push(rel);
  }
  return out;
}

function loadSchema(name) {
  return JSON.parse(fs.readFileSync(path.join(REPO, 'schema', `${name}.schema.json`), 'utf8'));
}

function check(schema, data, rel, problems) {
  const errs = validate(schema, data);
  for (const e of errs) problems.error(rel, e.path, e.message);
  return errs.length === 0;
}

// ---------- git ----------
function gitInfo(root) {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return { top: fs.realpathSync(top) };
  } catch {
    return null;
  }
}

function gitRel(git, root, rel) {
  return path.relative(git.top, path.join(fs.realpathSync(root), rel)).split(path.sep).join('/');
}

function gitRun(git, args) {
  return execFileSync('git', args, { cwd: git.top, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 }).toString();
}

function gitOk(git, args) {
  try { gitRun(git, args); return true; } catch { return false; }
}

function gitShow(git, ref, relTop) {
  try {
    return execFileSync('git', ['show', `${ref}:${relTop}`], { cwd: git.top, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }).toString();
  } catch {
    return null;
  }
}

// 从 git 历史里取这张卡 stage 的变化：[{stage, at}]，at 是提交时间
function stageHistory(git, root, rel, current) {
  const out = [];
  try {
    const log = execFileSync('git', ['log', '--follow', '--name-only', '--format=@@%H %cI', '--', gitRel(git, root, rel)],
      { cwd: git.top, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }).toString();
    const commits = [];
    for (const block of log.split('@@').filter(Boolean)) {
      const lines = block.trim().split('\n').filter(Boolean);
      const [hash, at] = lines[0].split(' ');
      if (lines[1]) commits.push({ hash, at, file: lines[1] });
    }
    for (const c of commits.reverse()) {
      const raw = gitShow(git, c.hash, c.file);
      if (!raw) continue;
      let card; try { card = JSON.parse(raw); } catch { continue; }
      if (!out.length || out[out.length - 1].stage !== card.stage) out.push({ stage: card.stage, at: card.stage_since || c.at });
    }
  } catch { /* 没有历史就只给当前 */ }
  if (!out.length || out[out.length - 1].stage !== current.stage) out.push({ stage: current.stage, at: current.stage_since });
  return out;
}

// ---------- 和上一个提交比：阶段只能按状态图走 ----------
function checkTransition(prev, cur, rel, problems) {
  const changed = JSON.stringify({ ...prev, last_touched: null }) !== JSON.stringify({ ...cur, last_touched: null });
  if (changed && prev.last_touched === cur.last_touched) {
    problems.error(rel, '/last_touched', '卡改了但 last_touched 没更新');
  }
  if (prev.no != null && prev.no !== cur.no) problems.error(rel, '/no', `编号 no 从 ${prev.no} 改成了 ${cur.no}；编号建卡时定下，之后不改（旧版卡第一次补上编号不算）`);
  if (prev.stage === cur.stage) return;
  if (prev.stage_since === cur.stage_since) problems.error(rel, '/stage_since', `stage 从 ${prev.stage} 改成 ${cur.stage}，但 stage_since 没更新`);
  const a = STAGES.indexOf(prev.stage);
  const b = STAGES.indexOf(cur.stage);
  if (b > a) {
    const jumped = STAGES.slice(a + 1, b).filter((s) => !cur.skipped.includes(s));
    if (jumped.length) problems.error(rel, '/stage', `stage 从 ${prev.stage} 直接到 ${cur.stage}，跳过了 ${jumped.join('、')}；只能往前走一格，要跳的格先写进 skipped`);
    return;
  }
  // 往回只允许：样片没过，从样片关卡回到剪辑或录制，并在 notes 里记原因
  const okBack = prev.stage === 'sample_gate' && (cur.stage === 'edit' || cur.stage === 'record');
  if (!okBack) {
    problems.error(rel, '/stage', `stage 不能从 ${prev.stage} 退回 ${cur.stage}；往回只允许样片没过时从 sample_gate 回到 edit 或 record`);
  } else {
    if (cur.sample_gate.result !== 'fail') problems.error(rel, '/sample_gate/result', '从 sample_gate 退回要先把 sample_gate.result 写成 fail');
    if (cur.notes.length <= prev.notes.length) problems.error(rel, '/notes', '样片没过退回时要在 notes 里加一条记原因');
  }
}

// 区间里每个提交：它改动（新增、修改、改名挪目录）的卡，和父提交里的同一张卡比
function checkRange(git, range, cardsTop, cardSchema, problems) {
  let commits;
  try {
    commits = gitRun(git, ['rev-list', '--reverse', range]).split('\n').filter(Boolean);
  } catch (e) {
    problems.error('(git)', range, `--range 读不出提交：${String(e.stderr || e.message).trim().split('\n')[0]}`);
    return;
  }
  for (const sha of commits) {
    if (!gitOk(git, ['rev-parse', '--verify', '-q', `${sha}^1`])) continue; // 根提交没有父提交
    const short = sha.slice(0, 7);
    const lines = gitRun(git, ['diff-tree', '--no-commit-id', '-r', '-M', '--name-status', `${sha}^1`, sha, '--', cardsTop]).split('\n').filter(Boolean);
    for (const line of lines) {
      const [status, a, b] = line.split('\t');
      if (!/^[AMR]/.test(status)) continue;
      const newPath = b || a;
      if (!newPath.endsWith('.json')) continue;
      const oldPaths = status.startsWith('R') ? [a] : [newPath, `${cardsTop}/active/${path.posix.basename(newPath)}`];
      let prevRaw = null;
      for (const p of oldPaths) { prevRaw = gitShow(git, `${sha}^1`, p); if (prevRaw) break; }
      const curRaw = gitShow(git, sha, newPath);
      if (!prevRaw || !curRaw) continue;
      let prev; let cur;
      try { prev = JSON.parse(prevRaw); cur = JSON.parse(curRaw); } catch { continue; }
      // 历史里本来就不合法的版本没法比，跳过（当前版本另有 schema 校验）
      if (validate(cardSchema, prev).length || validate(cardSchema, cur).length) continue;
      checkTransition(prev, cur, `${newPath} @ ${short}`, problems);
    }
  }
}

// ---------- 小算术 ----------
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
const round = (x, d = 4) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

function rates(metrics) {
  const m = metrics || {};
  const per = (k, mult = 1) => (m[k] != null && m.plays > 0 ? (m[k] / m.plays) * mult : null);
  return {
    like_rate: per('likes'),
    comment_rate: per('comments'),
    favorite_rate: per('favorites'),
    followers_per_1k: per('new_followers', 1000),
    completion_5s: m.completion_5s ?? null,
    avg_watch_ratio: m.avg_watch_ratio ?? null,
    bounce_2s: m.bounce_2s ?? null,
  };
}

// 中文按相邻两字、英文和数字按整词，重合度 = 共同词数 ÷ 较短一方的词数（短灵感对长卡也能比出来）
function tokens(text) {
  const set = new Set();
  const s = (text || '').toLowerCase();
  for (const w of s.match(/[a-z0-9]+/g) || []) if (w.length > 1) set.add(w);
  for (const run of s.match(/[一-鿿]+/g) || []) {
    if (run.length === 1) set.add(run);
    for (let i = 0; i < run.length - 1; i++) set.add(run.slice(i, i + 2));
  }
  return set;
}
function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / Math.min(a.size, b.size);
}

// ---------- DOU+ ----------
function douplusFirst(sample, cfg) {
  const t = cfg.douplus.thresholds;
  if (!sample) return { status: 'waiting', note: '等 h10 采样' };
  const m = sample.metrics;
  const favRate = m.favorites != null && m.plays > 0 ? m.favorites / m.plays : null;
  const checks = [
    { id: 'bounce_2s', value: m.bounce_2s ?? null, rule: `≤ ${t.bounce_2s_max}`, pass: m.bounce_2s == null ? null : m.bounce_2s <= t.bounce_2s_max },
    { id: 'completion_5s', value: m.completion_5s ?? null, rule: `≥ ${t.completion_5s_min}`, pass: m.completion_5s == null ? null : m.completion_5s >= t.completion_5s_min },
    { id: 'avg_watch_ratio', value: m.avg_watch_ratio ?? null, rule: `≥ ${t.avg_watch_ratio_min}`, pass: m.avg_watch_ratio == null ? null : m.avg_watch_ratio >= t.avg_watch_ratio_min },
  ];
  // 互动：收藏率达标或评论数达标，任一满足就过；两边都能算且都没达标才算不过
  const favPass = favRate == null ? null : favRate >= t.favorite_rate_min;
  const comPass = m.comments == null ? null : m.comments >= t.comments_min;
  const interPass = favPass === true || comPass === true ? true : (favPass === false && comPass === false ? false : null);
  checks.push({ id: 'interaction', value: { favorite_rate: round(favRate), comments: m.comments ?? null }, rule: `收藏率 ≥ ${t.favorite_rate_min} 或评论 ≥ ${t.comments_min}`, pass: interPass });
  const missing = checks.filter((c) => c.pass === null).map((c) => c.id);
  const failed = checks.filter((c) => c.pass === false).map((c) => c.id);
  const status = missing.length ? 'incomplete' : failed.length ? 'skip' : 'invest';
  const out = { status, checks, failed, missing, sample_taken_at: sample.taken_at };
  if (status === 'invest') {
    out.suggestion = { amount: cfg.douplus.first_amount, hours: cfg.douplus.first_hours, goal: cfg.douplus.goal, targeting: cfg.douplus.targeting, accounts: cfg.douplus.similar_accounts };
  }
  return out;
}

function douplusTopUp(pub, h10, cfg) {
  const d = pub.douplus;
  if (!d || d.decision !== 'invest' || !d.ordered_at) return { status: 'not_applicable' };
  const h12 = pub.samples.find((s) => s.point === cfg.douplus.top_up_sample_point);
  const spent = (d.amount || 0) + (d.top_up ? d.top_up.amount : 0);
  if (d.top_up) return { status: 'done', spent };
  if (!h12 || !h10) return { status: 'waiting', spent, note: '等下单后 12 小时采样' };
  const a = h10.metrics; const b = h12.metrics;
  const fav = (m) => (m.favorites != null && m.plays > 0 ? m.favorites / m.plays : null);
  const items = [
    { id: 'bounce_2s', before: a.bounce_2s, after: b.bounce_2s, better: (x, y) => y < x },
    { id: 'completion_5s', before: a.completion_5s, after: b.completion_5s, better: (x, y) => y > x },
    { id: 'avg_watch_ratio', before: a.avg_watch_ratio, after: b.avg_watch_ratio, better: (x, y) => y > x },
    fav(a) != null && fav(b) != null
      ? { id: 'favorite_rate', before: fav(a), after: fav(b), better: (x, y) => y > x }
      : { id: 'comments', before: a.comments, after: b.comments, better: (x, y) => y > x },
  ];
  const improved = items.filter((i) => i.before != null && i.after != null && i.better(i.before, i.after)).map((i) => i.id);
  const unknown = items.filter((i) => i.before == null || i.after == null).map((i) => i.id);
  const room = spent + cfg.douplus.top_up_amount <= cfg.douplus.cap_per_video;
  const enough = improved.length >= cfg.douplus.top_up_min_improved;
  let status = enough && room ? 'suggest' : 'no';
  if (!enough && improved.length + unknown.length >= cfg.douplus.top_up_min_improved) status = 'incomplete';
  const out = { status, improved, unknown, spent, cap: cfg.douplus.cap_per_video };
  if (status === 'suggest') out.suggestion = { amount: cfg.douplus.top_up_amount };
  return out;
}

// ---------- 主流程 ----------
function main() {
  const opt = parseArgs(process.argv.slice(2));
  const root = opt.root;
  const problems = new Problems();
  const hashes = {};
  const nowMs = opt.now ? parseTime(opt.now) : Date.now();

  const schemas = { card: loadSchema('card'), review: loadSchema('review'), config: loadSchema('config'), adapter: loadSchema('adapter') };
  for (const n of Object.keys(schemas)) {
    hashes[`schema/${n}.schema.json`] = crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO, 'schema', `${n}.schema.json`))).digest('hex');
  }

  // 1. 读并校验 config
  if (!fs.existsSync(path.join(root, 'config.json'))) { report(problems, 'config.json 不存在'); return; }
  const cfg = readJson(root, 'config.json', problems, hashes);
  if (cfg === undefined || !check(schemas.config, cfg, 'config.json', problems)) { report(problems); return; }
  const tz = cfg.timezone;
  try { formatTime(nowMs, tz); } catch { problems.error('config.json', '/timezone', `不认识的时区 ${tz}`); report(problems); return; }
  const fmt = (ms) => (ms == null ? null : formatTime(ms, tz));
  const platformIds = new Set(cfg.platforms.map((p) => p.id));
  if (platformIds.size !== cfg.platforms.length) problems.error('config.json', '/platforms', '平台 id 有重复');
  const required = cfg.platforms.filter((p) => p.required).map((p) => p.id);
  const screenIds = cfg.scoring.screens.map((s) => s.id);
  if (new Set(screenIds).size !== 4) problems.error('config.json', '/scoring/screens', '四道筛 id 必须各不相同');

  // 2. 适配器
  const adapters = {};
  for (const p of cfg.platforms) {
    const rel = `adapters/${p.id}/adapter.json`;
    if (!fs.existsSync(path.join(root, rel))) { problems.error(rel, '(文件)', `config 里有平台 ${p.id}，但没有它的 adapter.json`); continue; }
    const a = readJson(root, rel, problems, hashes);
    if (a === undefined || !check(schemas.adapter, a, rel, problems)) continue;
    if (a.id !== p.id) problems.error(rel, '/id', `应为 ${p.id}（等于目录名）`);
    if (a.steps !== `adapters/${p.id}/steps.md`) problems.error(rel, '/steps', `应为 adapters/${p.id}/steps.md`);
    else if (!fs.existsSync(path.join(root, a.steps))) problems.error(rel, '/steps', `${a.steps} 不存在`);
    if (a.mode !== p.adapter_mode) problems.error(rel, '/mode', `和 config.json 里的 adapter_mode（${p.adapter_mode}）不一致`);
    adapters[p.id] = a;
  }

  // 3. 卡
  const cards = []; // {rel, card, archived}
  for (const rel of listJson(root, 'cards/active', problems)) cards.push({ rel, archived: false });
  const archiveDir = path.join(root, 'cards/archive');
  if (fs.existsSync(archiveDir)) {
    for (const year of fs.readdirSync(archiveDir).sort()) {
      if (year.startsWith('.')) continue;
      const relDir = `cards/archive/${year}`;
      if (!fs.statSync(path.join(root, relDir)).isDirectory()) { problems.error(relDir, '(文件)', 'cards/archive/ 下只能是年份目录'); continue; }
      if (!/^\d{4}$/.test(year)) problems.error(relDir, '(目录名)', '归档目录必须是四位年份');
      for (const rel of listJson(root, relDir, problems)) cards.push({ rel, archived: true, year });
    }
  }
  const byId = new Map();
  const knownIds = new Set(cards.map((e) => path.posix.basename(e.rel, '.json'))); // 校验没过的卡也算存在，免得引用它的复盘连带报错
  for (const entry of cards) {
    const card = readJson(root, entry.rel, problems, hashes);
    if (card === undefined) continue;
    if (!check(schemas.card, card, entry.rel, problems)) continue;
    entry.card = card;
    const base = path.posix.basename(entry.rel, '.json');
    if (card.id !== base) problems.error(entry.rel, '/id', `id（${card.id}）必须等于文件名（${base}）`);
    if (byId.has(card.id)) problems.error(entry.rel, '/id', `id 和 ${byId.get(card.id).rel} 重复`);
    byId.set(card.id, entry);
  }

  // 4. 复盘
  const reviews = [];
  for (const rel of listJson(root, 'reviews', problems)) {
    const r = readJson(root, rel, problems, hashes);
    if (r === undefined || !check(schemas.review, r, rel, problems)) continue;
    if (`${r.week}.json` !== path.posix.basename(rel)) problems.error(rel, '/week', `week（${r.week}）必须等于文件名`);
    reviews.push({ rel, review: r });
  }
  reviews.sort((a, b) => a.review.week.localeCompare(b.review.week));
  const reviewedIn = new Map(); // card id -> [{week,status}]
  for (const { rel, review: r } of reviews) {
    const refs = [
      ...r.cards.map((c, i) => [c, `/cards/${i}`]),
      ...(r.best ? [[r.best.card, '/best/card']] : []),
      ...(r.worst ? [[r.worst.card, '/worst/card']] : []),
      ...r.patterns.flatMap((p, i) => (p.cards || []).map((c, j) => [c, `/patterns/${i}/cards/${j}`])),
      ...r.archived.flatMap((a, i) => [[a.card, `/archived/${i}/card`], ...(a.merged_into ? [[a.merged_into, `/archived/${i}/merged_into`]] : [])]),
    ];
    for (const [id, field] of refs) if (!knownIds.has(id)) problems.error(rel, field, `引用的卡 ${id} 不存在（active 和 archive 里都没有）`);
    for (const id of r.cards) {
      if (!reviewedIn.has(id)) reviewedIn.set(id, []);
      reviewedIn.get(id).push({ week: r.week, status: r.status });
    }
  }

  // 5. 跨字段检查
  const valid = cards.filter((e) => e.card);
  const byNo = new Map();
  for (const e of valid) {
    const { card, rel } = e;
    if (byNo.has(card.no)) problems.error(rel, '/no', `编号 ${card.no} 和 ${byNo.get(card.no)} 重复；新卡取所有卡（含归档）最大编号 +1`);
    else byNo.set(card.no, e.rel);
    if (card.ask) {
      if (e.archived) problems.error(rel, '/ask', '归档的卡不能还挂着 ask；先处理掉再归档');
      if (parseTime(card.ask.default_at) <= parseTime(card.ask.asked_at)) problems.error(rel, '/ask/default_at', '要晚于 asked_at（默认 asked_at + config.ask.default_hours 小时）');
    }
    if (!e.archived && card.archived_at) problems.error(rel, '/archived_at', '写了 archived_at 的卡要挪到 cards/archive/<年>/');
    if (e.archived && !card.archived_at) problems.error(rel, '/archived_at', '归档区的卡必须有 archived_at 和 archive_reason');
    if (e.archived && card.archived_at && card.archived_at.slice(0, 4) !== e.year) problems.warn(rel, `归档年份目录（${e.year}）和 archived_at 不一致`, card.id);
    if (card.merged_into && !knownIds.has(card.merged_into)) problems.error(rel, '/merged_into', `目标卡 ${card.merged_into} 不存在`);
    if (card.merged_into === card.id) problems.error(rel, '/merged_into', '不能合并到自己');
    if (card.skipped.includes(card.stage)) problems.error(rel, '/stage', `当前阶段 ${card.stage} 写在了 skipped 里`);
    if (card.tier === 'shelved' && card.stage !== 'topic' && IN_PRODUCTION.has(card.stage) === false) problems.warn(rel, '搁置的卡停在发布之后的阶段，确认一下', card.id);
    if (parseTime(card.last_touched) < parseTime(card.stage_since)) problems.error(rel, '/last_touched', '不能早于 stage_since');
    const seenPlatforms = new Set();
    card.publications.forEach((pub, i) => {
      const pp = `/publications/${i}`;
      if (!platformIds.has(pub.platform)) problems.error(rel, `${pp}/platform`, `config.json 里没有平台 ${pub.platform}`);
      if (seenPlatforms.has(pub.platform)) problems.error(rel, `${pp}/platform`, `同一平台 ${pub.platform} 只能有一条发布记录`);
      seenPlatforms.add(pub.platform);
      const pubMs = parseTime(pub.published_at);
      const adapter = adapters[pub.platform];
      const seenPoints = new Set();
      pub.samples.forEach((s, j) => {
        const sp = `${pp}/samples/${j}`;
        if (seenPoints.has(s.point)) problems.error(rel, `${sp}/point`, `采样点 ${s.point} 重复`);
        seenPoints.add(s.point);
        if (s.point === 'douplus_h12' && !(pub.platform === 'douyin' && pub.douplus && pub.douplus.ordered_at)) {
          problems.error(rel, `${sp}/point`, 'douplus_h12 只用于已下单 DOU+ 的抖音发布（先有 douplus.ordered_at）');
        }
        if (parseTime(s.taken_at) < pubMs) problems.error(rel, `${sp}/taken_at`, '采样时间早于发布时间');
        for (const k of s.missing) if (k in s.metrics) problems.error(rel, `${sp}/missing`, `${k} 已经有数了，不能同时写在 missing 里`);
        if (adapter) {
          for (const k of Object.keys(s.metrics)) if (!adapter.metrics.includes(k)) problems.error(rel, `${sp}/metrics/${k}`, `${pub.platform} 的适配器没有这个指标；平台没有的指标不写`);
          for (const k of s.missing) if (!adapter.metrics.includes(k)) problems.error(rel, `${sp}/missing`, `${k} 不是 ${pub.platform} 适配器的指标，平台本来没有的不进 missing`);
          const unaccounted = adapter.metrics.filter((k) => !(k in s.metrics) && !s.missing.includes(k));
          if (unaccounted.length) problems.error(rel, `${sp}/missing`, `没读到的指标要写进 missing：${unaccounted.join('、')}`);
        }
        const pt = cfg.sample_points[s.point];
        const anchor = pt.anchor === 'published_at' ? pubMs : (pub.douplus && pub.douplus.ordered_at ? parseTime(pub.douplus.ordered_at) : null);
        if (anchor != null) {
          const h = (parseTime(s.taken_at) - anchor) / HOUR;
          if (h < pt.window[0] || h > pt.window[1]) problems.warn(rel, `${pub.platform} ${s.point} 采样在第 ${round(h, 1)} 小时，超出窗口 ${pt.window[0]}–${pt.window[1]} 小时`, card.id);
        }
      });
    });
    if (card.stage === 'reviewed') {
      for (const pid of required) {
        const pub = card.publications.find((p) => p.platform === pid);
        if (!pub || !pub.samples.some((s) => s.point === 'd7')) problems.error(rel, '/stage', `进「已复盘」要求必录平台 ${pid} 的 d7 已录`);
      }
      if (!reviewedIn.has(card.id)) problems.error(rel, '/stage', '进「已复盘」要求有一份周复盘的 cards 引用它');
    }
  }

  // 6. 阶段流转：工作区和基准提交比；给了 --range 再逐个提交和父提交比
  const git = opt.git ? gitInfo(root) : null;
  if (opt.git && !git) problems.warn('(git)', '不在 git 仓库里，跳过阶段流转检查和阶段时间线');
  if (git) {
    if (gitOk(git, ['rev-parse', '--is-shallow-repository']) && gitRun(git, ['rev-parse', '--is-shallow-repository']).trim() === 'true') {
      problems.warn('(git)', 'git 历史不全，阶段时间线和流转检查可能不准');
    }
    const cardsTop = gitRel(git, root, 'cards');
    let base = opt.base;
    if (!base) {
      const dirty = gitOk(git, ['rev-parse', 'HEAD']) && gitRun(git, ['status', '--porcelain', '--', cardsTop]).trim() !== '';
      base = dirty ? 'HEAD' : (gitOk(git, ['rev-parse', '--verify', '-q', 'HEAD~1^{commit}']) ? 'HEAD~1' : null);
    }
    if (base) {
      for (const e of valid) {
        const cur = e.card;
        const candidates = [gitRel(git, root, e.rel), gitRel(git, root, `cards/active/${cur.id}.json`)];
        let prevRaw = null;
        for (const c of candidates) { prevRaw = gitShow(git, base, c); if (prevRaw) break; }
        if (!prevRaw) continue;
        let prev; try { prev = JSON.parse(prevRaw); } catch { continue; }
        if (prev.schema_version !== cur.schema_version) continue;
        checkTransition(prev, cur, e.rel, problems);
      }
    }
    if (opt.range) checkRange(git, opt.range, cardsTop, schemas.card, problems);
  }

  if (problems.errors.length) { report(problems); return; }

  // ---------- 派生字段 ----------
  const allPubs = []; // 基线用：所有卡（含归档）的发布
  for (const e of valid) for (const pub of e.card.publications) allPubs.push({ card: e.card.id, pub, ms: parseTime(pub.published_at) });

  function baseline(platform, point, rate, beforeMs, excludeCard) {
    const pool = allPubs
      .filter((x) => x.pub.platform === platform && x.card !== excludeCard && (beforeMs == null || x.ms < beforeMs))
      .map((x) => ({ ms: x.ms, v: rates((x.pub.samples.find((s) => s.point === point) || {}).metrics)[rate] }))
      .filter((x) => x.v != null)
      .sort((a, b) => b.ms - a.ms)
      .slice(0, cfg.compare.baseline_count);
    return { value: pool.length ? median(pool.map((x) => x.v)) : null, n: pool.length };
  }

  function label(rate, value, base) {
    if (value == null) return { value: null, baseline: round(base.value), n: base.n, vs: null, good: null };
    if (base.n < cfg.compare.baseline_min) return { value: round(value), baseline: round(base.value), n: base.n, vs: 'insufficient', good: null };
    let vs;
    if (base.value === 0) vs = value > 0 ? 'above' : 'flat';
    else {
      const r = value / base.value - 1;
      vs = r >= cfg.compare.above ? 'above' : r <= -cfg.compare.below ? 'below' : 'flat';
    }
    const higherIsGood = rate !== 'bounce_2s';
    const good = vs === 'flat' ? null : (vs === 'above') === higherIsGood;
    return { value: round(value), baseline: round(base.value), n: base.n, vs, good };
  }

  // 全局基线：各平台最近 N 条的中位数
  const baselines = {};
  for (const p of cfg.platforms) {
    baselines[p.id] = {};
    for (const point of PUBLISH_POINTS) {
      baselines[p.id][point] = {};
      for (const rate of RATES) {
        const b = baseline(p.id, point, rate, null, null);
        baselines[p.id][point][rate] = { value: round(b.value), n: b.n };
      }
    }
  }

  const active = valid.filter((e) => !e.archived);
  const archived = valid.filter((e) => e.archived);
  const tokenCache = new Map(active.map((e) => [e.card.id, tokens(`${e.card.title} ${e.card.conclusion || ''}`)]));
  const indexCards = [];
  const todayItems = [];
  const archiveCandidates = [];
  const asks = []; // 首页「等你」：卡上的 ask + 脚本生成的 DOU+ 拍板
  const nowWeek = isoWeek(nowMs, tz);
  const weekday = isoWeekday(nowMs, tz);
  const today = (() => { const d = localDate(nowMs, tz); return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`; })();
  const dayOf = (ms) => fmt(ms).slice(0, 10);
  // 必拍离截止还有几个日历天，和页面上「后天截止」的说法一致
  const deadlineDaysLeft = (c) => daysBetween(today, dayOf(parseTime(c.deadline)));
  const deadlineText = (n) => (n < 0 ? '已过截止' : n === 0 ? '今天截止' : n === 1 ? '明天截止' : n === 2 ? '后天截止' : `${n} 天后截止`);
  const pointName = { h10: '10 小时', d3: '第 3 天', d7: '第 7 天', douplus_h12: 'DOU+ 下单后 12 小时' };
  const pointShort = { h10: '10 小时', d3: '第 3 天', d7: '第 7 天', douplus_h12: '投后 12 小时' };
  const platformName = Object.fromEntries(cfg.platforms.map((p) => [p.id, p.name]));
  // 计划发布的先后：必拍按截止时间，其余按计划周的周一；都没有的排最后
  const planMs = (c) => (c.tier === 'must' && c.deadline ? parseTime(c.deadline)
    : c.plan_week ? localMidnight(isoWeekMonday(c.plan_week), tz) : Infinity);

  for (const e of active) {
    const c = e.card;
    const derived = {};
    const total = SCREENS.map((s) => c.scores[s]).filter(Boolean).reduce((a, s) => a + s.score, 0);
    const scoredCount = SCREENS.filter((s) => c.scores[s]).length;
    const producing = (c.tier === 'decided' || c.tier === 'must') && IN_PRODUCTION.has(c.stage);
    const touched = parseTime(c.last_touched);
    const stuckAt = producing ? touched + cfg.stuck_days * DAY : null;
    const stuck = stuckAt != null && nowMs >= stuckAt;

    // 采样：每条发布的 h10/d3/d7，加上 DOU+ 下单后的 douplus_h12
    const nextSamples = [];
    const manualFill = [];
    if (c.stage !== 'reviewed') {
      for (const pub of c.publications) {
        const points = [...PUBLISH_POINTS];
        if (pub.platform === 'douyin' && pub.douplus && pub.douplus.ordered_at) points.push('douplus_h12');
        for (const point of points) {
          const pt = cfg.sample_points[point];
          const anchor = parseTime(pt.anchor === 'published_at' ? pub.published_at : pub.douplus.ordered_at);
          const s = pub.samples.find((x) => x.point === point);
          if (s) {
            if (s.missing.length) manualFill.push({ platform: pub.platform, point, missing: s.missing });
            continue;
          }
          const open = anchor + pt.window[0] * HOUR;
          const close = anchor + pt.window[1] * HOUR;
          let status = nowMs > close ? 'overdue' : nowMs >= open ? 'due' : 'upcoming';
          // 补不回来的点记 missed，不再当待办：窗口关了又过了一个窗口宽度，或者后一个采样点已经开窗、已录
          if (status === 'overdue') {
            const later = PUBLISH_POINTS.includes(point) ? PUBLISH_POINTS.slice(PUBLISH_POINTS.indexOf(point) + 1) : [];
            const tooLate = nowMs > close + (close - open);
            if (tooLate || later.some((lp) => pub.samples.some((x) => x.point === lp) || nowMs >= anchor + cfg.sample_points[lp].window[0] * HOUR)) status = 'missed';
          }
          nextSamples.push({ platform: pub.platform, point, due_at: fmt(anchor + pt.hours * HOUR), window_open: fmt(open), window_close: fmt(close), status });
        }
      }
    }
    nextSamples.sort((a, b) => parseTime(a.due_at) - parseTime(b.due_at));

    // DOU+
    const dy = c.publications.find((p) => p.platform === 'douyin');
    if (dy) {
      const h10 = dy.samples.find((s) => s.point === cfg.douplus.sample_point);
      derived.douplus = {
        first: douplusFirst(h10, cfg),
        top_up: douplusTopUp(dy, h10, cfg),
        decision: dy.douplus,
        open: dy.douplus.decision == null && !dy.samples.some((s) => s.point === 'd3'),
      };
    }

    // 多平台汇总和比率对比
    if (c.publications.length) {
      const totals = {};
      const rateTable = {};
      for (const point of PUBLISH_POINTS) {
        const t = { included: [], not_included: [] };
        for (const k of SUM_METRICS) t[k] = 0;
        for (const pub of c.publications) {
          const s = pub.samples.find((x) => x.point === point);
          if (!s) { t.not_included.push(pub.platform); continue; }
          t.included.push(pub.platform);
          for (const k of SUM_METRICS) {
            if (s.metrics[k] != null) t[k] += s.metrics[k];
            else (t[`${k}_missing`] ||= []).push(pub.platform);
          }
        }
        totals[point] = t;
      }
      for (const pub of c.publications) {
        rateTable[pub.platform] = {};
        const pubMs = parseTime(pub.published_at);
        for (const point of PUBLISH_POINTS) {
          const s = pub.samples.find((x) => x.point === point);
          if (!s) continue;
          const r = rates(s.metrics);
          rateTable[pub.platform][point] = {};
          for (const rate of RATES) rateTable[pub.platform][point][rate] = label(rate, r[rate], baseline(pub.platform, point, rate, pubMs, c.id));
        }
      }
      derived.compare = { totals, rates: rateTable, play_definitions: Object.fromEntries(cfg.platforms.map((p) => [p.id, p.play_definition])) };
    }

    // 相似选题：灵感和候选跟其他活跃卡比
    if (c.tier === 'idea' || c.tier === 'candidate') {
      derived.similar = active
        .filter((o) => o.card.id !== c.id)
        .map((o) => ({ card: o.card.id, title: o.card.title, score: round(overlap(tokenCache.get(c.id), tokenCache.get(o.card.id)), 3) }))
        .filter((x) => x.score >= cfg.similar.threshold)
        .sort((a, b) => b.score - a.score);
    } else derived.similar = [];

    derived.manual_fill = manualFill;

    // 等你：卡上的 ask，和脚本生成的 DOU+ 拍板（默认永远是不投）
    const base = { card: c.id, no: c.no, short_title: c.short_title, title: c.title, stage: c.stage, must: c.tier === 'must', deadline: c.deadline, plan_week: c.plan_week };
    const cardAsks = [];
    let ask = null;
    // 选项可以带「选了改什么」（set），页面只要文字；网页点了由 /api/act 直接改卡
    if (c.ask) {
      ask = { ...c.ask, options: askLabels(c.ask), past_default: nowMs >= parseTime(c.ask.default_at) };
      cardAsks.push({ kind: 'ask', ...base, ...ask });
    }
    const dpFirstOpen = derived.douplus && derived.douplus.open && ['invest', 'skip'].includes(derived.douplus.first.status);
    const dpTopUpOpen = derived.douplus && derived.douplus.top_up.status === 'suggest' && !(dy && dy.douplus && dy.douplus.top_up_declined_at);
    if (dpFirstOpen) {
      const f = derived.douplus.first;
      const amt = cfg.douplus.first_amount;
      cardAsks.push({
        kind: 'douplus', ...base,
        question: f.status === 'invest' ? 'DOU+ 投不投？' : 'DOU+ 这条不投，行吗？',
        context: f.status === 'invest' ? `抖音 10 小时四项都过，建议投 ${amt} 元 / ${cfg.douplus.first_hours} 小时。` : `抖音 10 小时有 ${f.failed.length} 项没过，建议不投。`,
        options: f.status === 'invest' ? [`投 ${amt}`, '不投'] : ['不投', `还是投 ${amt}`],
        if_no_answer: '不投。DOU+ 只有你能下单', asked_at: f.sample_taken_at, default_at: null, past_default: false,
      });
    }
    if (dpTopUpOpen) {
      const t = derived.douplus.top_up;
      cardAsks.push({
        kind: 'douplus_top_up', ...base, question: 'DOU+ 加投吗？',
        context: `投后 12 小时有 ${t.improved.length} 项变好，建议加投 ${t.suggestion.amount} 元。`,
        options: [`加投 ${t.suggestion.amount}`, '不加'], if_no_answer: '不加。DOU+ 只有你能下单',
        asked_at: (dy.samples.find((x) => x.point === cfg.douplus.top_up_sample_point) || {}).taken_at ?? null, default_at: null, past_default: false,
      });
    }
    asks.push(...cardAsks);
    const waiting = cardAsks.length > 0;

    // 胶片上的一行小字：按优先级只挑一条；带时间的同时给出绝对时刻 at，页面按当时的时间重算说法
    let short = null;
    const line = (c.tier === 'decided' || c.tier === 'must') && STATIONS.includes(c.stage);
    if (line) {
      const dueSample = nextSamples.find((x) => x.status === 'due' || x.status === 'overdue');
      const nextSample = nextSamples.find((x) => x.status === 'upcoming');
      const deadlineDays = c.tier === 'must' && c.deadline && IN_PRODUCTION.has(c.stage) ? deadlineDaysLeft(c) : null;
      if (deadlineDays != null && deadlineDays <= cfg.today.must_deadline_days) {
        short = { kind: 'deadline', cls: waiting ? 'you' : 'due', text: deadlineText(deadlineDays), at: c.deadline };
      } else if (cardAsks.some((a) => a.kind !== 'ask')) {
        short = { kind: 'douplus', cls: 'you', text: 'DOU+ 等你定', at: null };
      } else if (stuck) {
        short = { kind: 'stuck', cls: 'stuck', text: `卡住 ${Math.floor((nowMs - touched) / DAY)} 天`, at: fmt(touched) };
      } else if (ask) {
        short = { kind: 'ask', cls: 'you', text: '等你一句话', at: null };
      } else if (dueSample) {
        short = { kind: 'sample_due', cls: 'due', text: `该读${/^\d/.test(pointShort[dueSample.point]) ? ' ' : ''}${pointShort[dueSample.point]}数据`, at: dueSample.due_at };
      } else if (c.stage === 'data' && nextSample) {
        const d = localDate(parseTime(nextSample.due_at), tz);
        short = { kind: 'sample_next', cls: '', text: `${d.m}/${d.d} 读${/^\d/.test(pointShort[nextSample.point]) ? ' ' : ''}${pointShort[nextSample.point]}`, at: nextSample.due_at };
      } else if (c.next_action) {
        short = { kind: 'next_action', cls: '', text: c.next_action.text, at: null };
      }
    }
    if (git) derived.stage_history = stageHistory(git, root, e.rel, c);

    // 发了几个平台、缺哪个必录平台
    const missingRequired = c.stage === 'data' || c.stage === 'reviewed'
      ? required.filter((pid) => !c.publications.some((p) => p.platform === pid)) : [];
    if (missingRequired.length) problems.warn(e.rel, `已进入数据阶段，但必录平台没有发布记录：${missingRequired.join('、')}`, c.id);

    // 归档候选
    const addCandidate = (reason, eligibleMs) => {
      if (eligibleMs == null || nowMs >= eligibleMs - cfg.archive.upcoming_days * DAY) {
        archiveCandidates.push({ card: c.id, title: c.title, reason, eligible_at: fmt(eligibleMs ?? nowMs), due: eligibleMs == null || nowMs >= eligibleMs });
      }
    };
    if (c.merged_into) addCandidate('merged', null);
    else if (c.tier === 'idea') addCandidate('idea_30d', localMidnight(addDays(c.id.slice(0, 10), cfg.archive.idea_days), tz));
    else if (c.tier === 'shelved') addCandidate('shelved_60d', parseTime(c.tier_since) + cfg.archive.shelved_days * DAY);
    else if (c.stage === 'reviewed' && (reviewedIn.get(c.id) || []).some((r) => r.status === 'final')) addCandidate('done', null);

    indexCards.push({
      id: c.id, no: c.no, short_title: c.short_title, title: c.title, conclusion: c.conclusion, kind: c.kind, source: c.source,
      tier: c.tier, tier_since: c.tier_since, stage: c.stage, stage_since: c.stage_since, last_touched: c.last_touched,
      blocked_on: c.blocked_on, next_action: c.next_action, ask, waiting, short, line: null, plan_ms: planMs(c),
      stuck_at: fmt(stuckAt), stuck, skipped: c.skipped,
      plan_week: c.plan_week, deadline: c.deadline, shelved_reason: c.shelved_reason,
      total_score: scoredCount ? total : null, scored: scoredCount,
      scores: Object.fromEntries(SCREENS.map((s) => [s, c.scores[s] ? c.scores[s].score : null])),
      scored_by: c.scores.scored_by,
      sample_gate: c.sample_gate.result,
      platforms: c.publications.map((p) => p.platform),
      missing_required_platforms: missingRequired,
      next_samples: nextSamples,
      reviews: reviewedIn.get(c.id) || [],
      file: e.rel,
      derived,
    });

    // ---------- agent 待办（today）：收集候选项 ----------
    const groups = new Map();
    for (const s of nextSamples.filter((x) => x.status === 'due' || x.status === 'overdue')) {
      if (!groups.has(s.point)) groups.set(s.point, []);
      groups.get(s.point).push(s);
    }
    for (const [point, list] of groups) {
      const first = list.reduce((a, b) => (parseTime(a.due_at) <= parseTime(b.due_at) ? a : b));
      todayItems.push({
        kind: 'sample_due', priority: 1, card: c.id, title: c.title, point,
        platforms: list.map((x) => x.platform), due_at: first.due_at, overdue: list.some((x) => x.status === 'overdue'),
        douyin_h10: point === 'h10' && list.some((x) => x.platform === 'douyin'),
        text: (() => { const n = list.map((x) => platformName[x.platform]).join('、'); return `读${n}${/[A-Za-z]$/.test(n) || /^\d/.test(pointName[point]) ? ' ' : ''}${pointName[point]}数据`; })(),
      });
    }
    if (dpFirstOpen) {
      const f = derived.douplus.first;
      todayItems.push({
        kind: 'douplus_decision', priority: 2, card: c.id, title: c.title, suggestion: f.status,
        text: f.status === 'invest' ? `DOU+ 建议投 ${f.suggestion.amount} 元 / ${f.suggestion.hours} 小时，等你拍板` : `DOU+ 建议不投（没过 ${f.failed.length} 项），等你确认`,
      });
    }
    if (dpTopUpOpen) {
      todayItems.push({ kind: 'douplus_top_up', priority: 2, card: c.id, title: c.title, text: `DOU+ 可加投 ${cfg.douplus.top_up_amount} 元，等你拍板` });
    }
    let cardHasItem = false;
    if (c.tier === 'must' && c.deadline && IN_PRODUCTION.has(c.stage)) {
      const left = parseTime(c.deadline) - nowMs;
      const days = deadlineDaysLeft(c);
      if (days <= cfg.today.must_deadline_days) {
        todayItems.push({ kind: 'must_deadline', priority: 3, card: c.id, title: c.title, due_at: c.deadline, overdue: left < 0,
          text: left < 0 ? '必拍已过截止时间' : `必拍${deadlineText(days)}` });
        cardHasItem = true;
      }
    }
    if (stuck && !cardHasItem) {
      todayItems.push({ kind: 'stuck', priority: 4, card: c.id, title: c.title, stuck_at: fmt(stuckAt), stuck_for_ms: nowMs - touched,
        text: c.blocked_on ? `卡住 ${Math.floor((nowMs - touched) / DAY)} 天，在等：${c.blocked_on}` : `卡住 ${Math.floor((nowMs - touched) / DAY)} 天，停在 ${c.stage}` });
      cardHasItem = true;
    }
    if (ask && ask.past_default) {
      todayItems.push({ kind: 'ask_default_due', priority: 5, card: c.id, title: c.title, due_at: c.ask.default_at,
        text: `你没回「${c.ask.question}」，按默认做：${c.ask.if_no_answer}` });
    }
    if (manualFill.length) {
      todayItems.push({ kind: 'manual_fill', priority: 5, card: c.id, title: c.title, items: manualFill,
        text: `有 ${manualFill.reduce((a, m) => a + m.missing.length, 0)} 个指标没读到，等你手动补` });
    }
  }

  // 每个工位带子上最多 belt.max_on 盘：等你 > 卡住 > 计划发布早 > 编号小，其余进片盒排队
  const prio = (c) => (c.waiting ? 2 : c.stuck ? 1 : 0);
  const stations = STATIONS.map((stage) => {
    const list = indexCards.filter((c) => (c.tier === 'decided' || c.tier === 'must') && c.stage === stage)
      .sort((a, b) => prio(b) - prio(a) || a.plan_ms - b.plan_ms || a.no - b.no);
    const on = list.slice(0, cfg.belt.max_on);
    const queued = list.slice(cfg.belt.max_on);
    on.forEach((c, i) => { c.line = { station: stage, slot: i + 1, queue_pos: null }; });
    queued.forEach((c, i) => { c.line = { station: stage, slot: null, queue_pos: i + 1 }; });
    return { stage, on_belt: on.map((c) => c.id), queued: queued.map((c) => c.id) };
  });
  const onLine = indexCards.filter((c) => c.line);
  for (const c of indexCards) delete c.plan_ms;

  // 等你：必拍在前，再按计划发布的先后，再按编号
  const askPlan = (a) => planMs({ tier: a.must ? 'must' : null, deadline: a.deadline, plan_week: a.plan_week });
  asks.sort((a, b) => (b.must - a.must) || askPlan(a) - askPlan(b) || a.no - b.no);
  const summary = {
    videos: onLine.length,
    asks: asks.length,
    working: onLine.filter((c) => !c.waiting && !c.stuck && !c.line.queue_pos).length,
    stuck: onLine.filter((c) => c.stuck).length,
    queued: onLine.filter((c) => c.line.queue_pos).length,
  };

  // 周一：待你定的候选，合成一件
  const candidates = indexCards.filter((c) => c.tier === 'candidate').sort((a, b) => (b.total_score ?? -1) - (a.total_score ?? -1));
  // 选题池顶上的红框：有候选就一直挂着，默认是候选留到下周一
  const pickCandidates = candidates.length ? {
    cards: candidates.map((c) => c.id), question: '这周拍哪几条',
    context: `${candidates.length} 条候选，agent 已经按四项打好分，从高到低排。`,
    if_no_answer: '这周先拍已定的，候选留到下周一',
  } : null;
  if (weekday === cfg.today.candidate_weekday && candidates.length) {
    todayItems.push({ kind: 'pick_candidates', priority: 5, card: null, cards: candidates.map((c) => c.id),
      text: `${candidates.length} 张候选等你定这周拍哪几条` });
  }
  // 周日：本周复盘没定稿
  if (weekday === cfg.today.review_weekday) {
    const r = reviews.find((x) => x.review.week === nowWeek);
    if (!r || r.review.status !== 'final') {
      todayItems.push({ kind: 'review_due', priority: 5, card: null, week: nowWeek, text: r ? `${nowWeek} 复盘还是草稿` : `${nowWeek} 复盘还没写` });
    }
  }

  const due = (x) => (x.due_at ? parseTime(x.due_at) : Infinity);
  todayItems.sort((a, b) =>
    a.priority - b.priority
    || (a.kind === 'sample_due' && b.kind === 'sample_due' ? (b.douyin_h10 - a.douyin_h10) || due(a) - due(b) : 0)
    || (a.kind === 'stuck' && b.kind === 'stuck' ? b.stuck_for_ms - a.stuck_for_ms : 0)
    || due(a) - due(b));
  for (const t of todayItems) { delete t.stuck_for_ms; }

  // 归档索引：摘要 + 各平台 d7 关键数
  const archiveEntries = archived.map((e) => {
    const c = e.card;
    const d7 = {};
    for (const pub of c.publications) {
      const s = pub.samples.find((x) => x.point === 'd7');
      if (!s) continue;
      const r = rates(s.metrics);
      d7[pub.platform] = { plays: s.metrics.plays ?? null, likes: s.metrics.likes ?? null, favorites: s.metrics.favorites ?? null,
        new_followers: s.metrics.new_followers ?? null, like_rate: round(r.like_rate), favorite_rate: round(r.favorite_rate),
        completion_5s: r.completion_5s, avg_watch_ratio: r.avg_watch_ratio };
    }
    return { id: c.id, no: c.no, short_title: c.short_title, title: c.title, kind: c.kind, tier: c.tier, stage: c.stage, archived_at: c.archived_at,
      archive_reason: c.archive_reason, merged_into: c.merged_into, platforms: c.publications.map((p) => p.platform),
      reviews: reviewedIn.get(c.id) || [], file: e.rel, d7 };
  });

  // 来源哈希：所有来源文件路径 + 内容哈希，排序后再哈希一次
  const sourceFiles = Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)));
  const sourceHash = crypto.createHash('sha256').update(Object.entries(sourceFiles).map(([k, v]) => `${k}\0${v}`).join('\n')).digest('hex');
  const generatedAt = fmt(nowMs);

  const index = {
    schema_version: 2,
    generated_at: generatedAt,
    source_hash: sourceHash,
    source_files: sourceFiles,
    week: nowWeek,
    summary,
    asks,
    stations,
    pick_candidates: pickCandidates,
    today: todayItems,
    cards: indexCards,
    baselines,
    reviews: reviews.map(({ review: r }) => ({ week: r.week, status: r.status, cards: r.cards, best: r.best, worst: r.worst, patterns: r.patterns, next_week: r.next_week, archived: r.archived })),
    latest_next_week: (() => { const f = reviews.filter((x) => x.review.status === 'final').pop(); return f ? { week: f.review.week, items: f.review.next_week } : null; })(),
    archive_candidates: archiveCandidates,
    platforms: cfg.platforms.map((p) => ({ id: p.id, name: p.name, required: p.required, play_definition: p.play_definition })),
    warnings: problems.warnings,
  };
  const archiveIndex = { schema_version: 2, generated_at: generatedAt, source_hash: sourceHash, cards: archiveEntries };

  if (!opt.check) {
    // 先写临时文件，两个都写成功再一起改名，避免留下半份索引
    const targets = [['index.json', index], ['index.archive.json', archiveIndex]];
    for (const [name, data] of targets) fs.writeFileSync(path.join(root, `${name}.tmp`), JSON.stringify(data, null, 2) + '\n');
    for (const [name] of targets) fs.renameSync(path.join(root, `${name}.tmp`), path.join(root, name));
  }
  for (const w of problems.warnings) console.warn(`! ${w.file}  ${w.message}`);
  console.log(`${opt.check ? '校验通过（--check，未写文件）' : '已生成 index.json 和 index.archive.json'}：活跃 ${active.length} 张，归档 ${archived.length} 张，复盘 ${reviews.length} 份；等你 ${asks.length} 件，agent 待办 ${todayItems.length} 件；提醒 ${problems.warnings.length} 条`);
}

function report(problems, extra) {
  if (extra) console.error(`✗ ${extra}`);
  for (const e of problems.errors) console.error(`✗ ${e.file}  ${e.field}  ${e.message}`);
  console.error(`\n校验没过：${problems.errors.length} 处错误。没有生成索引，旧索引保持不变。`);
  process.exitCode = 1;
}

main();
