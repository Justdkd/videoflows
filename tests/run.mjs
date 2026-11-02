// 验收测试：node tests/run.mjs（或 npm test）。零依赖，只用 Node 自带模块和 git。
// 1. schema：每个 schema 的合法样例要过，非法样例都要被拦下，并且拦在预期的字段上
// 2. 假卡：tests/fixtures/board 的 10 张活跃卡 + 3 张归档卡跑通，派生字段、首页「等你」、工位排布、
//    胶片短状态和 agent 待办（today）符合预期
// 3. 改坏一个字段：脚本报错停下，指出文件和字段，旧索引不被改动
// 4. 阶段流转：借临时 git 仓库，检查跳格、乱退回、忘改 stage_since / last_touched 都会被拦；
//    提交之后再跑（比 HEAD~1）、--range 逐个提交查、浅克隆提示
//    编号 no 改了也会被拦
//    另外：DOU+ 加投、进已复盘的前提、归档候选 done / merged、一个工位超过 3 盘时排队
// 5. 当前仓库：当前的 config、adapters、cards、reviews 能通过校验
// 6. 网站：build-site 能从假数据生成页面和 data.json；卡有错时不出网站；页面脚本语法正确
// 7. 网页按钮直接改卡：每种按钮怎么改卡、过期 / 缺资料 / 过不了校验不写；
//    /api/act 怎么把关（登录凭证、同源、邮箱名单、缺设置拒收）、读写对着同一个提交、被抢就重来

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validate } from '../scripts/lib/validate.mjs';
import { parseAction, applyAction } from '../scripts/lib/actions.mjs';
import { handleAct, _resetCache } from '../scripts/lib/act-handler.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(REPO, 'scripts/build-index.mjs');
const NOW = '2026-11-09T09:00:00+08:00'; // 周一
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, d) => fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n      ${String(e.message).split('\n').join('\n      ')}`); }
}
async function atest(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n      ${String(e.message).split('\n').join('\n      ')}`); }
}

function build(root, ...extra) {
  const r = spawnSync(process.execPath, [BUILD, '--root', root, '--now', NOW, ...extra], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function board() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfp-test-'));
  fs.cpSync(path.join(REPO, 'tests/fixtures/board'), dir, { recursive: true });
  fs.copyFileSync(path.join(REPO, 'config.json'), path.join(dir, 'config.json'));
  fs.cpSync(path.join(REPO, 'adapters'), path.join(dir, 'adapters'), { recursive: true });
  return dir;
}
const cardPath = (dir, id) => path.join(dir, 'cards/active', `${id}.json`);
const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
function gitBoard() {
  const dir = board();
  git(dir, 'init', '-q');
  git(dir, '-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'add', '-A');
  git(dir, '-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  return dir;
}

// ---------- 1. schema ----------
console.log('schema 样例');
const cases = readJson(path.join(REPO, 'tests/schema/cases.json'));
for (const name of ['card', 'review', 'config', 'adapter']) {
  const schema = readJson(path.join(REPO, `schema/${name}.schema.json`));
  const dir = path.join(REPO, 'tests/schema', name);
  const files = fs.readdirSync(dir).sort();
  test(`${name}: 有 1 个合法样例和至少 2 个非法样例`, () => {
    assert.ok(files.includes('valid.json'));
    assert.ok(files.filter((f) => f.startsWith('invalid-')).length >= 2);
  });
  test(`${name}: valid.json 通过`, () => {
    const errs = validate(schema, readJson(path.join(dir, 'valid.json')));
    assert.deepEqual(errs, []);
  });
  for (const f of files.filter((x) => x.startsWith('invalid-'))) {
    test(`${name}: ${f} 被拦下`, () => {
      const errs = validate(schema, readJson(path.join(dir, f)));
      assert.ok(errs.length > 0, '没有报错');
      const expect = cases[name][f];
      assert.ok(expect, `cases.json 里没写 ${f} 预期拦在哪`);
      assert.ok(errs.some((e) => e.path.startsWith(expect) || e.message.includes(expect.slice(1))),
        `预期拦在 ${expect}，实际：${errs.map((e) => `${e.path} ${e.message}`).join('；')}`);
    });
  }
}
test('AGENTS.md 里的新卡模板能通过 card.schema.json', () => {
  const md = fs.readFileSync(path.join(REPO, 'AGENTS.md'), 'utf8');
  const block = md.match(/```json\n(\{\n  "schema_version"[\s\S]*?)\n```/);
  assert.ok(block, '没找到模板');
  assert.deepEqual(validate(readJson(path.join(REPO, 'schema/card.schema.json')), JSON.parse(block[1])), []);
});
test('config.json 通过 config.schema.json', () => {
  assert.deepEqual(validate(readJson(path.join(REPO, 'schema/config.schema.json')), readJson(path.join(REPO, 'config.json'))), []);
});
for (const p of ['douyin', 'xiaohongshu', 'x', 'youtube', 'bilibili']) {
  test(`adapters/${p}/adapter.json 通过 adapter.schema.json`, () => {
    assert.deepEqual(validate(readJson(path.join(REPO, 'schema/adapter.schema.json')), readJson(path.join(REPO, `adapters/${p}/adapter.json`))), []);
    assert.ok(fs.existsSync(path.join(REPO, `adapters/${p}/steps.md`)));
  });
}

// ---------- 2. 假卡跑通 ----------
console.log('假卡跑通');
const dir = board();
const r = build(dir, '--no-git');
test('build-index 退出码 0', () => assert.equal(r.code, 0, r.err));
const idx = fs.existsSync(path.join(dir, 'index.json')) ? readJson(path.join(dir, 'index.json')) : null;
const arc = fs.existsSync(path.join(dir, 'index.archive.json')) ? readJson(path.join(dir, 'index.archive.json')) : null;
const byId = (id) => idx.cards.find((c) => c.id === id);
test('写出 index.json 和 index.archive.json，带 generated_at 和来源哈希', () => {
  assert.equal(idx.generated_at, NOW);
  assert.match(idx.source_hash, /^[0-9a-f]{64}$/);
  assert.equal(arc.source_hash, idx.source_hash);
  assert.ok(Object.keys(idx.source_files).some((k) => k.startsWith('cards/active/')));
  assert.ok(Object.keys(idx.source_files).some((k) => k.startsWith('cards/archive/')));
  assert.ok(Object.keys(idx.source_files).some((k) => k.startsWith('reviews/')));
});
test('10 张活跃卡覆盖各档位和阶段，3 张归档卡进 index.archive.json', () => {
  assert.equal(idx.cards.length, 10);
  assert.equal(arc.cards.length, 3);
  const tiers = new Set(idx.cards.map((c) => c.tier));
  for (const t of ['idea', 'candidate', 'decided', 'must', 'shelved']) assert.ok(tiers.has(t), `缺 ${t}`);
  const stages = new Set([...idx.cards.map((c) => c.stage), ...arc.cards.map((c) => c.stage)]);
  for (const s of ['topic', 'script', 'record', 'edit', 'sample_gate', 'publish', 'data', 'reviewed']) assert.ok(stages.has(s), `缺 ${s}`);
});
test('总分：候选 2+1+1+2 = 6', () => assert.equal(byId('2026-11-03-ai-bookkeeping-month').total_score, 6));
test('卡住：录制卡 last_touched + 3 天 = stuck_at，已卡住', () => {
  const c = byId('2026-10-28-prompt-checklist');
  assert.equal(c.stuck, true);
  assert.equal(c.stuck_at, '2026-11-07T20:00:00+08:00');
  assert.equal(byId('2026-10-30-agent-memory').stuck, false);
});
test('待采样：昨晚发的三个平台 h10 都到点', () => {
  const c = byId('2026-10-27-daily-agent');
  const h10 = c.next_samples.filter((s) => s.point === 'h10');
  assert.deepEqual(h10.map((s) => s.platform).sort(), ['douyin', 'x', 'xiaohongshu']);
  assert.ok(h10.every((s) => s.status === 'due'));
  assert.equal(h10.find((s) => s.platform === 'douyin').due_at, '2026-11-09T05:00:00+08:00');
});
test('待采样：h10 窗口关了一天多还没录，记 missed，不再进 agent 待办', () => {
  const d = board();
  const r = spawnSync(process.execPath, [BUILD, '--root', d, '--now', '2026-11-10T12:00:00+08:00'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const ix = readJson(path.join(d, 'index.json'));
  const c = ix.cards.find((x) => x.id === '2026-10-27-daily-agent');
  assert.ok(c.next_samples.filter((s) => s.point === 'h10').every((s) => s.status === 'missed'));
  assert.ok(!ix.today.some((t) => t.kind === 'sample_due' && t.card === c.id && t.point === 'h10'));
  assert.notEqual(c.short && c.short.kind, 'sample_due');
});
test('多平台：五个平台 h10 汇总，缺的指标标出来不当 0', () => {
  const t = byId('2026-10-20-ai-weekly-report').derived.compare.totals.h10;
  assert.deepEqual(t.included, ['douyin', 'xiaohongshu', 'x', 'youtube', 'bilibili']);
  assert.equal(t.plays, 3000 + 900 + 5200 + 300 + 24);
  assert.deepEqual(t.new_followers_missing, ['xiaohongshu']);
  assert.deepEqual(t.favorites_missing, ['youtube']);
});
test('DOU+：三项不达标 → 建议不投', () => {
  const f = byId('2026-10-20-ai-weekly-report').derived.douplus.first;
  assert.equal(f.status, 'skip');
  assert.deepEqual(f.failed, ['bounce_2s', 'completion_5s', 'avg_watch_ratio']);
  assert.equal(f.checks.find((c) => c.id === 'interaction').pass, true);
});
test('基线：抖音 h10 用之前 3 条的中位数，±20% 标高低，跳出反向', () => {
  const rt = byId('2026-10-20-ai-weekly-report').derived.compare.rates;
  assert.equal(rt.douyin.h10.completion_5s.n, 3);
  assert.equal(rt.douyin.h10.completion_5s.baseline, 0.3);
  assert.equal(rt.douyin.h10.completion_5s.vs, 'below');
  assert.equal(rt.douyin.h10.completion_5s.good, false);
  assert.equal(rt.douyin.h10.bounce_2s.vs, 'flat');
  assert.equal(rt.bilibili.h10.like_rate.vs, 'insufficient');
  assert.equal(idx.baselines.douyin.h10.completion_5s.n, 4);
});
test('归档候选：灵感满 30 天、搁置满 60 天', () => {
  const m = Object.fromEntries(idx.archive_candidates.map((a) => [a.card, a]));
  assert.equal(m['2026-10-05-ai-bookkeeping-test'].reason, 'idea_30d');
  assert.equal(m['2026-10-05-ai-bookkeeping-test'].eligible_at, '2026-11-04T00:00:00+08:00');
  assert.equal(m['2026-08-20-gym-playlist'].reason, 'shelved_60d');
  assert.ok(Object.values(m).every((a) => a.due));
});
test('相似选题：两张记账卡互相标「可能重复」', () => {
  assert.equal(byId('2026-10-05-ai-bookkeeping-test').derived.similar[0].card, '2026-11-03-ai-bookkeeping-month');
});
test('等你：DOU+ 和两条 ask，按必拍、计划、编号排；过了默认时间的标出来', () => {
  assert.deepEqual(idx.asks.map((a) => [a.kind, a.card, a.no]), [
    ['douplus', '2026-10-20-ai-weekly-report', 10], // 已发布，计划最早
    ['ask', '2026-10-30-agent-memory', 6],
    ['ask', '2026-11-02-squat-form', 7],
  ]);
  const [dp, mem, sq] = idx.asks;
  assert.equal(dp.question, 'DOU+ 这条不投，行吗？');
  assert.equal(dp.default_at, null); // DOU+ 没有默认动作，只有用户能下单
  assert.equal(dp.short_title, '周报');
  assert.equal(mem.past_default, false);
  assert.equal(mem.default_at, '2026-11-09T22:00:00+08:00');
  assert.ok(mem.options.length >= 1 && mem.options.length <= 3);
  assert.equal(sq.past_default, true);
  assert.equal(byId('2026-10-30-agent-memory').waiting, true);
  assert.equal(byId('2026-10-26-cursor-vs-claude').waiting, false); // blocked_on 只是在等时间，不算等你
});
test('选候选不进首页「等你」，单独放 pick_candidates', () => {
  assert.ok(!idx.asks.some((a) => a.kind === 'pick_candidates'));
  assert.deepEqual(idx.pick_candidates.cards, ['2026-11-03-ai-bookkeeping-month']);
  assert.equal(idx.pick_candidates.question, '这周拍哪几条');
  assert.ok(idx.pick_candidates.if_no_answer);
});
test('顶部一句话：7 条在做，3 件等你，3 件 agent 在做，1 条卡住', () => {
  assert.deepEqual(idx.summary, { videos: 7, asks: 3, working: 3, stuck: 1, queued: 0 });
});
test('工位：7 个工位按顺序，等你的那盘排在前面', () => {
  assert.deepEqual(idx.stations.map((s) => s.stage), ['topic', 'script', 'record', 'edit', 'sample_gate', 'publish', 'data']);
  const data = idx.stations.find((s) => s.stage === 'data');
  assert.deepEqual(data.on_belt, ['2026-10-20-ai-weekly-report', '2026-10-27-daily-agent']);
  assert.deepEqual(byId('2026-10-27-daily-agent').line, { station: 'data', slot: 2, queue_pos: null });
  assert.equal(byId('2026-10-05-ai-bookkeeping-test').line, null); // 灵感不上线
  assert.equal(byId('2026-08-20-gym-playlist').line, null); // 搁置不上线
});
test('胶片短状态：截止 > DOU+ > 卡住 > 等你 > 该读数据 > 下一步', () => {
  const s = (id) => byId(id).short && [byId(id).short.kind, byId(id).short.text, byId(id).short.cls];
  assert.deepEqual(s('2026-11-01-launch-intro'), ['deadline', '后天截止', 'due']);
  assert.deepEqual(s('2026-10-20-ai-weekly-report'), ['douplus', 'DOU+ 等你定', 'you']);
  assert.deepEqual(s('2026-10-28-prompt-checklist'), ['stuck', '卡住 4 天', 'stuck']);
  assert.deepEqual(s('2026-10-30-agent-memory'), ['ask', '等你一句话', 'you']);
  assert.deepEqual(s('2026-10-27-daily-agent'), ['sample_due', '该读 10 小时数据', 'due']);
  assert.deepEqual(s('2026-10-26-cursor-vs-claude'), ['next_action', byId('2026-10-26-cursor-vs-claude').next_action.text, '']);
  assert.equal(byId('2026-11-03-ai-bookkeeping-month').short, null); // 候选不在线上
});
test('agent 待办（today）：全部列出，按优先级排', () => {
  assert.deepEqual(idx.today.map((t) => [t.kind, t.card]), [
    ['sample_due', '2026-10-27-daily-agent'], // 抖音 h10 最先
    ['sample_due', '2026-10-20-ai-weekly-report'],
    ['douplus_decision', '2026-10-20-ai-weekly-report'],
    ['must_deadline', '2026-11-01-launch-intro'],
    ['stuck', '2026-10-28-prompt-checklist'],
    ['ask_default_due', '2026-11-02-squat-form'],
    ['manual_fill', '2026-10-20-ai-weekly-report'],
    ['pick_candidates', null],
  ]);
  assert.equal(idx.today.find((t) => t.kind === 'must_deadline').text, '必拍后天截止');
  assert.match(idx.today.find((t) => t.kind === 'ask_default_due').text, /^你没回「结尾要不要露脸」，按默认做：/);
  assert.ok(!('overflow' in idx) && !('today_overflow' in idx));
});
test('编号和短名进索引', () => {
  assert.equal(byId('2026-10-30-agent-memory').no, 6);
  assert.equal(byId('2026-10-30-agent-memory').short_title, '记忆');
  assert.equal(new Set(idx.cards.map((c) => c.no)).size, 10);
  assert.ok(arc.cards.every((c) => Number.isInteger(c.no) && c.short_title));
});
test('复盘：最新定稿的「下周改什么」带到选题池', () => {
  assert.equal(idx.latest_next_week.week, '2026-W42');
  assert.deepEqual(idx.latest_next_week.items, ['开头 3 秒内先给结论', '标题里放一个数字']);
  assert.equal(idx.reviews.length, 3);
});
test('归档索引带各平台 d7 关键数', () => {
  const a = arc.cards.find((c) => c.id === '2026-10-10-notion-ai');
  assert.equal(a.archive_reason, 'done');
  assert.equal(a.d7.douyin.plays, 8000);
});

// ---------- 3. 改坏字段 ----------
console.log('改坏字段时停下');
function broken(mutate, expectFile, expectField) {
  const d = board();
  assert.equal(build(d, '--no-git').code, 0);
  const before = fs.readFileSync(path.join(d, 'index.json'), 'utf8');
  mutate(d);
  const res = build(d, '--no-git', '--now', '2026-11-10T09:00:00+08:00');
  assert.equal(res.code, 1, `应当失败，实际输出：${res.out}`);
  assert.ok(res.err.includes(expectFile), `报错里没有文件名 ${expectFile}：${res.err}`);
  assert.ok(res.err.includes(expectField), `报错里没有字段 ${expectField}：${res.err}`);
  assert.equal(fs.readFileSync(path.join(d, 'index.json'), 'utf8'), before, '旧索引被改了');
  assert.ok(!fs.existsSync(path.join(d, 'index.json.tmp')));
}
const K = '2026-10-20-ai-weekly-report';
test('分数写成 3', () => broken((d) => {
  const c = readJson(cardPath(d, K)); c.scores = { ...c.scores, takeaway: { score: 3, why: 'x' } }; writeJson(cardPath(d, K), c);
}, `cards/active/${K}.json`, '/scores/takeaway'));
test('比率写成百分数', () => broken((d) => {
  const c = readJson(cardPath(d, K)); c.publications[0].samples[0].metrics.bounce_2s = 45.2; writeJson(cardPath(d, K), c);
}, `cards/active/${K}.json`, '/publications/0/samples/0/metrics/bounce_2s'));
test('时间不带时区', () => broken((d) => {
  const c = readJson(cardPath(d, K)); c.last_touched = '2026-11-06 06:00'; writeJson(cardPath(d, K), c);
}, `cards/active/${K}.json`, '/last_touched'));
test('JSON 里有尾逗号', () => broken((d) => {
  const p = cardPath(d, K); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/\n}\n$/, ',\n}\n'));
}, `cards/active/${K}.json`, '(整个文件)'));
test('平台没有的指标写了 0', () => broken((d) => {
  const c = readJson(cardPath(d, K)); c.publications[3].samples[0].metrics.favorites = 0; writeJson(cardPath(d, K), c);
}, `cards/active/${K}.json`, '/publications/3/samples/0/metrics/favorites'));
test('没读到的指标没写进 missing', () => broken((d) => {
  const c = readJson(cardPath(d, K)); c.publications[1].samples[0].missing = []; writeJson(cardPath(d, K), c);
}, `cards/active/${K}.json`, '/publications/1/samples/0/missing'));
test('id 和文件名不一致', () => broken((d) => {
  const c = readJson(cardPath(d, K)); c.id = '2026-10-20-other'; writeJson(cardPath(d, K), c);
}, `cards/active/${K}.json`, '/id'));
test('复盘引用不存在的卡', () => broken((d) => {
  const p = path.join(d, 'reviews/2026-W45.json'); const rv = readJson(p); rv.cards.push('2026-01-01-nope'); writeJson(p, rv);
}, 'reviews/2026-W45.json', '/cards/1'));
test('同一平台两条发布记录', () => broken((d) => {
  const c = readJson(cardPath(d, K)); c.publications.push({ ...c.publications[2] }); writeJson(cardPath(d, K), c);
}, `cards/active/${K}.json`, '/publications/5/platform'));
test('config 阈值写成百分数', () => broken((d) => {
  const p = path.join(d, 'config.json'); const c = readJson(p); c.douplus.thresholds.bounce_2s_max = 40; writeJson(p, c);
}, 'config.json', '/douplus/thresholds/bounce_2s_max'));
test('两张卡编号重复', () => broken((d) => {
  const c = readJson(cardPath(d, K)); c.no = 1; writeJson(cardPath(d, K), c);
}, `cards/active/${K}.json`, '/no'));
test('ask 的默认时间不晚于提问时间', () => broken((d) => {
  const id = '2026-10-30-agent-memory'; const c = readJson(cardPath(d, id)); c.ask.default_at = c.ask.asked_at; writeJson(cardPath(d, id), c);
}, 'cards/active/2026-10-30-agent-memory.json', '/ask/default_at'));
test('归档的卡还挂着 ask', () => broken((d) => {
  const p = path.join(d, 'cards/archive/2026/2026-10-10-notion-ai.json'); const c = readJson(p);
  c.ask = { question: '还要补拍吗', context: null, options: ['不补'], if_no_answer: '不补', asked_at: '2026-11-01T09:00:00+08:00', default_at: '2026-11-02T09:00:00+08:00' };
  writeJson(p, c);
}, 'cards/archive/2026/2026-10-10-notion-ai.json', '/ask'));

// ---------- 4. 阶段流转 ----------
console.log('阶段流转（和上一个提交比）');
const F = '2026-10-28-prompt-checklist'; // record
const H = '2026-11-02-squat-form'; // sample_gate
function transition(id, mutate) {
  const d = gitBoard();
  const c = readJson(cardPath(d, id)); mutate(c); writeJson(cardPath(d, id), c);
  return build(d);
}
const T1 = '2026-11-09T08:00:00+08:00';
test('往前走一格：通过', () => {
  const res = transition(F, (c) => { c.stage = 'edit'; c.stage_since = T1; c.last_touched = T1; });
  assert.equal(res.code, 0, res.err);
});
test('跳格（record → sample_gate）：拦下', () => {
  const res = transition(F, (c) => { c.stage = 'sample_gate'; c.stage_since = T1; c.last_touched = T1; });
  assert.equal(res.code, 1); assert.match(res.err, /跳过了 edit/);
});
test('跳格但写进了 skipped：通过', () => {
  const res = transition(F, (c) => { c.stage = 'sample_gate'; c.skipped = ['edit']; c.stage_since = T1; c.last_touched = T1; });
  assert.equal(res.code, 0, res.err);
});
test('改 stage 忘了改 stage_since：拦下', () => {
  const res = transition(F, (c) => { c.stage = 'edit'; c.last_touched = T1; });
  assert.equal(res.code, 1); assert.match(res.err, /stage_since 没更新/);
});
test('改了字段忘了改 last_touched：拦下', () => {
  const res = transition(F, (c) => { c.blocked_on = '等补录'; });
  assert.equal(res.code, 1); assert.match(res.err, /last_touched 没更新/);
});
test('样片没过退回剪辑并记了原因：通过', () => {
  const res = transition(H, (c) => {
    c.stage = 'edit'; c.stage_since = T1; c.last_touched = T1;
    c.sample_gate = { result: 'fail', note: '开头 3 秒太慢', decided_by: 'agent' };
    c.notes.push({ at: T1, by: 'test-agent', text: '样片没过：开头 3 秒太慢，回到剪辑。' });
  });
  assert.equal(res.code, 0, res.err);
});
test('样片没过退回但没记原因：拦下', () => {
  const res = transition(H, (c) => { c.stage = 'edit'; c.stage_since = T1; c.last_touched = T1; c.sample_gate = { result: 'fail', note: '慢', decided_by: 'agent' }; });
  assert.equal(res.code, 1); assert.match(res.err, /notes/);
});
test('改了编号 no：拦下', () => {
  const res = transition(F, (c) => { c.no = 99; c.last_touched = T1; });
  assert.equal(res.code, 1); assert.match(res.err, /编号 no 从 5 改成了 99/);
});
test('其他往回走（record → script）：拦下', () => {
  const res = transition(F, (c) => { c.stage = 'script'; c.stage_since = T1; c.last_touched = T1; });
  assert.equal(res.code, 1); assert.match(res.err, /不能从 record 退回 script/);
});
test('阶段时间线从 git 历史里取', () => {
  const d = gitBoard();
  const c = readJson(cardPath(d, F)); c.stage = 'edit'; c.stage_since = T1; c.last_touched = T1; writeJson(cardPath(d, F), c);
  git(d, '-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qam', 'advance');
  assert.equal(build(d).code, 0);
  const hist = readJson(path.join(d, 'index.json')).cards.find((x) => x.id === F).derived.stage_history;
  assert.deepEqual(hist.map((h) => h.stage), ['record', 'edit']);
});

// ---------- 4b. 提交后再跑、--range、退回要求 fail ----------
console.log('提交之后的流转检查');
const commit = (d, msg) => git(d, '-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qam', msg);
test('从 sample_gate 退回但 result 不是 fail：拦下', () => {
  const res = transition(H, (c) => {
    c.stage = 'edit'; c.stage_since = T1; c.last_touched = T1;
    c.notes.push({ at: T1, by: 'test-agent', text: '样片没过，回到剪辑。' });
  });
  assert.equal(res.code, 1); assert.match(res.err, /sample_gate\.result 写成 fail/);
});
test('提交了跳格改动、工作区干净时再跑：比 HEAD~1，拦下', () => {
  const d = gitBoard();
  const c = readJson(cardPath(d, F)); c.stage = 'sample_gate'; c.stage_since = T1; c.last_touched = T1; writeJson(cardPath(d, F), c);
  commit(d, 'skip edit');
  assert.equal(git(d, 'status', '--porcelain').trim(), '');
  const res = build(d);
  assert.equal(res.code, 1, res.out); assert.match(res.err, /跳过了 edit/);
});
test('--range 逐个提交查出夹在中间的非法改动', () => {
  const d = gitBoard();
  const from = git(d, 'rev-parse', 'HEAD').trim();
  let c = readJson(cardPath(d, F)); c.stage = 'edit'; c.stage_since = T1; c.last_touched = T1; writeJson(cardPath(d, F), c);
  commit(d, 'advance');
  const T2 = '2026-11-09T08:30:00+08:00';
  c = readJson(cardPath(d, F)); c.stage = 'script'; c.stage_since = T2; c.last_touched = T2; writeJson(cardPath(d, F), c);
  commit(d, 'illegal back');
  const bad = git(d, 'rev-parse', '--short=7', 'HEAD').trim();
  const T3 = '2026-11-09T08:45:00+08:00';
  c = readJson(cardPath(d, F)); c.stage = 'record'; c.stage_since = T3; c.last_touched = T3; writeJson(cardPath(d, F), c);
  commit(d, 'forward again');
  // 只比 HEAD~1：script → record 是合法的一格，查不出来
  assert.equal(build(d).code, 0);
  const res = build(d, '--check', '--range', `${from}..HEAD`);
  assert.equal(res.code, 1, res.out);
  assert.match(res.err, new RegExp(`cards/active/${F}\\.json @ ${bad}.*不能从 edit 退回 script`));
});
test('--range 区间全合法：通过', () => {
  const d = gitBoard();
  const from = git(d, 'rev-parse', 'HEAD').trim();
  const c = readJson(cardPath(d, F)); c.stage = 'edit'; c.stage_since = T1; c.last_touched = T1; writeJson(cardPath(d, F), c);
  commit(d, 'advance');
  assert.equal(build(d, '--check', '--range', `${from}..HEAD`).code, 0);
});
test('浅克隆：warnings 提示 git 历史不全', () => {
  const d = gitBoard();
  const c = readJson(cardPath(d, F)); c.stage = 'edit'; c.stage_since = T1; c.last_touched = T1; writeJson(cardPath(d, F), c);
  commit(d, 'advance');
  const shallow = fs.mkdtempSync(path.join(os.tmpdir(), 'vfp-shallow-'));
  execFileSync('git', ['clone', '-q', '--depth', '1', `file://${d}`, shallow]);
  assert.equal(build(shallow).code, 0);
  const w = readJson(path.join(shallow, 'index.json')).warnings;
  assert.ok(w.some((x) => x.message.includes('git 历史不全')), JSON.stringify(w));
});

// ---------- 4c. DOU+ 加投、进已复盘、归档候选 ----------
console.log('DOU+ 加投');
const ORDERED = '2026-11-06T06:00:00+08:00';
function topUp(amount, h12, prep) {
  const d = board();
  if (prep) prep(d);
  const c = readJson(cardPath(d, K));
  const dy = c.publications[0];
  dy.douplus = { decision: 'invest', amount, ordered_at: ORDERED, top_up: null, decided_by: 'user' };
  const metrics = Object.fromEntries(Object.entries(h12).filter(([, v]) => v != null));
  const all = ['plays', 'bounce_2s', 'completion_5s', 'avg_watch_ratio', 'likes', 'comments', 'shares', 'favorites', 'new_followers'];
  dy.samples.push({ point: 'douplus_h12', taken_at: '2026-11-06T18:00:00+08:00', source: 'browser', read_by: 'test-agent', metrics, missing: all.filter((k) => !(k in metrics)) });
  writeJson(cardPath(d, K), c);
  const res = build(d, '--no-git');
  assert.equal(res.code, 0, res.err);
  return readJson(path.join(d, 'index.json'));
}
// h10：plays 3000, bounce 0.45, completion 0.23, avg 0.04, favorites 36, comments 3
const better = { plays: 6000, bounce_2s: 0.40, completion_5s: 0.30, avg_watch_ratio: 0.05, likes: 150, comments: 9, shares: 6, favorites: 60, new_followers: 10 };
test('投了 100、两项以上变好、没超上限 → 建议加投', () => {
  const i = topUp(100, better);
  const t = i.cards.find((x) => x.id === K).derived.douplus.top_up;
  assert.equal(t.status, 'suggest');
  assert.ok(t.improved.length >= 2);
  assert.equal(t.suggestion.amount, 100);
  assert.ok(i.today.some((x) => x.kind === 'douplus_top_up' && x.card === K));
  assert.ok(i.asks.some((x) => x.kind === 'douplus_top_up' && x.card === K));
});
test('已投 200（到上限）→ 不建议加投', () => {
  const t = topUp(200, better).cards.find((x) => x.id === K).derived.douplus.top_up;
  assert.equal(t.status, 'no');
  assert.equal(t.spent, 200);
});
test('下单后采样缺数 → 数据不全', () => {
  const t = topUp(100, { ...better, bounce_2s: null, completion_5s: null, avg_watch_ratio: null }).cards.find((x) => x.id === K).derived.douplus.top_up;
  assert.equal(t.status, 'incomplete');
  assert.deepEqual(t.unknown.sort(), ['avg_watch_ratio', 'bounce_2s', 'completion_5s']);
});

console.log('工位排队');
test('剪辑工位放了 5 盘：带子上 3 盘，2 盘进片盒；等你的排最前', () => {
  const d = board();
  const src = '2026-10-30-agent-memory';
  const base = readJson(cardPath(d, src));
  [['b', 21], ['c', 22], ['d', 23], ['e', 24]].forEach(([sfx, no]) => {
    const id = `${src}-${sfx}`;
    writeJson(cardPath(d, id), { ...base, id, no, short_title: `记忆${sfx}`, title: `${base.title}（${sfx}）`, ask: null, next_action: null });
  });
  const res = build(d, '--no-git');
  assert.equal(res.code, 0, res.err);
  const i = readJson(path.join(d, 'index.json'));
  const edit = i.stations.find((s) => s.stage === 'edit');
  assert.deepEqual(edit.on_belt, [src, `${src}-b`, `${src}-c`]); // 等你的在前，其余按编号
  assert.deepEqual(edit.queued, [`${src}-d`, `${src}-e`]);
  assert.deepEqual(i.cards.find((c) => c.id === `${src}-e`).line, { station: 'edit', slot: null, queue_pos: 2 });
  assert.equal(i.summary.queued, 2);
});

console.log('进已复盘的前提');
const M = '2026-10-10-notion-ai';
const archPath = (d, id) => path.join(d, 'cards/archive/2026', `${id}.json`);
test('缺必录平台 d7 → 报错', () => broken((d) => {
  const c = readJson(archPath(d, M)); const x = c.publications.find((p) => p.platform === 'x'); x.samples = x.samples.filter((s) => s.point !== 'd7'); writeJson(archPath(d, M), c);
}, `cards/archive/2026/${M}.json`, '/stage'));
test('没有复盘引用 → 报错', () => broken((d) => {
  const p = path.join(d, 'reviews/2026-W42.json'); const rv = readJson(p); rv.cards = rv.cards.filter((x) => x !== M); writeJson(p, rv);
}, `cards/archive/2026/${M}.json`, '/stage'));

console.log('归档候选：done 和 merged');
test('已复盘且进了定稿复盘 → done；写了 merged_into → merged', () => {
  const d = board();
  const L = '2026-10-06-claude-code-setup';
  const c = readJson(archPath(d, L)); c.archived_at = null; c.archive_reason = null;
  writeJson(cardPath(d, L), c); fs.rmSync(archPath(d, L));
  const A = '2026-10-05-ai-bookkeeping-test';
  const a = readJson(cardPath(d, A)); a.merged_into = '2026-11-03-ai-bookkeeping-month'; writeJson(cardPath(d, A), a);
  const res = build(d, '--no-git');
  assert.equal(res.code, 0, res.err);
  const m = Object.fromEntries(readJson(path.join(d, 'index.json')).archive_candidates.map((x) => [x.card, x]));
  assert.equal(m[L].reason, 'done'); assert.equal(m[L].due, true);
  assert.equal(m[A].reason, 'merged'); assert.equal(m[A].due, true);
});

// ---------- 5. 当前仓库 ----------
console.log('当前仓库');
test('当前仓库数据能通过校验（--check，不写文件）', () => {
  const res = spawnSync(process.execPath, [BUILD, '--check'], { encoding: 'utf8', cwd: REPO });
  assert.equal(res.status, 0, res.stderr);
});

// ---------- 6. 网站 ----------
console.log('网站（build-site）');
const SITE = path.join(REPO, 'scripts/build-site.mjs');
function buildSite(root, out, ...extra) {
  return spawnSync(process.execPath, [SITE, '--root', root, '--out', out, '--now', NOW, '--no-git', ...extra], { encoding: 'utf8' });
}
test('假数据能生成网站：页面、3D 库、data.json、示例数据都在', () => {
  const d = board();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vfp-site-'));
  const res = buildSite(d, out);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  for (const f of ['index.html', 'app.js', 'app.css', '_headers', 'vendor/three/three.min.js', 'data.json', 'data-demo.json']) {
    assert.ok(fs.existsSync(path.join(out, f)), `缺 ${f}`);
  }
  const data = readJson(path.join(out, 'data.json'));
  assert.deepEqual(Object.keys(data).sort(), ['archive', 'cards', 'config', 'index', 'reviews']);
  assert.equal(data.index.cards.length, 10);
  assert.equal(Object.keys(data.cards).length, 13); // 10 张活跃 + 3 张归档，原始卡页面要用
  assert.equal(data.reviews.length, 3);
  assert.ok(data.cards['2026-10-20-ai-weekly-report'].publications.length > 0);
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.ok(!/cdnjs|jsdelivr|unpkg/.test(html), '3D 库要用仓库里的，不走 CDN');
});
test('卡有错时不生成网站，旧网站不动', () => {
  const d = board();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vfp-site-'));
  fs.writeFileSync(path.join(out, 'keep.txt'), 'old');
  const c = readJson(cardPath(d, '2026-10-26-cursor-vs-claude')); c.no = 'x'; writeJson(cardPath(d, '2026-10-26-cursor-vs-claude'), c);
  const res = buildSite(d, out, '--no-demo');
  assert.notEqual(res.status, 0);
  assert.ok(fs.existsSync(path.join(out, 'keep.txt')));
});
test('页面脚本语法正确', () => {
  const res = spawnSync(process.execPath, ['--check', path.join(REPO, 'site/app.js')], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
});


// ---------- 7. 网页按钮直接改卡 ----------
console.log('网页按钮直接改卡');
const cardSchema = readJson(path.join(REPO, 'schema/card.schema.json'));
const TZ = readJson(path.join(REPO, 'config.json')).timezone;
const T0 = Date.parse('2026-11-09T01:00:00Z'); // 周一 09:00（配置时区）
function boardCards(prep) {
  const d = board();
  if (prep) prep(d);
  const list = [];
  for (const f of fs.readdirSync(path.join(d, 'cards/active'))) list.push({ path: `cards/active/${f}`, card: readJson(path.join(d, 'cards/active', f)) });
  for (const y of fs.readdirSync(path.join(d, 'cards/archive'))) {
    for (const f of fs.readdirSync(path.join(d, 'cards/archive', y))) list.push({ path: `cards/archive/${y}/${f}`, card: readJson(path.join(d, 'cards/archive', y, f)) });
  }
  return list;
}
const act = (body, cards = boardCards()) => {
  const p = parseAction(body);
  assert.ok(p.action, p.error);
  return applyAction(p.action, { cards, cardSchema, tz: TZ, nowMs: T0, rand: 'ab12' });
};
const okAct = (body, cards) => { const r = act(body, cards); assert.ok(!r.error, r.error); assert.deepEqual(validate(cardSchema, r.card), []); return r; };
const MEM = '2026-10-30-agent-memory';
const BK = '2026-11-03-ai-bookkeeping-month';
const lastNote = (c) => c.notes[c.notes.length - 1];

test('页面发来的内容先过一道：缺卡、缺原因、金额不对、太长、多余字段、坏 id 都拦下', () => {
  const bad = (b) => assert.ok(parseAction(b).error, `应该被拦下：${JSON.stringify(b)}`);
  bad({ kind: 'pick' });
  bad({ kind: 'shelve', card: BK });
  bad({ kind: 'shelve', card: BK, text: '   ' });
  bad({ kind: 'douplus', card: K, value: 'invest' });
  bad({ kind: 'douplus', card: K, value: 'invest', amount: -5 });
  bad({ kind: 'douplus', card: K, value: 'order_now', amount: 100 });
  bad({ kind: 'answer', card: MEM, value: '用 A' }); // 没带问题
  bad({ kind: 'idea', text: 'x'.repeat(301) });
  bad({ kind: 'idea', text: 'hi', path: '../../etc' });
  bad({ kind: 'pick', card: '../config' });
  bad({ kind: 'idea', card: MEM, text: '挂在卡上的灵感' });
  bad({ kind: 'note', text: '自由留言不收了' });
  bad({ kind: 'merge', card: MEM });
  bad([1, 2]);
  assert.equal(parseAction({ kind: 'douplus', card: K, value: 'skip', amount: 100 }).action.amount, null); // 不投不带金额
});
test('回答问题：选项是一句话 → 记进笔记、问题收起；带 set 的选项 → 照着改卡', () => {
  const r = okAct({ kind: 'answer', card: MEM, question: '开头用哪个案例', value: '用 A' });
  assert.equal(r.card.ask, null);
  assert.deepEqual(lastNote(r.card), { at: '2026-11-09T09:00:00+08:00', by: 'user', text: '网页上回答「开头用哪个案例」：用 A' });
  assert.equal(r.card.last_touched, '2026-11-09T09:00:00+08:00');
  assert.deepEqual(r.card.next_action, { who: 'agent', text: '照你选的「用 A」接着做', sub: '网页上回答了「开头用哪个案例」' });
  assert.equal(r.files[0].path, `cards/active/${MEM}.json`);
  assert.deepEqual(r.deletions, []);
  assert.equal(r.message, `[web] 回答: ${MEM}`);
  const cards = boardCards((d) => {
    const c = readJson(cardPath(d, BK));
    c.ask = { question: '这条什么时候做', options: [{ label: '这周必做', set: { tier: 'must', deadline: '2026-11-15T23:59:00+08:00', why: '月底前要交', kind: 'ai_talk' } }, { label: '先放着', set: { tier: 'shelved', shelved_reason: '不急' } }], context: null, if_no_answer: '先按已定排', asked_at: '2026-11-08T10:00:00+08:00', default_at: '2026-11-09T10:00:00+08:00' };
    writeJson(cardPath(d, BK), c);
  });
  const m = okAct({ kind: 'answer', card: BK, question: '这条什么时候做', value: '这周必做' }, cards);
  assert.equal(m.card.tier, 'must');
  assert.equal(m.card.tier_since, '2026-11-09T09:00:00+08:00');
  assert.equal(m.card.tier_decided_by, 'user');
  assert.equal(m.card.deadline, '2026-11-15T23:59:00+08:00');
  assert.equal(m.card.ask, null);
});
test('回答过期了（问题换了、选项没了）→ 不写，叫刷新', () => {
  assert.equal(act({ kind: 'answer', card: MEM, question: '旧问题', value: '用 A' }).code, 'stale');
  assert.equal(act({ kind: 'answer', card: MEM, question: '开头用哪个案例', value: '用 C' }).code, 'stale');
  assert.equal(act({ kind: 'answer', card: '2026-01-01-nope', question: 'q', value: 'v' }).code, 'not_found');
});
test('定了这周拍：缺类型就不让定；补齐了 → decided，排进这周', () => {
  const r = act({ kind: 'pick', card: BK });
  assert.equal(r.code, 'incomplete');
  assert.match(r.error, /类型/);
  const cards = boardCards((d) => { const c = readJson(cardPath(d, BK)); c.kind = 'ai_talk'; writeJson(cardPath(d, BK), c); });
  const ok = okAct({ kind: 'pick', card: BK }, cards);
  assert.equal(ok.card.tier, 'decided');
  assert.equal(ok.card.plan_week, '2026-W46');
  assert.equal(act({ kind: 'pick', card: MEM }).code, 'stale'); // 不是候选
});
test('搁置：候选能搁置并写上原因；已开拍的不在网页上搁置', () => {
  const r = okAct({ kind: 'shelve', card: BK, text: '最近不想做记账' });
  assert.equal(r.card.tier, 'shelved');
  assert.equal(r.card.shelved_reason, '最近不想做记账');
  assert.equal(act({ kind: 'shelve', card: MEM, text: '不做了' }).code, 'stale');
});
test('DOU+：投 / 不投 → 下单 → 加投 / 不加投，每步都能过校验，重复点会被拦', () => {
  let cards = boardCards();
  const step = (body) => {
    const r = okAct(body, cards);
    cards = cards.map((e) => (e.card.id === r.card.id ? { path: e.path, card: r.card } : e));
    return r.card.publications.find((p) => p.platform === 'douyin').douplus;
  };
  assert.deepEqual(step({ kind: 'douplus', card: K, value: 'invest', amount: 100 }), { decision: 'invest', amount: 100, ordered_at: null, top_up: null, decided_by: 'user' });
  assert.equal(act({ kind: 'douplus', card: K, value: 'skip' }, cards).code, 'stale');
  assert.equal(step({ kind: 'douplus', card: K, value: 'ordered', amount: 100 }).ordered_at, '2026-11-09T09:00:00+08:00');
  assert.equal(act({ kind: 'douplus', card: K, value: 'ordered', amount: 100 }, cards).code, 'stale');
  const save = cards;
  assert.deepEqual(step({ kind: 'douplus', card: K, value: 'top_up', amount: 100 }).top_up, { amount: 100, ordered_at: '2026-11-09T09:00:00+08:00' });
  assert.equal(act({ kind: 'douplus', card: K, value: 'no_top_up' }, cards).code, 'stale');
  cards = save;
  assert.equal(step({ kind: 'douplus', card: K, value: 'no_top_up' }).top_up_declined_at, '2026-11-09T09:00:00+08:00');
  assert.equal(okAct({ kind: 'douplus', card: K, value: 'skip' }).card.publications[0].douplus.decision, 'skip');
  assert.equal(act({ kind: 'douplus', card: '2026-10-26-cursor-vs-claude', value: 'skip' }).code, 'stale'); // 没有抖音记录
});
test('记灵感：建一张新卡，编号接着排，短名自动截，过校验', () => {
  const r = okAct({ kind: 'idea', text: '试试用 AI 做饮食记录，看能不能坚持' });
  assert.equal(r.card.id, '2026-11-09-idea-ab12');
  assert.equal(r.card.no, 14);
  assert.equal(r.card.short_title, '试试用AI做');
  assert.equal(r.card.tier, 'idea');
  assert.equal(r.card.stage, 'topic');
  assert.equal(r.files[0].path, 'cards/active/2026-11-09-idea-ab12.json');
  assert.equal(okAct({ kind: 'idea', text: 'Demo的30天改造计划' }).card.short_title, 'Demo的'); // 不把数字截一半
  assert.equal(okAct({ kind: 'idea', text: 'ChatGPT和Claude对比' }).card.short_title, 'ChatGP'); // 整句都是一个词就照截
});
test('挪回来：归档卡搬回 active（删旧路径），并过的卡不挪', () => {
  const A = '2026-10-14-ai-ppt';
  const r = okAct({ kind: 'restore', card: A });
  assert.equal(r.files[0].path, `cards/active/${A}.json`);
  assert.deepEqual(r.deletions, [`cards/archive/2026/${A}.json`]);
  assert.equal(r.card.archived_at, null);
  assert.equal(act({ kind: 'restore', card: MEM }).code, 'stale');
  assert.equal(act({ kind: 'pick', card: A }).code, 'stale'); // 归档的卡别的按钮不让点
});
test('改完过不了校验 → 不写', () => {
  const cards = boardCards((d) => {
    const c = readJson(cardPath(d, BK));
    c.ask = { question: '改个结论', options: [{ label: '改', set: { conclusion: 123 } }], context: null, if_no_answer: '先按已定排', asked_at: '2026-11-08T10:00:00+08:00', default_at: '2026-11-09T10:00:00+08:00' };
    writeJson(cardPath(d, BK), c);
  });
  const r = applyAction({ kind: 'answer', card: BK, question: '改个结论', value: '改', amount: null, text: null }, { cards, cardSchema, tz: TZ, nowMs: T0, rand: 'ab12' });
  assert.equal(r.code, 'invalid_card');
});

// /api/act：自己生成一对 RSA 钥匙，模拟 Cloudflare Access 和 GitHub GraphQL
const subtle = globalThis.crypto.subtle;
const kp = await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pubJwk = { ...(await subtle.exportKey('jwk', kp.publicKey)), kid: 'k1' };
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
async function jwt(claims, kid = 'k1', key = kp.privateKey) {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const p = b64u(JSON.stringify(claims));
  const sig = await subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(sig)}`;
}
const ENV = { GITHUB_TOKEN: 'test-token-not-real', GITHUB_REPO: 'someone/some-repo', ACCESS_TEAM_DOMAIN: 'team.example.com', ACCESS_AUD: 'aud-1', ALLOWED_EMAILS: 'me@example.com' };
const SEC = Math.floor(T0 / 1000);
const goodClaims = { iss: 'https://team.example.com', aud: ['aud-1'], email: 'me@example.com', exp: SEC + 3600, iat: SEC - 10 };
// 假 GitHub：读的时候按测试板子回一个提交快照；写的时候前 moved 次回「分支动过了」
function repoSnapshot(oid) {
  const blob = (c) => ({ text: JSON.stringify(c, null, 2) });
  const cards = boardCards();
  const active = cards.filter((e) => e.path.startsWith('cards/active/')).map((e) => ({ name: path.basename(e.path), object: blob(e.card) }));
  const years = {};
  for (const e of cards.filter((x) => x.path.startsWith('cards/archive/'))) (years[e.path.split('/')[2]] ||= []).push({ name: path.basename(e.path), object: blob(e.card) });
  return { data: { repository: { ref: { target: {
    oid,
    config: { object: { text: JSON.stringify({ timezone: TZ }) } },
    active: { object: { entries: [...active, { name: '.gitkeep', object: { text: '' } }] } },
    archive: { object: { entries: Object.entries(years).map(([name, entries]) => ({ name, object: { entries } })) } },
  } } } } };
}
function fakeFetch({ ghStatus = 200, moved = 0, commitError = null } = {}) {
  const calls = [];
  let reads = 0;
  const f = async (url, init = {}) => {
    calls.push({ url, init });
    if (url === 'https://team.example.com/cdn-cgi/access/certs') return new Response(JSON.stringify({ keys: [pubJwk] }), { status: 200 });
    if (url === 'https://api.github.com/graphql') {
      if (ghStatus !== 200) return new Response('{}', { status: ghStatus });
      const q = JSON.parse(init.body);
      if (q.query.trim().startsWith('query')) { reads++; return new Response(JSON.stringify(repoSnapshot(`head${reads}`.padEnd(40, '0'))), { status: 200 }); }
      if (moved > 0) { moved--; return new Response(JSON.stringify({ data: null, errors: [{ message: 'Expected branch to point to "x" but it did not. Pull and try again.' }] }), { status: 200 }); }
      if (commitError) return new Response(JSON.stringify({ data: null, errors: [{ message: commitError }] }), { status: 200 });
      return new Response(JSON.stringify({ data: { createCommitOnBranch: { commit: { oid: 'c0ffee1234567890abcdef' } } } }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
  f.calls = calls;
  return f;
}
async function call({ env = ENV, token, claims = goodClaims, origin = 'https://vf.example.com', body = { kind: 'idea', text: '一个灵感' }, method = 'POST', ctype = 'application/json', gh = {}, schema = cardSchema } = {}) {
  _resetCache();
  const t = token === undefined ? await jwt(claims) : token;
  const headers = { 'content-type': ctype };
  if (origin) headers.origin = origin;
  if (t) headers['cf-access-jwt-assertion'] = t;
  const req = new Request('https://vf.example.com/api/act', { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined });
  const f = fakeFetch(gh);
  const res = await handleAct(req, env, { fetch: f, now: () => T0, rand: () => 'ab12', cardSchema: schema });
  const muts = f.calls.filter((c) => c.url === 'https://api.github.com/graphql').map((c) => JSON.parse(c.init.body)).filter((q) => q.query.trim().startsWith('mutation'));
  return { res, json: await res.json(), calls: f.calls, muts };
}
const ghCalls = (calls) => calls.filter((c) => c.url.startsWith('https://api.github.com/'));
await atest('/api/act：登录、同源、邮箱都对 → 读仓库、改卡、一个提交写回（对着读到的那个提交）', async () => {
  const { res, json, muts, calls } = await call({ body: { kind: 'answer', card: MEM, question: '开头用哪个案例', value: '用 A' } });
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.item.id, 'c0ffee123456');
  assert.equal(json.item.card, MEM);
  assert.match(json.item.summary, /用 A/);
  assert.equal(muts.length, 1);
  const input = muts[0].variables.input;
  assert.deepEqual(input.branch, { repositoryNameWithOwner: 'someone/some-repo', branchName: 'main' });
  assert.equal(input.expectedHeadOid, 'head1'.padEnd(40, '0'));
  assert.equal(input.message.headline, `[web] 回答: ${MEM}`);
  assert.equal(input.fileChanges.additions.length, 1);
  assert.equal(input.fileChanges.additions[0].path, `cards/active/${MEM}.json`);
  const card = JSON.parse(Buffer.from(input.fileChanges.additions[0].contents, 'base64').toString('utf8'));
  assert.equal(card.ask, null);
  assert.deepEqual(validate(cardSchema, card), []);
  assert.ok(!JSON.stringify(card).includes('me@example.com'), '邮箱不进仓库');
  assert.equal(ghCalls(calls)[0].init.headers.authorization, 'Bearer test-token-not-real');
  assert.ok(!JSON.stringify(json).includes('test-token-not-real'), '密钥不回给页面');
});
await atest('/api/act：读和写之间有人推了新提交 → 重读重算再写；一直被抢 → 409 叫再点一次', async () => {
  const a = await call({ gh: { moved: 1 } });
  assert.equal(a.res.status, 200, JSON.stringify(a.json));
  assert.equal(a.muts.length, 2);
  assert.equal(a.muts[1].variables.input.expectedHeadOid, 'head2'.padEnd(40, '0'));
  const b = await call({ gh: { moved: 5 } });
  assert.equal(b.res.status, 409);
  assert.equal(b.json.code, 'busy');
});
await atest('/api/act：卡已经变了 → 409 不写；缺资料 → 409 incomplete；改完过不了校验 → 422', async () => {
  const s = await call({ body: { kind: 'answer', card: MEM, question: '旧问题', value: '用 A' } });
  assert.equal(s.res.status, 409);
  assert.equal(s.json.code, 'stale');
  assert.equal(s.muts.length, 0);
  const i = await call({ body: { kind: 'pick', card: BK } });
  assert.equal(i.res.status, 409);
  assert.equal(i.json.code, 'incomplete');
  const strict = JSON.parse(JSON.stringify(cardSchema));
  strict.properties.notes.maxItems = 0; // 任何新笔记都过不了
  const v2 = await call({ body: { kind: 'shelve', card: BK, text: '不做了' }, schema: strict });
  assert.equal(v2.res.status, 422);
  assert.equal(v2.json.code, 'invalid_card');
  assert.equal(v2.muts.length, 0);
});
await atest('/api/act：缺设置就拒收（503），不放行', async () => {
  const { res, json, calls } = await call({ env: { ...ENV, ACCESS_AUD: '' } });
  assert.equal(res.status, 503);
  assert.equal(json.code, 'not_configured');
  assert.match(json.message, /ACCESS_AUD/);
  assert.equal(calls.length, 0);
  for (const v of ['', ' , ']) {
    const r = await call({ env: { ...ENV, ALLOWED_EMAILS: v } });
    assert.equal(r.res.status, 503, `ALLOWED_EMAILS=${JSON.stringify(v)} 也要拒收`);
    assert.equal(r.json.code, 'not_configured');
    assert.equal(r.calls.length, 0);
  }
});
await atest('/api/act：没凭证、签名不对、别的站的凭证、过期 → 401，不碰仓库', async () => {
  const other = await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  for (const opt of [
    { token: null },
    { token: await jwt(goodClaims, 'k1', other.privateKey) },
    { claims: { ...goodClaims, aud: ['someone-else'] } },
    { claims: { ...goodClaims, iss: 'https://evil.example.com' } },
    { claims: { ...goodClaims, exp: SEC - 1 } },
    { token: await jwt(goodClaims, 'nope') },
  ]) {
    const { res, calls } = await call(opt);
    assert.equal(res.status, 401, JSON.stringify(Object.keys(opt)));
    assert.equal(ghCalls(calls).length, 0);
  }
});
await atest('/api/act：别的网站发来的、不是 JSON 的、邮箱不在名单里的、没设名单的 → 拒收', async () => {
  assert.equal((await call({ origin: 'https://evil.example.com' })).res.status, 403);
  assert.equal((await call({ origin: null })).res.status, 403);
  assert.equal((await call({ ctype: 'text/plain' })).res.status, 415);
  assert.equal((await call({ claims: { ...goodClaims, email: 'other@example.com' } })).res.status, 403);
  assert.equal((await call({ method: 'GET' })).res.status, 405);
  const noList = await call({ env: { ...ENV, ALLOWED_EMAILS: '' }, claims: { ...goodClaims, email: 'other@example.com' } });
  assert.equal(noList.res.status, 503, '没设名单就拒收，不只靠 Access 把关');
  assert.equal(noList.calls.length, 0);
});
await atest('/api/act：内容不合规 → 400；GitHub 拒绝 → 502，说清是密钥问题', async () => {
  const b = await call({ body: { kind: 'shelve', card: BK } });
  assert.equal(b.res.status, 400);
  assert.match(b.json.message, /原因/);
  const g = await call({ gh: { ghStatus: 401 } });
  assert.equal(g.res.status, 502);
  assert.match(g.json.message, /密钥/);
  const p = await call({ gh: { commitError: 'Resource not accessible by personal access token' } });
  assert.equal(p.res.status, 502);
  assert.match(p.json.message, /密钥/);
});

test('build-index：问题的选项带 set 时，页面只拿到按钮上的字', () => {
  const d = board();
  const c = readJson(cardPath(d, MEM));
  c.ask.options = [{ label: '用 A', set: { why: '开头更抓人' } }, '用 B'];
  writeJson(cardPath(d, MEM), c);
  const res = build(d, '--no-git');
  assert.equal(res.code, 0, res.err);
  const x = readJson(path.join(d, 'index.json'));
  assert.deepEqual(x.asks.find((a) => a.card === MEM).options, ['用 A', '用 B']);
  assert.ok(!('inbox' in x), '索引里不再有收件箱');
});
test('build-index：网页上点过「不加」（top_up_declined_at）→ 不再问加投', () => {
  const d = board();
  const c = readJson(cardPath(d, K));
  const dy = c.publications[0];
  dy.douplus = { decision: 'invest', amount: 100, ordered_at: ORDERED, top_up: null, decided_by: 'user', top_up_declined_at: '2026-11-07T09:00:00+08:00' };
  const metrics = better;
  dy.samples.push({ point: 'douplus_h12', taken_at: '2026-11-06T18:00:00+08:00', source: 'browser', read_by: 'test-agent', metrics, missing: [] });
  writeJson(cardPath(d, K), c);
  const res = build(d, '--no-git');
  assert.equal(res.code, 0, res.err);
  const x = readJson(path.join(d, 'index.json'));
  assert.ok(!x.asks.some((a) => a.kind === 'douplus_top_up'));
  assert.ok(!x.today.some((a) => a.kind === 'douplus_top_up'));
});

console.log(`\n${passed} 通过，${failed} 失败`);
process.exitCode = failed ? 1 : 0;
