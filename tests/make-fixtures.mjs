// 生成 tests/fixtures/board/ 下的假卡和假复盘。改了这里就重跑：node tests/make-fixtures.mjs
// 「现在」固定为 2026-11-09T09:00:00+08:00（周一），见 tests/run.mjs。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(ROOT, '..');
const OUT = path.join(ROOT, 'fixtures/board');
const adapterMetrics = (p) => JSON.parse(fs.readFileSync(path.join(REPO, `adapters/${p}/adapter.json`), 'utf8')).metrics;

let nextNo = 1; // 编号按建卡顺序递增，归档卡也占号
function card(id, o) {
  return {
    schema_version: 2, id, no: o.no ?? nextNo++, short_title: o.short_title, title: o.title, conclusion: o.conclusion ?? null, kind: o.kind ?? null, source: o.source ?? 'own_use',
    tier: o.tier, tier_since: o.tier_since, tier_decided_by: o.tier_decided_by ?? (['decided', 'must'].includes(o.tier) ? 'user' : 'agent'),
    stage: o.stage ?? 'topic', stage_since: o.stage_since ?? o.tier_since, last_touched: o.last_touched ?? o.stage_since ?? o.tier_since,
    blocked_on: o.blocked_on ?? null, next_action: o.next_action ?? null, ask: o.ask ?? null, skipped: o.skipped ?? [], plan_week: o.plan_week ?? null, deadline: o.deadline ?? null,
    shelved_reason: o.shelved_reason ?? null, why: o.why ?? null,
    scores: o.scores ?? { takeaway: null, evidence: null, framework: null, search: null, scored_by: null },
    assets: { script_doc: null, script_version: null, record_version: null, local_project: null, edit_version: null, ...(o.assets || {}) },
    sample_gate: o.sample_gate ?? { result: 'pending', note: null, decided_by: null },
    publications: o.publications ?? [], notes: o.notes ?? [],
    archived_at: o.archived_at ?? null, archive_reason: o.archive_reason ?? null, merged_into: null,
  };
}
const sc = (a, b, c, d) => ({
  takeaway: { score: a, why: '观众能带走一套做法' }, evidence: { score: b, why: '有自己的实测截图' },
  framework: { score: c, why: '五步写了四步' }, search: { score: d, why: '搜索词有量' }, scored_by: 'agent',
});
// 按适配器补齐：给了的写进 metrics，适配器有但没给的进 missing
function sample(platform, point, taken_at, m, missing = []) {
  const metrics = {};
  for (const k of adapterMetrics(platform)) if (m[k] != null && !missing.includes(k)) metrics[k] = m[k];
  const miss = adapterMetrics(platform).filter((k) => !(k in metrics));
  return { point, taken_at, source: 'browser', read_by: 'test-agent', metrics, missing: miss };
}
function pub(platform, published_at, samples, douplus) {
  return { platform, url: `https://example.com/${platform}/${published_at.slice(0, 10)}`, post_id: `${platform}-${published_at.slice(5, 10)}`,
    published_at, title: '发布标题', samples, douplus: platform === 'douyin' ? (douplus ?? { decision: null, amount: null, ordered_at: null, top_up: null, decided_by: null }) : null };
}
const full = (plays, f) => ({ plays, bounce_2s: f.b, completion_5s: f.c, avg_watch_ratio: f.a, likes: Math.round(plays * f.l), comments: Math.round(plays * f.cm), shares: Math.round(plays * 0.002), favorites: Math.round(plays * f.fv), new_followers: Math.round(plays * f.nf) });
const gatePass = { result: 'pass', note: '开头 3 秒节奏可以', decided_by: 'agent' };

const active = [
  // 灵感：创建满 30 天，进归档候选；和 C 相似
  card('2026-10-05-ai-bookkeeping-test', { short_title: '记账', title: 'AI 记账工具实测', tier: 'idea', tier_since: '2026-10-05T10:00:00+08:00' }),
  // 候选：四道筛都有分；周一进「待你定」
  card('2026-11-03-ai-bookkeeping-month', { short_title: '记账月', title: '用 AI 记账工具一个月的实测', conclusion: '记账 App 不如一张表加一个 AI', tier: 'candidate', tier_since: '2026-11-04T10:00:00+08:00', scores: sc(2, 1, 1, 2) }),
  // 搁置：60 天没恢复，进归档候选
  card('2026-08-20-gym-playlist', { short_title: '歌单', title: '健身房歌单', kind: 'fitness', tier: 'shelved', tier_since: '2026-09-01T10:00:00+08:00', shelved_reason: '素材不够，等换季' }),
  // 必拍：距截止不到 3 天，在写文案
  card('2026-11-01-launch-intro', { short_title: '介绍', title: '账号介绍视频', conclusion: '一分钟说清这个号讲什么', kind: 'ai_talk', tier: 'must', tier_since: '2026-11-01T09:00:00+08:00',
    stage: 'script', stage_since: '2026-11-07T10:00:00+08:00', last_touched: '2026-11-08T21:00:00+08:00', plan_week: '2026-W46',
    deadline: '2026-11-11T23:59:00+08:00', why: '平台新人扶持活动 11 月 11 日截止', assets: { script_doc: 'https://example.com/doc/intro', script_version: 'v1' } }),
  // 已定 · 录制：4 天多没动，卡住
  card('2026-10-28-prompt-checklist', { short_title: '清单', title: '写提示词前先过一遍的清单', conclusion: '先写验收标准再写提示词', kind: 'ai_talk', tier: 'decided', tier_since: '2026-10-28T09:00:00+08:00',
    stage: 'record', stage_since: '2026-11-03T10:00:00+08:00', last_touched: '2026-11-04T20:00:00+08:00', plan_week: '2026-W45', scores: sc(2, 2, 1, 1),
    assets: { script_doc: 'https://example.com/doc/checklist', script_version: 'v3' } }),
  // 已定 · 剪辑：agent 拿不准，挂了 ask，还没到默认时间
  card('2026-10-30-agent-memory', { short_title: '记忆', title: '给 agent 加记忆的三种做法', conclusion: '记忆写进文件比写进对话靠谱', kind: 'ai_talk', tier: 'decided', tier_since: '2026-10-30T09:00:00+08:00',
    stage: 'edit', stage_since: '2026-11-07T10:00:00+08:00', last_touched: '2026-11-08T22:00:00+08:00', plan_week: '2026-W46',
    ask: { question: '开头用哪个案例', context: 'A 记账更多人有共鸣，B 写周报素材更全。agent 倾向 A。', options: ['用 A', '用 B'],
      if_no_answer: '用 A 记账开头，明晚出样片', asked_at: '2026-11-08T22:00:00+08:00', default_at: '2026-11-09T22:00:00+08:00' }, assets: { script_doc: 'https://example.com/doc/memory', script_version: 'v2', record_version: 'v1', local_project: '~/projects/example/memory', edit_version: 'v1' } }),
  // 健身 · 样片关卡：跳过了文案；问了结尾露不露脸，已过默认时间没回
  card('2026-11-02-squat-form', { short_title: '深蹲', title: '深蹲膝盖内扣怎么改', conclusion: '先练臀中肌再加重量', kind: 'fitness', tier: 'decided', tier_since: '2026-11-02T09:00:00+08:00',
    stage: 'sample_gate', stage_since: '2026-11-08T08:00:00+08:00', last_touched: '2026-11-08T08:00:00+08:00', plan_week: '2026-W46', skipped: ['script'],
    ask: { question: '结尾要不要露脸', context: '样片其他都过了，只差这一处。', options: ['露脸', '不露'],
      if_no_answer: '不露脸，用字幕收尾，然后放行', asked_at: '2026-11-08T08:00:00+08:00', default_at: '2026-11-09T08:00:00+08:00' } }),
  // 已定 · 发布：样片过了，还没发；在等外部的事，不用你回
  card('2026-10-26-cursor-vs-claude', { short_title: '对比', title: '两个写代码 agent 一周对比', conclusion: '小改动差不多，大重构差很多', kind: 'ai_talk', tier: 'decided', tier_since: '2026-10-26T09:00:00+08:00',
    stage: 'publish', stage_since: '2026-11-08T10:00:00+08:00', last_touched: '2026-11-08T10:00:00+08:00', plan_week: '2026-W46', sample_gate: gatePass,
    blocked_on: '等周三晚上发，避开周二的大更新', next_action: { who: 'agent', text: '周三晚 7 点发三个平台', sub: null } }),
  // 数据中 · 待采样：昨晚发了三个必录平台，h10 到点
  card('2026-10-27-daily-agent', { short_title: 'Agent', title: '一个 agent 的一天做了什么', conclusion: '让 agent 先写计划再动手', kind: 'ai_talk', tier: 'decided', tier_since: '2026-10-27T09:00:00+08:00',
    stage: 'data', stage_since: '2026-11-08T19:00:00+08:00', last_touched: '2026-11-08T20:05:00+08:00', plan_week: '2026-W45', sample_gate: gatePass,
    publications: [pub('douyin', '2026-11-08T19:00:00+08:00', []), pub('xiaohongshu', '2026-11-08T19:30:00+08:00', []), pub('x', '2026-11-08T20:00:00+08:00', [])] }),
  // 数据中 · 五个平台都发了：h10 都录了，d3 到点；小红书涨粉没读到
  card('2026-10-20-ai-weekly-report', { short_title: '周报', title: '用 AI 写周报的正确姿势', conclusion: '先给 AI 一周的原始记录，别让它编', kind: 'ai_talk', tier: 'decided', tier_since: '2026-10-20T09:00:00+08:00',
    stage: 'data', stage_since: '2026-11-05T19:00:00+08:00', last_touched: '2026-11-06T06:00:00+08:00', plan_week: '2026-W45', sample_gate: gatePass,
    publications: [
      pub('douyin', '2026-11-05T19:00:00+08:00', [sample('douyin', 'h10', '2026-11-06T05:10:00+08:00', { plays: 3000, bounce_2s: 0.45, completion_5s: 0.23, avg_watch_ratio: 0.04, likes: 60, comments: 3, shares: 2, favorites: 36, new_followers: 4 })]),
      pub('xiaohongshu', '2026-11-05T19:10:00+08:00', [sample('xiaohongshu', 'h10', '2026-11-06T05:20:00+08:00', { plays: 900, likes: 40, comments: 6, shares: 5, favorites: 30 })]),
      pub('x', '2026-11-05T19:20:00+08:00', [sample('x', 'h10', '2026-11-06T05:30:00+08:00', { plays: 5200, likes: 30, comments: 3, shares: 4, favorites: 12, new_followers: 2 })]),
      pub('youtube', '2026-11-05T19:30:00+08:00', [sample('youtube', 'h10', '2026-11-06T05:40:00+08:00', { plays: 300, avg_watch_ratio: 0.41, likes: 12, comments: 1, shares: 0, new_followers: 1 })]),
      pub('bilibili', '2026-11-05T19:40:00+08:00', [sample('bilibili', 'h10', '2026-11-06T05:50:00+08:00', { plays: 24, likes: 2, comments: 0, shares: 0, favorites: 1, new_followers: 0 })]),
    ] }),
];

// 归档的三张：已复盘、已归档，给基线提供历史
function doneCard(id, title, pubDay, f, week) {
  const d = (h) => new Date(Date.parse(`${pubDay}T19:00:00+08:00`) + h * 3600e3).toISOString().replace('.000Z', 'Z');
  const pts = (p, plays) => [sample(p, 'h10', d(10), full(plays, f)), sample(p, 'd3', d(72), full(plays * 3, f)), sample(p, 'd7', d(168), full(plays * 4, f))];
  return card(id, { short_title: '旧卡', title, conclusion: '样例结论', kind: 'ai_talk', tier: 'decided', tier_since: `${pubDay}T08:00:00+08:00`, plan_week: week,
    stage: 'reviewed', stage_since: d(200), last_touched: d(200), sample_gate: gatePass,
    publications: [pub('douyin', `${pubDay}T19:00:00+08:00`, pts('douyin', 2000), { decision: 'skip', amount: null, ordered_at: null, top_up: null, decided_by: 'user' }),
      pub('xiaohongshu', `${pubDay}T19:00:00+08:00`, pts('xiaohongshu', 800)), pub('x', `${pubDay}T19:00:00+08:00`, pts('x', 4000))],
    archived_at: d(220), archive_reason: 'done' });
}
const archived = [
  doneCard('2026-10-06-claude-code-setup', '本地 agent 环境搭建', '2026-10-08', { b: 0.42, c: 0.30, a: 0.07, l: 0.020, cm: 0.002, fv: 0.010, nf: 0.0010 }, '2026-W41'),
  doneCard('2026-10-10-notion-ai', '笔记软件里的 AI 值不值', '2026-10-12', { b: 0.38, c: 0.35, a: 0.09, l: 0.025, cm: 0.003, fv: 0.012, nf: 0.0015 }, '2026-W42'),
  doneCard('2026-10-14-ai-ppt', 'AI 做 PPT 实测', '2026-10-16', { b: 0.45, c: 0.28, a: 0.06, l: 0.015, cm: 0.001, fv: 0.008, nf: 0.0008 }, '2026-W42'),
];

const review = (week, status, cards, extra = {}) => ({
  schema_version: 2, week, status, cards,
  best: status === 'final' ? { card: cards[0], why: '收藏率最高' } : null,
  worst: status === 'final' ? { card: cards[cards.length - 1], why: '2s 跳出最高' } : null,
  patterns: status === 'final' ? [{ text: '开头先给结论的那条 2s 跳出 38%，比另一条低 4 个点', cards }] : [],
  next_week: status === 'final' ? ['开头 3 秒内先给结论', '标题里放一个数字'] : [],
  archived: [], updated_at: '2026-11-01T20:00:00+08:00', written_by: 'test-agent', ...extra,
});
const reviews = [
  review('2026-W41', 'final', ['2026-10-06-claude-code-setup']),
  review('2026-W42', 'final', ['2026-10-10-notion-ai', '2026-10-14-ai-ppt'], { archived: [{ card: '2026-10-06-claude-code-setup', reason: 'done' }] }),
  review('2026-W45', 'draft', ['2026-10-20-ai-weekly-report'], { updated_at: '2026-11-08T20:00:00+08:00' }),
];

fs.rmSync(OUT, { recursive: true, force: true });
const write = (rel, data) => { fs.mkdirSync(path.dirname(path.join(OUT, rel)), { recursive: true }); fs.writeFileSync(path.join(OUT, rel), JSON.stringify(data, null, 2) + '\n'); };
for (const c of active) write(`cards/active/${c.id}.json`, c);
for (const c of archived) write(`cards/archive/2026/${c.id}.json`, c);
for (const r of reviews) write(`reviews/${r.week}.json`, r);
console.log(`写了 ${active.length} 张活跃卡、${archived.length} 张归档卡、${reviews.length} 份复盘到 ${path.relative(REPO, OUT)}`);
