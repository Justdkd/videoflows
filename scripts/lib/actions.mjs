// 网页按钮直接改卡：页面上点一下，服务器（functions/api/act.js）用这里的规则算出新的卡，
// 校验通过后一个提交写回仓库，不等 agent。
// 这个文件 Node 脚本、测试和 Cloudflare Pages Function 共用，只用两边都有的东西（不碰 fs、Buffer）。
//
// 能点的只有「点一下就能定」的事；要动脑子的话（改结论、补素材、聊方向）去和 agent 的对话里说，网页上不收自由留言。

import { validate } from './validate.mjs';
import { formatTime, isoWeek, localDate } from './time.mjs';

export const ACTION_KINDS = ['answer', 'pick', 'shelve', 'douplus', 'idea', 'restore'];
export const DOUPLUS_VALUES = ['invest', 'skip', 'ordered', 'top_up', 'no_top_up'];
export const CARD_ID = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*$/;
export const LIMITS = { value: 20, text: 300, question: 40, amount: 100000 };
const SET_FIELDS = ['tier', 'plan_week', 'deadline', 'why', 'conclusion', 'kind', 'shelved_reason', 'blocked_on', 'next_action'];
const KIND_CN = { answer: '回答', pick: '定了这周拍', shelve: '搁置', douplus: 'DOU+', idea: '新灵感', restore: '挪回来' };

// ask 的选项可以是一句话，也可以是 { label, set }；页面只要按钮上的字
export const optionLabel = (o) => (typeof o === 'string' ? o : o.label);
export const askLabels = (ask) => (ask ? ask.options.map(optionLabel) : []);

// 去掉控制字符，收掉首尾空白；空串当没写；超长返回 undefined
function clean(s, max) {
  if (s == null) return null;
  if (typeof s !== 'string') return undefined;
  const t = s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!t) return null;
  if ([...t].length > max) return undefined;
  return t;
}

// 页面发来的 body → 规整过的动作；不合规返回 { error }
export function parseAction(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: '内容不对：要一个 JSON 对象' };
  const extra = Object.keys(body).filter((k) => !['card', 'kind', 'value', 'amount', 'text', 'question'].includes(k));
  if (extra.length) return { error: `不认识的字段：${extra.join('、')}` };
  const kind = body.kind;
  if (!ACTION_KINDS.includes(kind)) return { error: '不认识的按钮' };
  const card = body.card == null ? null : body.card;
  if (card !== null && (typeof card !== 'string' || !CARD_ID.test(card))) return { error: '卡的 id 不对' };
  const value = clean(body.value, LIMITS.value);
  if (value === undefined) return { error: '选项太长' };
  const text = clean(body.text, LIMITS.text);
  if (text === undefined) return { error: `写得太长了（最多 ${LIMITS.text} 个字）` };
  const question = clean(body.question, LIMITS.question);
  if (question === undefined) return { error: '问题太长' };
  let amount = body.amount == null || body.amount === '' ? null : Number(body.amount);
  if (amount !== null && (!Number.isInteger(amount) || amount <= 0 || amount > LIMITS.amount)) return { error: '金额要是正整数' };

  if (kind === 'idea') {
    if (card) return { error: '记灵感不挂在已有的卡上' };
    if (!text) return { error: '写一句灵感再记' };
    return { action: { kind, card: null, value: null, amount: null, text, question: null } };
  }
  if (!card) return { error: '这个按钮要指明是哪张卡' };
  if (kind === 'answer') {
    if (!question) return { error: '回答要带上问题' };
    if (!value) return { error: '点一个选项' };
    return { action: { kind, card, value, amount: null, text: null, question } };
  }
  if (kind === 'shelve') {
    if (!text) return { error: '搁置要写一句原因' };
    return { action: { kind, card, value: null, amount: null, text, question: null } };
  }
  if (kind === 'douplus') {
    if (!DOUPLUS_VALUES.includes(value)) return { error: 'DOU+ 的按钮不对' };
    const needAmount = ['invest', 'ordered', 'top_up'].includes(value);
    if (needAmount && amount === null) return { error: '要带上金额' };
    return { action: { kind, card, value, amount: needAmount ? amount : null, text: null, question: null } };
  }
  return { action: { kind, card, value: null, amount: null, text: null, question: null } }; // pick、restore
}

// 截前 6 个字当短名；不把英文单词或数字从中间截断（「Demo的30天」→「Demo的」，不是「Demo的3」）
const short6 = (t) => {
  const chars = [...t.replace(/[\s，。、！？：；,.!?:;「」『』“”"'（）()【】\[\]—\-]/g, '')];
  let n = Math.min(6, chars.length);
  const word = /[A-Za-z0-9]/;
  if (n < chars.length && word.test(chars[n]) && word.test(chars[n - 1])) {
    let k = n;
    while (k > 0 && word.test(chars[k - 1])) k--;
    if (k > 0) n = k;
  }
  return chars.slice(0, n).join('') || '灵感';
};

// 动作 + 仓库里现在的卡 → 要写的文件。
// ctx: { cards: [{ path, card }], cardSchema, tz, nowMs, rand }（rand：4 位小写字母数字，新灵感卡 id 用）
// 返回 { files: [{ path, content }], deletions: [path], card, message, summary } 或 { error, code }
export function applyAction(action, ctx) {
  const { cards, cardSchema, tz, nowMs } = ctx;
  const now = formatTime(nowMs, tz);
  const note = (text) => ({ at: now, by: 'user', text });

  if (action.kind === 'idea') {
    const maxNo = cards.reduce((m, e) => Math.max(m, e.card && Number.isInteger(e.card.no) ? e.card.no : 0), 0);
    const d = localDate(nowMs, tz);
    const date = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    const ids = new Set(cards.map((e) => e.card && e.card.id));
    let id = `${date}-idea-${ctx.rand}`;
    for (let i = 2; ids.has(id); i++) id = `${date}-idea-${ctx.rand}${i}`;
    const card = {
      schema_version: 2, id, no: maxNo + 1, short_title: short6(action.text), title: action.text,
      conclusion: null, kind: null, source: 'own_use',
      tier: 'idea', tier_since: now, tier_decided_by: 'user', stage: 'topic', stage_since: now, last_touched: now,
      blocked_on: null, next_action: { who: 'agent', text: '查重、打四道筛', sub: '网页上记的灵感，标题是你的原话，短名是自动截的' },
      ask: null, skipped: [], plan_week: null, deadline: null, shelved_reason: null, why: null,
      scores: { takeaway: null, evidence: null, framework: null, search: null, scored_by: null },
      assets: { script_doc: null, script_version: null, record_version: null, local_project: null, edit_version: null },
      sample_gate: { result: 'pending', note: null, decided_by: null },
      publications: [], notes: [note('网页上记的灵感')],
      archived_at: null, archive_reason: null, merged_into: null,
    };
    return finish(card, `cards/active/${id}.json`, null, `新灵感 #${card.no}「${card.short_title}」`, cardSchema, action);
  }

  const entry = cards.find((e) => e.card && e.card.id === action.card);
  if (!entry) return { error: '找不到这张卡，可能已经被改名或删掉了。刷新看看', code: 'not_found' };
  const archived = entry.path.startsWith('cards/archive/');
  const card = JSON.parse(JSON.stringify(entry.card));
  if (archived && action.kind !== 'restore') return { error: '这张卡已经归档了，先挪回来', code: 'stale' };

  const setTier = (tier) => {
    if (card.tier !== tier) { card.tier = tier; card.tier_since = now; }
    card.tier_decided_by = 'user';
  };

  let summary;
  if (action.kind === 'answer') {
    if (!card.ask || card.ask.question !== action.question) return { error: '这个问题已经换了或者回过了，刷新看看', code: 'stale' };
    const opt = card.ask.options.find((o) => optionLabel(o) === action.value);
    if (!opt) return { error: '这个选项已经不在了，刷新看看', code: 'stale' };
    const set = typeof opt === 'string' ? {} : opt.set;
    for (const [k, v] of Object.entries(set)) {
      if (!SET_FIELDS.includes(k)) return { error: `选项要改的字段 ${k} 不让网页改，去和 agent 的对话里说`, code: 'invalid_option' };
      if (k === 'tier') setTier(v); else card[k] = JSON.parse(JSON.stringify(v));
    }
    if (!('next_action' in set)) card.next_action = { who: 'agent', text: `照你选的「${action.value}」接着做`, sub: `网页上回答了「${card.ask.question}」` };
    card.notes.push(note(`网页上回答「${card.ask.question}」：${action.value}`));
    card.ask = null;
    summary = `回答「${action.question}」：${action.value}`;
  } else if (action.kind === 'pick') {
    if (card.tier !== 'candidate') return { error: '这条已经不是候选了，刷新看看', code: 'stale' };
    const lack = [!card.conclusion && '一句话结论', !card.kind && '类型（口播还是健身）'].filter(Boolean);
    if (lack.length) return { error: `这条还缺${lack.join('和')}，先去和 agent 的对话里补上再定`, code: 'incomplete' };
    setTier('decided');
    if (!card.plan_week) card.plan_week = isoWeek(nowMs, tz);
    card.notes.push(note(`网页上定了：${card.plan_week} 拍`));
    summary = `定了这周拍（${card.plan_week}）`;
  } else if (action.kind === 'shelve') {
    if (card.tier === 'shelved') return { error: '这条已经搁置了', code: 'stale' };
    if (card.stage !== 'topic' && !['idea', 'candidate'].includes(card.tier)) return { error: '已经开拍的片子不在网页上搁置，去和 agent 的对话里说', code: 'stale' };
    setTier('shelved');
    card.shelved_reason = action.text;
    card.notes.push(note(`网页上搁置：${action.text}`));
    summary = `搁置：${action.text}`;
  } else if (action.kind === 'douplus') {
    const dy = card.publications.find((p) => p.platform === 'douyin');
    if (!dy || !dy.douplus) return { error: '这条还没有抖音发布记录', code: 'stale' };
    const d = dy.douplus;
    const v = action.value;
    if (v === 'invest' || v === 'skip') {
      if (d.decision) return { error: 'DOU+ 已经定过了，刷新看看', code: 'stale' };
      Object.assign(d, v === 'invest'
        ? { decision: 'invest', amount: action.amount, ordered_at: null, top_up: null, decided_by: 'user' }
        : { decision: 'skip', amount: null, ordered_at: null, top_up: null, decided_by: 'user' });
      summary = v === 'invest' ? `DOU+ 投 ${action.amount} 元（还没下单）` : 'DOU+ 不投';
    } else if (v === 'ordered') {
      if (d.ordered_at) return { error: '已经记过下单了', code: 'stale' };
      if (d.decision === 'skip') return { error: '这条定的是不投，刷新看看', code: 'stale' };
      Object.assign(d, { decision: 'invest', amount: action.amount, ordered_at: now, decided_by: 'user' });
      if (!('top_up' in d)) d.top_up = null;
      summary = `DOU+ 已下单 ${action.amount} 元`;
    } else if (v === 'top_up') {
      if (d.decision !== 'invest' || !d.ordered_at) return { error: '首投还没下单，不能加投', code: 'stale' };
      if (d.top_up) return { error: '已经记过加投了', code: 'stale' };
      d.top_up = { amount: action.amount, ordered_at: now };
      summary = `DOU+ 加投 ${action.amount} 元，已下单`;
    } else {
      if (d.top_up) return { error: '已经加投过了', code: 'stale' };
      d.top_up_declined_at = now;
      summary = 'DOU+ 不加投';
    }
    card.notes.push(note(`网页上：${summary}`));
  } else if (action.kind === 'restore') {
    if (!archived) return { error: '这张卡不在归档里', code: 'stale' };
    if (card.merged_into) return { error: '这张卡已经并进别的卡了，去和 agent 的对话里说', code: 'stale' };
    card.archived_at = null;
    card.archive_reason = null;
    card.notes.push(note('网页上从归档挪回来'));
    summary = '从归档挪回来';
    card.last_touched = now;
    return finish(card, `cards/active/${card.id}.json`, entry.path, summary, cardSchema, action);
  }
  card.last_touched = now;
  return finish(card, entry.path, null, summary, cardSchema, action);
}

function finish(card, path, deletePath, summary, cardSchema, action) {
  const errs = cardSchema ? validate(cardSchema, card) : [];
  if (errs.length) {
    const e = errs[0];
    return { error: `改完的卡过不了校验（${e.path || e.instancePath || ''} ${e.message || e}），没写。去和 agent 的对话里让它看看`, code: 'invalid_card' };
  }
  return {
    files: [{ path, content: JSON.stringify(card, null, 2) + '\n' }],
    deletions: deletePath ? [deletePath] : [],
    card,
    summary,
    message: `[web] ${KIND_CN[action.kind]}: ${card.id}`,
  };
}
