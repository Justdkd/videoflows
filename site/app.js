/* VideoFlows 剪辑室：读 data.json（scripts/build-site.mjs 生成）画出来。
   规则都在 scripts/build-index.mjs 里算好了，这里只负责画出来。
   页面上的按钮发到 /api/act，服务器直接改卡、一个提交写回仓库，网站随后自己重新生成；要动脑子的话去和 agent 的对话里说。
   ?demo 读 data-demo.json（tests/fixtures 的假数据），看示例用，按钮不发出去。 */
(async function main() {
const DEMO = new URLSearchParams(location.search).has("demo");
let DATA;
try {
  const r = await fetch(DEMO ? "data-demo.json" : "data.json", { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  DATA = await r.json();
} catch (e) {
  const f = document.getElementById("fail");
  f.textContent = `数据没读到（${e.message}）。刷新一下；还不行就让 agent 看看最近一次部署。`;
  f.style.display = "grid";
  return;
}

const IDX = DATA.index, CF = DATA.config, RAW = DATA.cards || {};
const TZ = CF.timezone || "Asia/Shanghai";
const NOW = DEMO ? new Date(IDX.generated_at) : new Date();
const DAY = 864e5;
const STAGES = ["选题", "文案", "录制", "剪辑", "样片", "发布", "数据"];
const STAGES_CN = STAGES;
const KEYS = ["topic", "script", "record", "edit", "sample_gate", "publish", "data"];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- 网页按钮：点了服务器直接改卡（/api/act），网站重新生成前先在本页记着 ---------- */
const SENT_KEY = "vf-sent";
function loadSent() { try { const x = JSON.parse(sessionStorage.getItem(SENT_KEY) || "[]"); return Array.isArray(x) ? x : []; } catch (e) { return []; } }
function saveSent(list) { try { sessionStorage.setItem(SENT_KEY, JSON.stringify(list.slice(-40))); } catch (e) {} }
let AFTER = null; // 刚发完自动刷新：跳过开场动画，回到原来的位置
try { AFTER = JSON.parse(sessionStorage.getItem("vf-after-send") || "null"); sessionStorage.removeItem("vf-after-send"); } catch (e) {}
const QUICK = !!AFTER;
// 刚改好、网站还没重新生成的，先在本页记着；网站在那之后重新生成过，就以网站为准
const LOCAL_SENT = DEMO ? [] : loadSent().filter(it => it && it.id && it.at && Date.parse(IDX.generated_at) < Date.parse(it.at));
saveSent(LOCAL_SENT);
const PENDING = LOCAL_SENT;
// 哪个按钮先把哪类「等你」收起来
const RESOLVES = (k, v) => k === "answer" ? ["ask"] : k === "douplus" ? (v === "top_up" || v === "no_top_up" ? ["douplus_top_up"] : ["douplus"]) : k === "pick" || k === "shelve" ? ["candidate"] : [];
const pendFor = id => PENDING.filter(p => p.card === id);
const pendResolving = id => pendFor(id).filter(p => RESOLVES(p.kind, p.value).length);
const CHAT_HINT = "要说别的（改结论、补素材、恢复搁置），去和 agent 的对话里说";
const answeredBy = a => PENDING.some(p => p.card === a.card && RESOLVES(p.kind, p.value).includes(a.kind) && (a.kind !== "ask" || p.question === a.question));
IDX.asks = (IDX.asks || []).filter(a => !answeredBy(a));
if (IDX.summary) IDX.summary.asks = IDX.asks.length;
if (IDX.pick_candidates) {
  IDX.pick_candidates.cards = IDX.pick_candidates.cards.filter(id => !pendFor(id).some(p => p.kind === "pick" || p.kind === "shelve"));
  if (!IDX.pick_candidates.cards.length) IDX.pick_candidates = null;
}
const DP_LABEL = { invest: "投", skip: "不投", ordered: "已下单", top_up: "加投了", no_top_up: "不加投" };
function pendText(p) {
  if (p.summary) return p.summary;
  const tx = p.text ? `「${p.text}」` : "";
  if (p.kind === "answer") return p.value ? `「${p.value}」${p.text ? `，还说${tx}` : ""}` : tx;
  if (p.kind === "pick") return `定了，这周拍${p.text ? `（${p.text}）` : ""}`;
  if (p.kind === "shelve") return `搁置，原因${tx}`;
  if (p.kind === "douplus") return `DOU+ ${DP_LABEL[p.value] || p.value}${p.amount ? ` ${p.amount} 元` : ""}`;
  if (p.kind === "idea") return `新灵感${tx}`;
  return tx;
}
function pendLines(list) {
  return list.map(p => `<div class="rp-done"><span>你点了：<b>${esc(pendText(p))}</b></span><em>已写进卡，网页正在更新</em></div>`).join("");
}
const attr = o => esc(JSON.stringify(o));
// 一条「等你」下面的回复按钮：选项一点，服务器直接改卡
function replyUI(a) {
  if (!a || !a.card) return "";
  const opts = a.options || [];
  let btns = [];
  if (a.kind === "douplus") {
    btns = opts.map(o => /不投/.test(o) ? { l: "不投", b: { kind: "douplus", card: a.card, value: "skip" } }
      : { l: o, b: { kind: "douplus", card: a.card, value: "invest", amount: +(o.match(/\d+/) || [0])[0] || null } });
    const inv = btns.find(x => x.b.value === "invest");
    if (inv) btns.push({ l: `${inv.b.amount} 元，已经下单了`, b: { kind: "douplus", card: a.card, value: "ordered", amount: inv.b.amount } });
  } else if (a.kind === "douplus_top_up") {
    btns = opts.map(o => /不加/.test(o) ? { l: "不加", b: { kind: "douplus", card: a.card, value: "no_top_up" } }
      : { l: `${o} 元，已经下单了`, b: { kind: "douplus", card: a.card, value: "top_up", amount: +(o.match(/\d+/) || [0])[0] || null } });
  } else {
    btns = opts.map(o => ({ l: o, b: { kind: "answer", card: a.card, question: a.question, value: o } }));
  }
  const form = a.kind === "ask" ? `<div class="rp-hint">都不对？去和 agent 的对话里说</div>` : "";
  return `<div class="rp">${btns.length ? `<div class="rp-btns">${btns.map((x, i) => `<button type="button" class="rp-btn${i ? "" : " pri"}" data-send="${attr(x.b)}">${esc(x.l)}</button>`).join("")}</div>` : ""}${form}</div>`;
}
// 候选：定了 / 搁置（搁置要写原因，点了才展开）。缺结论或类型的定不了，先去对话里补
function candidateUI(c, compact) {
  const p = pendFor(c.id).filter(x => x.kind === "pick" || x.kind === "shelve");
  if (p.length) return pendLines(p);
  const fid = `rp-sh-${c.id}`;
  const lack = [!c.conclusion && "一句话结论", !c.kind && "类型"].filter(Boolean);
  const pick = lack.length
    ? `<button type="button" class="rp-btn pri" disabled title="还缺${lack.join("和")}">定了，这周拍</button>`
    : `<button type="button" class="rp-btn pri" data-send="${attr({ kind: "pick", card: c.id })}">定了，这周拍</button>`;
  return `<div class="rp${compact ? " sm" : ""}"><div class="rp-btns">${pick}<button type="button" class="rp-btn" data-reveal="${fid}">搁置…</button></div>${lack.length ? `<div class="rp-hint">还缺${lack.join("和")}，去对话里让 agent 补上再定</div>` : ""}
    <form class="rp-form" id="${fid}" hidden data-send-form="${attr({ kind: "shelve", card: c.id })}"><input name="text" maxlength="300" required autocomplete="off" placeholder="为什么先放着，一句话" aria-label="搁置原因"><button type="submit">搁置</button></form></div>`;
}
// 记灵感：一句话，点了直接建一张灵感卡
function ideaForm(ph, btn) {
  return `<form class="rp-form" data-send-form="${attr({ kind: "idea" })}"><input name="text" maxlength="300" required autocomplete="off" placeholder="${esc(ph)}" aria-label="${esc(ph)}"><button type="submit">${esc(btn)}</button></form>`;
}
let toastT;
function toast(msg, bad) {
  let t = document.getElementById("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.textContent = msg; t.className = bad ? "bad show" : "show";
  clearTimeout(toastT); toastT = setTimeout(() => { t.className = bad ? "bad" : ""; }, bad ? 6000 : 2600);
}
async function send(body, el) {
  if (DEMO) { toast("这是示例数据，按钮不会发出去。回到你自己的看板再点。"); return; }
  const btns = el ? [...(el.closest("form, .rp") || el).querySelectorAll("button")] : [];
  btns.forEach(b => b.disabled = true);
  try {
    let r;
    try { r = await fetch("/api/act", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin", redirect: "manual" }); }
    catch (e) { throw new Error("连不上，可能是登录过期了。刷新页面再试"); }
    if (r.type === "opaqueredirect" || r.status === 0) throw new Error("登录过期了，刷新页面重新登录再试");
    const j = await r.json().catch(() => null);
    if (!j) throw new Error(r.status === 404 || r.status === 405 ? "网页回写还没部署上" : `服务器回了 ${r.status}`);
    if (!j.ok) throw new Error(j.message || `服务器回了 ${r.status}`);
    const list = loadSent(); list.push(j.item); saveSent(list);
    if (j.item.kind === "idea") { try { sessionStorage.setItem("vf-after-send", JSON.stringify({ sel: null, y: scrollY })); } catch (e) {} toast("记下了，建了一张灵感卡"); setTimeout(() => location.reload(), 900); return; }
    try { sessionStorage.setItem("vf-after-send", JSON.stringify({ sel: typeof sel === "number" ? sel : null, y: scrollY })); } catch (e) {}
    toast("改好了，网页正在更新，半分钟左右刷新就能看到");
    setTimeout(() => location.reload(), 700);
  } catch (e) {
    toast(`没改成：${e.message}`, true);
    btns.forEach(b => b.disabled = false);
  }
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-send]");
  if (b) { e.preventDefault(); e.stopPropagation(); send(JSON.parse(b.dataset.send), b); return; }
  const r = e.target.closest("[data-reveal]");
  if (r) { e.preventDefault(); e.stopPropagation(); const f = document.getElementById(r.dataset.reveal); if (f) { f.hidden = !f.hidden; if (!f.hidden) f.querySelector("input, textarea")?.focus(); } }
}, true);
document.addEventListener("submit", e => {
  const f = e.target.closest("form[data-send-form]"); if (!f) return;
  e.preventDefault();
  const body = JSON.parse(f.dataset.sendForm), tx = (new FormData(f).get("text") || "").trim();
  if (!tx) { toast("写点什么再发", true); return; }
  body.text = tx;
  send(body, f.querySelector("button"));
});

/* ---------- 时间：都按 config.json 的时区显示 ---------- */
const FMT = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function parts(x) { const o = {}; for (const p of FMT.formatToParts(x)) o[p.type] = p.value; return { y: +o.year, m: +o.month, d: +o.day, wd: o.weekday, hm: `${o.hour}:${o.minute}` }; }
function d(s) { return s instanceof Date ? s : new Date(String(s).length === 10 ? s + "T12:00:00Z" : s); }
const ymd = x => { const p = parts(d(x)); return Date.UTC(p.y, p.m - 1, p.d); };
function md(s) { const p = parts(d(s)); return `${p.m} 月 ${p.d} 日`; }
function short(s) { const p = parts(d(s)); return `${p.m}/${p.d}`; }
const WD = { Mon: "周一", Tue: "周二", Wed: "周三", Thu: "周四", Fri: "周五", Sat: "周六", Sun: "周日" };
function fromNow(t) {
  const x = d(t), days = Math.round((ymd(x) - ymd(NOW)) / DAY), p = parts(x);
  const w = days === 0 ? "今天" : days === 1 ? "明天" : days === -1 ? "昨天" : `${p.m}/${p.d}`;
  return `${w} ${p.hm}`;
}
function daysSince(s) { return s ? Math.floor((NOW - d(s)) / DAY) : 0; }
function isoWeekOf(x) {
  const p = parts(d(x)), t = new Date(Date.UTC(p.y, p.m - 1, p.d)), dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const w = Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY + 1) / 7);
  return `${t.getUTCFullYear()}-W${pad(w)}`;
}
function weekMonday(w) {
  const [y, n] = w.split("-W").map(Number), jan4 = new Date(Date.UTC(y, 0, 4)), dow = jan4.getUTCDay() || 7;
  return new Date(Date.UTC(y, 0, 4 - dow + 1 + (n - 1) * 7));
}
function weekRange(w) {
  const a = weekMonday(w), b = new Date(a.getTime() + 6 * DAY), am = a.getUTCMonth() + 1, bm = b.getUTCMonth() + 1;
  return am === bm ? `${am} 月 ${a.getUTCDate()} 日 – ${b.getUTCDate()} 日` : `${am} 月 ${a.getUTCDate()} 日 – ${bm} 月 ${b.getUTCDate()} 日`;
}
function weekTab(w) {
  const a = weekMonday(w), b = new Date(a.getTime() + 6 * DAY);
  return `${a.getUTCMonth() + 1}/${a.getUTCDate()}–${a.getUTCMonth() === b.getUTCMonth() ? b.getUTCDate() : `${b.getUTCMonth() + 1}/${b.getUTCDate()}`}`;
}
const THIS_WEEK = isoWeekOf(NOW);
function wk(w) {
  if (!w) return "";
  const diff = Math.round((weekMonday(w) - weekMonday(THIS_WEEK)) / (7 * DAY));
  return diff === 0 ? "这周" : diff === -1 ? "上周" : diff === 1 ? "下周" : `${weekTab(w).split("–")[0]} 那周`;
}

/* ---------- 把 index 里的卡和原始卡合在一起 ---------- */
const ASK_BY = {};
(IDX.asks || []).forEach(a => { if (!ASK_BY[a.card]) ASK_BY[a.card] = a; });
function history(h) {
  return (h || []).map((x, i, a) => {
    const nx = a[i + 1];
    const fail = x.stage === "sample_gate" && nx && (nx.stage === "edit" || nx.stage === "record");
    return [x.stage, x.at, nx ? nx.at : null, fail ? "fail" : null];
  });
}
const CARDS = (IDX.cards || []).map(ic => {
  const raw = RAW[ic.id] || {}, a = ASK_BY[ic.id];
  const pubs = raw.publications || [];
  return Object.assign({}, raw, ic, {
    scores: raw.scores || null,
    sample_gate: raw.sample_gate || { result: ic.sample_gate },
    publications: pubs, notes: raw.notes || [], assets: raw.assets || {},
    vid: ic.no, created: ic.id.slice(0, 10),
    shelved_at: ic.tier === "shelved" ? ic.tier_since : null,
    published_at: pubs.map(p => p.published_at).filter(Boolean).sort()[0] || null,
    derived: Object.assign({}, ic.derived, {
      ask: a ? { q: a.question, ctx: a.context, say: a.options || [], if_no_answer: a.if_no_answer, past: a.past_default, kind: a.kind } : null,
      next_action: ic.next_action, short: ic.short, stage_history: history(ic.derived && ic.derived.stage_history)
    })
  });
});
const ARCHIVE = ((DATA.archive && DATA.archive.cards) || []).map(ac => Object.assign({}, RAW[ac.id] || {}, ac));
const REVIEWS = (DATA.reviews || []).slice().sort((a, b) => b.week.localeCompare(a.week));
const byId = id => CARDS.find(c => c.id === id) || ARCHIVE.find(c => c.id === id);

/* ---------- 剪辑室里的胶片：工位上的卡，顺序照 index 的 stations ---------- */
const V = [], STATIONS = [];
(IDX.stations || []).forEach(st => {
  const s = KEYS.indexOf(st.stage); if (s < 0) return;
  const mk = (id, queued, qn) => {
    const c = CARDS.find(x => x.id === id); if (!c) return null;
    const a = c.derived.ask;
    const v = { id: c.no, cid: c.id, sh: c.short_title, t: c.title, s,
      skip: (c.skipped || []).map(k => KEYS.indexOf(k)).filter(j => j >= 0),
      ask: a ? { q: a.q, c: a.ctx, say: a.say, d: a.if_no_answer, past: a.past, kind: a.kind } : null,
      pend: pendResolving(c.id),
      stuck: c.stuck ? Math.max(1, daysSince(c.last_touched)) : 0,
      must: c.tier === "must", deadline: c.deadline, plan_week: c.plan_week, published_at: c.published_at,
      stat: !a && pendResolving(c.id).length ? "你回了，等 agent 处理" : (c.short && c.short.kind !== "ask" && c.short.text) || (c.next_action && c.next_action.text) || "agent 在做",
      queued, qn };
    V.push(v); return v;
  };
  STATIONS[s] = { on: (st.on_belt || []).map(id => mk(id, false)).filter(Boolean), q: (st.queued || []).map((id, i) => mk(id, true, i + 1)).filter(Boolean) };
});
for (let s = 0; s < 7; s++) if (!STATIONS[s]) STATIONS[s] = { on: [], q: [] };
const ASKS = (IDX.asks || []).map(a => ({ a, v: V.find(v => v.cid === a.card) || null }));
const isSkip = (v, j) => (v.skip || []).includes(j);
const flowing = v => !v.ask && !v.stuck;
const SUM = IDX.summary || { videos: V.length, asks: ASKS.length, working: 0, stuck: 0, queued: 0 };
// 刚在网页上回了、网站还没重新生成的：那盘从「等你」挪到「agent 在做」
if (LOCAL_SENT.length) { SUM.asks = ASKS.length; SUM.working = V.filter(v => !v.ask && !v.stuck && !v.queued).length; }
function planTag(v) {
  if (v.must && v.deadline) return `<span class="due">${short(v.deadline)} 截止</span>`;
  if (v.published_at) return `<span>已发布 ${short(v.published_at)}</span>`;
  if (v.plan_week) return `<span>排在${wk(v.plan_week)}</span>`;
  return "";
}

/* ============================================================
   选题池、复盘、视频详情：三张平面页
   ============================================================ */
let FLAT = false;
const PG = (() => {
const PLAY_CN = { douyin: "播放", xiaohongshu: "播放", x: "曝光", youtube: "观看", bilibili: "播放" };
const CONFIG = {
  stuck_days: CF.stuck_days,
  platforms: CF.platforms.map(p => ({ id: p.id, name: p.name, required: p.required, play: PLAY_CN[p.id] || "播放" })),
  sample_points: { h10: "10 小时", d3: "第 3 天", d7: "第 7 天", douplus_h12: "投后 12 小时" },
  scoring: CF.scoring.screens.map(s => ({ id: s.id, name: s.name, hint: s.description })),
  max_score: CF.scoring.screens.length * CF.scoring.max_per_screen,
  douplus: CF.douplus, compare: CF.compare, archive: CF.archive
};
const PLAT = Object.fromEntries(CONFIG.platforms.map(p => [p.id, p]));
const plName = id => (PLAT[id] && PLAT[id].name) || id;
const STAGES = KEYS.map((k, i) => [k, STAGES_CN[i]]);
const STAGE_NAME = Object.fromEntries([...STAGES, ["reviewed", "已复盘"]]);
const TIER_NAME = { idea: "灵感", candidate: "候选", decided: "已定", must: "必拍", shelved: "搁置" };
const KIND_NAME = { ai_talk: "AI 口播", fitness: "健身", other: "其他" };
const PT = ["h10", "d3", "d7"];
const NOCOMP = ["bounce_2s", "completion_5s", "avg_watch_ratio"];

const RATES = [
  ["like_rate", "点赞率", "p"], ["comment_rate", "评论率", "p"], ["favorite_rate", "收藏率", "p"],
  ["followers_per_1k", "每千播放涨粉", "n"], ["completion_5s", "5s 完播", "p"], ["avg_watch_ratio", "平均播放占比", "p"], ["bounce_2s", "2s 跳出", "p", true]
];
/* 和平时比：脚本算好的 vs/good 翻成 hi / lo / eq / few */
function stOf(x) {
  if (!x || x.value == null) return null;
  if (x.vs === "insufficient") return "few";
  if (x.vs === "flat") return "eq";
  if (x.good === true) return "hi";
  if (x.good === false) return "lo";
  return null;
}
const rateOf = (c, pl, pt, k) => (((c.derived.compare || {}).rates || {})[pl] || {})[pt]?.[k] || null;
/* 归档卡没有逐条对比，用 index 里各平台的基线现算 */
function vsBaseline(pl, pt, key, val, inverse) {
  const b = ((IDX.baselines || {})[pl] || {})[pt]?.[key];
  if (val == null) return null;
  if (!b || b.n < CONFIG.compare.baseline_min) return "few";
  if (!b.value) return val > 0 ? (inverse ? "lo" : "hi") : "eq";
  const r = (val - b.value) / b.value;
  let s = r >= CONFIG.compare.above ? "hi" : r <= -CONFIG.compare.below ? "lo" : "eq";
  if (inverse && s !== "eq") s = s === "hi" ? "lo" : "hi";
  return s;
}

function pct(x, dg = 1) { return x == null ? "—" : (x * 100).toFixed(dg).replace(/\.0$/, "") + "%"; }
const nf = new Intl.NumberFormat("zh-CN");
const n = x => x == null ? "—" : nf.format(x);
function big(x) { return x == null ? "—" : x >= 10000 ? (x / 10000).toFixed(x >= 100000 ? 0 : 1).replace(/\.0$/, "") + "万" : nf.format(x); }
const PT_SHORT = { h10: "10 小时", d3: "3 天", d7: "7 天" };
function nextSamples(c) {
  const ns = (c.next_samples || []).filter(x => PT.includes(x.point) && x.status !== "missed");
  return (c.publications || []).map(p => {
    const x = ns.find(y => y.platform === p.platform);
    return x ? { platform: p.platform, point: x.point, ready: x.status === "due" || x.status === "overdue" } : { platform: p.platform, point: null };
  });
}
const isStuck = c => !!c.stuck;
function scoreOf(c, id) { const x = c.scores && c.scores[id]; return x && typeof x === "object" ? x : null; }
function totalScore(c) { return CONFIG.scoring.reduce((a, s) => a + (scoreOf(c, s.id)?.score ?? 0), 0); }
const hasScores = c => CONFIG.scoring.some(s => scoreOf(c, s.id));
const inProd = c => ["decided", "must"].includes(c.tier) && KEYS.includes(c.stage);

/* ---------- 共用小块 ---------- */
const REEL = `<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18.5" fill="currentColor"/><circle cx="20" cy="20" r="13" fill="none" stroke="var(--yard)" stroke-width="1.4" stroke-dasharray="2.2 2.6"/>${[0, 120, 240].map(a => `<circle cx="${20 + 8.2 * Math.cos(a * Math.PI / 180)}" cy="${20 + 8.2 * Math.sin(a * Math.PI / 180)}" r="3.6" fill="var(--yard)"/>`).join("")}<circle cx="20" cy="20" r="3" fill="var(--yard)"/></svg>`;
function head(title, sub, right = "") {
  return `<header class="p-head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ""}</div>${right}</header>`;
}
function dfLine(a) { return `<div class="df">${a.past ? "没等到你回，agent 按默认做" : "你不回的话"}：<b>${esc(a.if_no_answer)}</b></div>`; }

/* 一条视频的传送带：七个工位一字排开，胶片盘停在现在这一站 */
function belt(c) {
  const idx = KEYS.indexOf(c.stage), ask = !!c.derived.ask, stuck = isStuck(c);
  const hist = c.derived.stage_history || [];
  const dateOf = k => { const h = hist.filter(x => x[0] === k).pop(); return h && h[1] ? short(h[1]) : ""; };
  const failed = hist.find(h => h[3] === "fail");
  const st = ask ? "st-ask" : stuck ? "st-stuck" : c.stage === "data" ? "" : "st-spin";
  const items = STAGES.map(([k, nm], i) => {
    const skip = (c.skipped || []).includes(k);
    const cls = skip ? "skip" : i < idx ? "done" : i === idx ? `now ${st}` : "";
    return `<li class="${cls}">${i === idx ? `<span class="p-reel">${REEL}</span>` : `<span class="p-node"></span>`}<b>${pad(i + 1)}</b><span>${nm}</span><em>${skip ? "跳过" : dateOf(k)}</em></li>`;
  }).join("");
  const tag = ask ? `<span class="p-flag ask">等你</span>` : stuck ? `<span class="p-flag stuck">停了 ${daysSince(c.last_touched)} 天</span>` : c.stage === "data" ? "" : `<span class="p-flag spin">agent 在做</span>`;
  return `<div class="p-belt" style="--k:${idx / 6}">${tag}<div class="p-rail"><i></i></div><ol>${items}</ol>${failed ? `<p class="p-backnote">样片 ${short(failed[1])} 没过，回到剪辑重做了一版</p>` : ""}</div>`;
}
function askBox(c) {
  const a = c.derived.ask, pd = pendResolving(c.id);
  if (a) return `<div class="ask red"><div class="q">${esc(a.q)}</div>${a.ctx ? `<div class="cx">${esc(a.ctx)}</div>` : ""}
    ${replyUI({ kind: a.kind, question: a.q, options: a.say, card: c.id })}${dfLine(a)}${pendLines(pd)}</div>`;
  if (pd.length) return `<div class="ask"><div class="q">你点过了</div>${pendLines(pd)}<div class="df">已经写进卡；网站重新生成后这里会更新。</div></div>`;
  const na = c.derived.next_action;
  if (na) return `<div class="ask ${isStuck(c) ? "amb" : ""}"><div class="q">${esc(na.text)}</div><div class="cx">${na.sub ? esc(na.sub) : isStuck(c) ? "卡住了，agent 在想办法。" : na.who === "user" ? "这一步是你的。" : "agent 在跟，不用你管。"}</div></div>`;
  if (c.blocked_on) return `<div class="ask"><div class="q">${esc(c.blocked_on)}</div><div class="cx">在等，不用你回。</div></div>`;
  if (c.tier === "candidate") return `<div class="ask red"><div class="q">定不定拍这条</div><div class="cx">周一 agent 打完分，定哪几条拍是你唯一要拍板的一步。</div>
    ${candidateUI(c)}<div class="df">你不回的话：<b>留在候选，下周一再排</b></div></div>`;
  if (c.tier === "shelved") return `<div class="ask"><div class="q">搁置 ${daysSince(c.shelved_at)} 天：${esc(c.shelved_reason)}</div><div class="cx">满 ${CONFIG.archive.shelved_days} 天 agent 自动归档。想恢复去和 agent 的对话里说。</div></div>`;
  if (c.tier === "idea") return `<div class="ask"><div class="q">灵感，${md(c.created)}记下</div><div class="cx">周一 agent 打分，够格的升到候选；满 ${CONFIG.archive.idea_days} 天没升会自动归档。</div></div>`;
  return "";
}
function scoreDial(c) {
  const t = totalScore(c);
  return `<span class="p-dial" style="--v:${t / CONFIG.max_score}"><b>${t}</b><small>/${CONFIG.max_score}</small></span>`;
}
function scoreBars(c) {
  return `<div class="p-sbars">${CONFIG.scoring.map(s => { const x = scoreOf(c, s.id); return `<div class="p-sbar"><span class="nm">${s.name}</span><span class="p-pips">${[0, 1].map(i => `<i class="${x && i < x.score ? "on" : ""}"></i>`).join("")}</span><span class="why">${x ? esc(x.why) : "还没打"}</span></div>`; }).join("")}</div>`;
}

/* ============================================================
   视频详情：#card-<id>
   ============================================================ */
let cmpPoint = null;
function viewCard(id) {
  const c = byId(id);
  if (!c) return { nav: "home", title: "找不到", html: `${head("找不到这条视频", "它可能已经归档或改了名字。跟 agent 说名字，它会帮你找。")}<a class="back" href="#">← 回流水线</a>` };
  if (c.archive_reason) {
    const why = { done: "数据采完、进了定稿复盘", idea_30d: `灵感 ${CONFIG.archive.idea_days} 天没升到候选`, shelved_60d: `搁置 ${CONFIG.archive.shelved_days} 天没恢复`, merged: `合并到「${esc(byId(c.merged_into)?.title || c.merged_into || "")}」` }[c.archive_reason] || c.archive_reason;
    return { nav: "review", title: c.title, html: `<a class="back" href="#review">← 回复盘</a>${head(esc(c.title), `已归档。原因：${why}。`)}<div class="ask"><div class="q">想把这条挪回来？</div>${pendFor(c.id).length ? pendLines(pendFor(c.id)) : `<div class="rp"><div class="rp-btns"><button type="button" class="rp-btn" data-send="${attr({ kind: "restore", card: c.id })}">挪回来</button></div></div>`}</div>` };
  }
  const prod = inProd(c), pubs = c.publications || [];
  const backTo = prod ? `<a class="back" href="#">← 回流水线</a>` : `<a class="back" href="#pool">← 回选题池</a>`;
  const tags = [];
  if (c.kind) tags.push(`<span>${KIND_NAME[c.kind]}</span>`);
  tags.push(`<span class="${c.tier === "must" ? "due" : ""}">${TIER_NAME[c.tier]}${c.deadline ? `，${md(c.deadline)}截止` : ""}</span>`);
  if (c.plan_week) tags.push(`<span>排在${wk(c.plan_week)}</span>`);
  if (prod && isStuck(c)) tags.push(`<span class="warn">停了 ${daysSince(c.last_touched)} 天</span>`);
  if (prod) tags.push(`<span>剪辑室 ${pad(c.no)} 号盘</span>`);
  const top = `<div class="p-top">${backTo}<div class="tags">${tags.join("")}</div></div>
    ${head(esc(c.title), c.conclusion ? esc(c.conclusion) : `<span class="p-faint">还没写出一句话结论。写不出来就先别拍。</span>`)}
    ${prod ? belt(c) : ""}
    <div class="p-askrow">${askBox(c)}</div>`;

  let body = "";
  const pts = PT.filter(pt => pubs.some(p => p.samples.some(s => s.point === pt)));
  if (pubs.length && pts.length) {
    const pt = pts.includes(cmpPoint) ? cmpPoint : pts[pts.length - 1];
    const sw = `<span class="p-seg" role="group" aria-label="采样点">${pts.map(p => `<button type="button" data-pt="${p}" aria-pressed="${p === pt}">${CONFIG.sample_points[p]}</button>`).join("")}</span>`;
    const dou = pubs.find(p => p.platform === "douyin");
    body = `<div class="p-grid">
      <div class="p-stack">${boxScore(c, pt, sw)}${boxCompare(c, pt)}</div>
      <div class="p-stack">${dou ? boxDouplus(c, dou) : ""}${boxPubs(c)}</div></div>`;
  } else if (pubs.length) {
    body = `<div class="p-grid"><div class="p-stack"><section class="p-box p-quiet"><h3>成绩</h3><p>发了，还没读到第一次数据。10 小时左右 agent 用你的 Chrome 读。</p></section></div><div class="p-stack">${boxPubs(c)}</div></div>`;
  } else if (prod) {
    body = `<div class="p-box p-quiet"><h3>发布和数据</h3><p>还没发布。发了以后这里会出现各平台成绩、DOU+ 判断和平台对比。</p></div>`;
  }
  const talk = `<p class="p-cap rp-talk">${esc(CHAT_HINT)}，提这条的名字「${esc(c.short_title)}」就行。</p>`;
  return { nav: prod ? "home" : "pool", title: c.title, html: `${top}${body}${folds(c, prod)}${talk}` };
}
function boxScore(c, pt, sw) {
  const rows = c.publications.map(p => ({ p, s: p.samples.find(s => s.point === pt) })).filter(x => x.s && x.s.metrics.plays != null);
  const total = rows.reduce((a, x) => a + x.s.metrics.plays, 0);
  const missing = c.publications.filter(p => !rows.some(x => x.p === p)).map(p => plName(p.platform));
  return `<section class="p-box"><h3>成绩 ${sw}</h3>
    <div class="p-big"><b>${big(total)}</b><span>${CONFIG.sample_points[pt]}，各平台加起来${missing.length ? `（还没算${missing.join("、")}）` : ""}</span></div>
    <div class="p-share">${rows.map(x => `<i class="pc-${x.p.platform}" style="flex:${x.s.metrics.plays || .001}"></i>`).join("")}</div>
    <div class="p-share-l">${rows.map(x => `<span><i class="pc-${x.p.platform}"></i>${plName(x.p.platform)} <b>${big(x.s.metrics.plays)}</b> ${PLAY_CN[x.p.platform] || "播放"}</span>`).join("")}</div>
    <p class="p-cap">X 算的是曝光、YouTube 算的是观看，加起来只看个大概。</p></section>`;
}
function boxCompare(c, pt) {
  const keys = RATES.filter(([k]) => c.publications.some(p => rateOf(c, p.platform, pt, k)?.value != null));
  const j3 = a => a.length > 3 ? `${a.slice(0, 3).join("、")}等 ${a.length} 项` : a.join("、");
  const sum = c.publications.map(p => {
    const sm = p.samples.find(s => s.point === pt);
    if (!sm) return `<div class="p-vs na"><span class="pl">${plName(p.platform)}</span><b>${CONFIG.sample_points[pt]}还没读</b><span class="why"></span></div>`;
    const sts = keys.map(([k, nm]) => ({ nm, st: stOf(rateOf(c, p.platform, pt, k)) })).filter(x => x.st);
    const hi = sts.filter(x => x.st === "hi").map(x => x.nm), lo = sts.filter(x => x.st === "lo").map(x => x.nm);
    let cls, word, why;
    if (!sts.length || sts.some(x => x.st === "few")) { cls = "few"; word = "发得少，还没法比"; why = `这个平台之前发得太少，满 ${CONFIG.compare.baseline_min} 条才比`; }
    else if (hi.length > lo.length) { cls = "hi"; word = "比平时好"; why = `${j3(hi)}更高${lo.length ? `；${j3(lo)}偏低` : ""}`; }
    else if (lo.length > hi.length) { cls = "lo"; word = "比平时差"; why = `${j3(lo)}偏低${hi.length ? `；${j3(hi)}更高` : ""}`; }
    else { cls = "eq"; word = "和平时差不多"; why = hi.length ? `${hi.join("、")}更高，${lo.join("、")}偏低` : "各项都在平时上下"; }
    return `<div class="p-vs ${cls}"><span class="pl">${plName(p.platform)}</span><b>${word}</b><span class="why">${why}</span></div>`;
  }).join("");
  const rows = c.publications.map(p => {
    const s = p.samples.find(s => s.point === pt);
    return `<tr><th>${plName(p.platform)}</th>${keys.map(([k, , f]) => {
      if (!s) return `<td class="na">没录</td>`;
      const x = rateOf(c, p.platform, pt, k); if (!x || x.value == null) return `<td class="na">—</td>`;
      const st = stOf(x);
      return `<td class="${st === "few" ? "" : st || ""}">${f === "p" ? pct(x.value) : x.value.toFixed(1)}</td>`;
    }).join("")}</tr>`;
  }).join("");
  return `<section class="p-box"><h3>各平台比平时好不好 <small>和这个平台自己最近 ${CONFIG.compare.baseline_count} 条比</small></h3>
    <div class="p-vss">${sum}</div>
    ${keys.length ? `<details class="p-more"><summary>看每一项指标</summary><div class="p-tblw"><table class="p-tbl"><thead><tr><th></th>${keys.map(([, nm]) => `<th>${nm}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div><p class="p-cap">绿色比平时高，红色比平时低，差 ${Math.round(CONFIG.compare.above * 100)}% 以上才算。</p></details>` : ""}</section>`;
}
function boxDouplus(c, p) {
  const t = CONFIG.douplus.thresholds, dp = p.douplus || {}, dd = c.derived.douplus || {};
  const first = dd.first || { status: "waiting" };
  if (first.status === "waiting") return `<section class="p-box"><h3>DOU+</h3><p class="p-cap">等抖音 10 小时数据。</p></section>`;
  const NAME = { bounce_2s: "2s 跳出", completion_5s: "5s 完播", avg_watch_ratio: "平均播放占比", interaction: "收藏率或评论" };
  const RULE = { bounce_2s: `≤ ${pct(t.bounce_2s_max, 0)}`, completion_5s: `≥ ${pct(t.completion_5s_min, 0)}`, avg_watch_ratio: `≥ ${pct(t.avg_watch_ratio_min, 0)}`, interaction: `≥ ${pct(t.favorite_rate_min, 0)} 或 ≥ ${t.comments_min} 条` };
  const items = (first.checks || []).map(k => ({ name: NAME[k.id] || k.id, rule: RULE[k.id] || k.rule, pass: k.pass,
    fmt: k.id === "interaction" ? (k.value.favorite_rate != null ? pct(k.value.favorite_rate) : k.value.comments != null ? `${k.value.comments} 条` : "—") : pct(k.value, k.id === "avg_watch_ratio" ? 1 : 0) }));
  const verdict = first.status === "invest" ? "go" : first.status === "skip" ? "no" : "unknown";
  const fails = items.filter(i => i.pass === false);
  const vTxt = verdict === "go" ? `建议投 ${CONFIG.douplus.first_amount} 元` : verdict === "no" ? "建议不投" : "数据不全，先不判";
  const vSub = verdict === "go" ? `四项都过。投 ${CONFIG.douplus.first_hours} 小时，目标${CONFIG.douplus.goal}，${CONFIG.douplus.targeting}` : verdict === "no" ? `${fails.map(f => f.name).join("、")}没过` : "缺的项补上再判";
  const dpPend = pendFor(c.id).filter(x => x.kind === "douplus");
  const dpAsk = (IDX.asks || []).find(a => a.card === c.id && a.kind === "douplus");
  const tuAsk = (IDX.asks || []).find(a => a.card === c.id && a.kind === "douplus_top_up");
  // 详情页顶上的红框已经是这条「等你」时，这里不再重复放按钮
  const topAsk = c.derived.ask && c.derived.ask.kind;
  let tail = !dp.decision ? (dpPend.length ? "" : `<p class="p-cap">等你定。下单是你自己在抖音里下，下完点「已经下单了」。</p>${dpAsk && topAsk !== "douplus" ? replyUI(dpAsk) : ""}`)
    : `<p class="p-cap">你定的：<b>${dp.decision === "invest" ? `投 ${dp.amount} 元${dp.ordered_at ? `，${fromNow(dp.ordered_at)}下单` : ""}` : "不投"}</b>${dp.top_up ? `；加投：<b>${dp.top_up.amount} 元</b>` : ""}</p>`
      + (dp.decision === "invest" && !dp.ordered_at && !dpPend.length ? `<div class="rp"><div class="rp-btns"><button type="button" class="rp-btn pri" data-send="${attr({ kind: "douplus", card: c.id, value: "ordered", amount: dp.amount })}">在抖音下单了（${dp.amount} 元）</button></div></div>` : "");
  if (tuAsk && !dpPend.length && topAsk !== "douplus_top_up") tail += replyUI(tuAsk);
  tail += pendLines(dpPend);
  const tu = dd.top_up || {};
  if (["suggest", "no", "incomplete"].includes(tu.status)) {
    const k = (tu.improved || []).length;
    tail = `<p class="p-cap">投后 12 小时 ${k} 项变好${tu.status === "suggest" ? `，可以再加投 ${tu.suggestion.amount} 元，等你定` : tu.status === "incomplete" ? "，有几项没读到" : ""}。</p>` + tail;
  } else if (tu.status === "waiting") tail = `<p class="p-cap">等下单后 12 小时数据，再判断要不要加投。</p>` + tail;
  return `<section class="p-box"><h3>DOU+ <small>看抖音 10 小时这四项</small></h3>
    <div class="p-verdict ${verdict}"><b>${vTxt}</b><span>${vSub}</span></div>
    <div class="p-lights">${items.map(i => `<div class="${i.pass === true ? "pass" : i.pass === false ? "bad" : "unk"}"><span class="lamp"></span><b>${i.fmt}</b><span class="nm">${i.name}</span><span class="rule">要 ${i.rule}</span></div>`).join("")}</div>
    ${tail}</section>`;
}
function boxPubs(c) {
  const ns = Object.fromEntries(nextSamples(c).map(s => [s.platform, s]));
  const listed = c.publications.map(p => p.platform);
  const missingReq = CONFIG.platforms.filter(p => p.required && !listed.includes(p.id));
  return `<section class="p-box"><h3>发布记录 <small>${c.publications.length} 个平台</small></h3><div class="p-pubs">
    ${c.publications.map(p => {
      const nx = ns[p.platform] || {};
      const marks = PT.map(pt => {
        const s = p.samples.find(s => s.point === pt);
        const miss = s && (s.missing || []).length > 0;
        const cls = s ? (miss ? "miss" : "ok") : nx.point === pt && nx.ready ? "due" : "";
        return `<span class="${cls}" title="${s ? (miss ? "有几项没读到" : "读到了") : nx.point === pt && nx.ready ? "到点该读了" : "还没到"}">${PT_SHORT[pt]}</span>`;
      }).join("");
      return `<div class="p-pub"><span class="pn">${plName(p.platform)}</span><span class="when">${fromNow(p.published_at)}发</span><span class="p-pts">${marks}</span></div>`;
    }).join("")}
    ${missingReq.map(p => `<div class="p-pub"><span class="pn">${p.name}</span><span class="when p-warn">必发平台，还没发</span><span></span></div>`).join("")}
  </div><p class="p-cap">绿色读到了，红色到点该读，黄色有几项没读到。</p></section>`;
}
function folds(c, prod) {
  const out = [];
  if (hasScores(c)) out.push(`<details class="p-fold"><summary>选题打分<span class="peek">${totalScore(c)} 分（满分 ${CONFIG.max_score}），${c.scores.scored_by === "user" ? "你改过" : "agent 打的"}</span></summary><div class="in"><p class="p-cap">值不值得拍看四件事，每件 0 到 2 分。</p>${scoreBars(c)}</div></details>`);
  if (prod) {
    const g = c.sample_gate || {};
    const st = g.result === "pass" ? "过了" : g.result === "fail" ? "没过" : c.stage === "sample_gate" ? "在审" : "还没到";
    out.push(`<details class="p-fold"><summary>样片检查<span class="peek">${st}${g.decided_by ? (g.decided_by === "user" ? "，你判的" : "，agent 判的") : ""}</span></summary><div class="in"><p>${g.note ? esc(g.note) : "剪完先出 30 秒样片，agent 审。"}</p></div></details>`);
    const a = c.assets || {};
    const rows = [["文案分镜", a.script_doc], ["文案版本", a.script_version], ["录音版本", a.record_version], ["剪辑版本", a.edit_version], ["本地项目", a.local_project]].filter(([, v]) => v);
    const val = v => /^https?:\/\//.test(v) ? `<a href="${esc(v)}" target="_blank" rel="noopener noreferrer">打开</a>` : esc(v);
    out.push(`<details class="p-fold"><summary>素材<span class="peek">${rows.length} 项${(c.skipped || []).length ? `，跳过了${c.skipped.map(s => STAGE_NAME[s]).join("、")}` : ""}</span></summary><div class="in">${rows.length ? `<dl class="p-kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${val(v)}</dd>`).join("")}</dl>` : `<p>还没有素材。</p>`}</div></details>`);
  }
  const ns = c.notes || [];
  out.push(`<details class="p-fold"><summary>记录<span class="peek">${ns.length ? `${ns.length} 条，最近 ${short(ns[ns.length - 1].at)}` : "还没有"}</span></summary><div class="in">${ns.length ? `<ol class="p-notes">${ns.slice().reverse().map(x => `<li><span class="w">${short(x.at)}</span><span>${esc(x.text)}</span><em>${x.by === "user" ? "你" : "agent"}</em></li>`).join("")}</ol>` : "<p>还没有记录。</p>"}</div></details>`);
  return `<div class="p-folds">${out.join("")}</div>`;
}

/* ============================================================
   选题池：#pool
   ============================================================ */
let poolTier = "candidate";
function viewPool() {
  const carry = IDX.latest_next_week;
  const tiers = ["candidate", "idea", "decided", "must", "shelved"];
  const counts = Object.fromEntries(tiers.map(t => [t, CARDS.filter(c => c.tier === t).length]));
  const list = CARDS.filter(c => c.tier === poolTier);
  let body;
  if (poolTier === "candidate") {
    list.sort((a, b) => totalScore(b) - totalScore(a) || a.no - b.no);
    const pc = IDX.pick_candidates;
    const open = list.filter(c => !pendFor(c.id).some(p => p.kind === "pick" || p.kind === "shelve"));
    body = list.length ? `<div class="ask ${open.length ? "red " : ""}p-decide"><div class="q">${esc(pc?.question || "这周拍哪几条")}</div><div class="cx">${esc(pc?.context || `${list.length} 条候选，agent 已经按四项打好分，从高到低排。`)}定哪几条拍是你唯一要拍板的一步。</div>
      <div class="say">在每条下面点「定了，这周拍」或「搁置」，可以定好几条。</div><div class="df">你不回的话：<b>${esc(pc?.if_no_answer || "这周先拍已定的，候选留到下周一")}</b></div></div>
      <div class="p-cans">${list.map((c, i) => `<div class="p-canw"><a class="p-can" href="#card-${c.id}">
        <span class="p-can-h"><i>${pad(i + 1)}</i><span class="k">${c.kind ? KIND_NAME[c.kind] : "未分类"}</span>${scoreDial(c)}</span>
        <b class="t">${esc(c.title)}</b>
        <span class="cc">${c.conclusion ? esc(c.conclusion) : `<span class="p-warn">还没写出一句话结论</span>`}</span>
        ${scoreBars(c)}</a>${candidateUI(c, true)}</div>`).join("")}</div>`
      : `<p class="p-cap p-tiernote">现在没有候选。周一 agent 给灵感打分，够格的升到这里。</p>`;
  } else {
    list.sort((a, b) => a.no - b.no);
    const rows = list.map(c => {
      let s = "", r = "", warn = false;
      if (poolTier === "idea") { const dup = (c.derived.similar || [])[0]; const left = CONFIG.archive.idea_days - daysSince(c.tier_since); warn = left <= 3; s = `${md(c.created)}记下${dup ? `，可能和「${esc(dup.title)}」重复` : ""}`; r = left <= 0 ? "到期，等归档" : warn ? `${left} 天后归档` : `还剩 ${left} 天`; }
      else if (poolTier === "shelved") { const left = CONFIG.archive.shelved_days - daysSince(c.shelved_at); warn = left <= 3; s = esc(c.shelved_reason); r = left <= 0 ? "到期，等归档" : warn ? `${left} 天后归档` : `搁置 ${daysSince(c.shelved_at)} 天`; }
      else { s = [c.plan_week ? `排在${wk(c.plan_week)}` : "", c.deadline ? `${md(c.deadline)}截止` : ""].filter(Boolean).join("，"); r = c.derived.ask ? "等你" : isStuck(c) ? "卡住" : `在${STAGE_NAME[c.stage]}`; warn = !!c.derived.ask || isStuck(c); }
      return `<a class="p-row" href="#card-${c.id}"><i>${pad(c.no)}</i><span><b>${esc(c.title)}</b><span class="s">${s}</span></span><em class="${warn ? (r === "等你" ? "red" : "warn") : ""}">${r}</em></a>`;
    }).join("");
    const note = { idea: "周一 agent 打分，够格的升到候选。", decided: "已经定了要拍，正在流水线上走。", must: "必须拍，有截止日期。", shelved: "先放着，想恢复去和 agent 的对话里说。" }[poolTier];
    body = `<p class="p-cap p-tiernote">${note}</p><div class="p-rows">${rows || `<p class="p-cap">这一档是空的。</p>`}</div>`;
  }
  const soon = (IDX.archive_candidates || []).filter(a => byId(a.card) && ["idea_30d", "shelved_60d"].includes(a.reason));
  const loose = PENDING.filter(p => p.kind === "idea" && !byId(p.card));
  const jot = `<section class="p-box rp-jot"><h3>记个灵感 <small>一句话就行，点了直接建卡；agent 之后查重，周一一起打分</small></h3>${pendLines(loose)}
    <div class="rp-jot-f">${ideaForm("比如：试试用 AI 做一周饮食记录，看能不能坚持", "记下")}</div></section>`;
  return { nav: "pool", title: "选题池", html: `
    ${head("选题池", "灵感先攒在这里，周一 agent 打分，你只定哪几条拍。")}
    ${jot}
    ${carry && carry.items && carry.items.length ? `<section class="p-carry"><span class="p-lab">${wk(carry.week)}复盘说要改的</span><ol>${carry.items.map(x => `<li>${esc(x)}</li>`).join("")}</ol></section>` : ""}
    <div class="p-tabs" role="group" aria-label="档位">${tiers.map(t => `<button type="button" data-tier="${t}" aria-pressed="${t === poolTier}">${TIER_NAME[t]}<b>${counts[t]}</b></button>`).join("")}</div>
    ${body}
    ${soon.length ? `<section class="p-box p-soon"><h3>快到期，agent 会自动归档 <small>会写进当周复盘，可以撤回</small></h3><div class="p-rows">${soon.map(a => { const c = byId(a.card); return `<a class="p-row" href="#card-${c.id}"><i class="d"></i><span><b>${esc(c.title)}</b><span class="s">${a.reason === "idea_30d" ? `灵感满 ${CONFIG.archive.idea_days} 天没升候选` : `搁置满 ${CONFIG.archive.shelved_days} 天`}</span></span><em class="warn">${a.due ? "到期了" : md(a.eligible_at)}</em></a>`; }).join("")}</div></section>` : ""}` };
}

/* ============================================================
   复盘：#review、#review-2026-W44
   ============================================================ */
function viewReview(week) {
  if (!REVIEWS.length) return { nav: "review", title: "复盘", html: `${head("复盘", "还没有复盘。每周日 agent 按这周发的视频写一份，写好就出现在这里。")}` };
  const r = REVIEWS.find(x => x.week === week) || REVIEWS[0];
  const VERD = { hi: "比平时好", lo: "比平时差", eq: "和平时差不多", few: "发得少，还没法比" };
  const perf = (r.cards || []).map(id => {
    const c = byId(id); if (!c) return "";
    const active = !c.archive_reason;
    const nx = active ? Object.fromEntries(nextSamples(c).map(x => [x.platform, x])) : {};
    const list = (c.publications || []).map(p => ({ pl: p.platform, h10: p.samples.find(s => s.point === "h10")?.metrics, d3: p.samples.find(s => s.point === "d3")?.metrics, d7: p.samples.find(s => s.point === "d7")?.metrics, ready: nx[p.platform]?.ready ? nx[p.platform].point : null }));
    const dueAt = list.find(x => x.ready)?.ready;
    const plats = list.map(x => {
      const pt = x.d7 ? "d7" : x.d3 ? "d3" : x.h10 ? "h10" : null;
      const mt = pt && x[pt];
      const fr = mt && mt.favorites != null && mt.plays ? mt.favorites / mt.plays : null;
      const st = !mt ? "na" : (active ? stOf(rateOf(c, x.pl, pt, "favorite_rate")) : vsBaseline(x.pl, pt, "favorite_rate", fr)) || "na";
      return { pl: x.pl, st, html: `<div class="p-pc ${st}"><span class="pl">${plName(x.pl)}</span><b>${st === "na" ? (mt ? "收藏没读到" : "还没数据") : VERD[st]}</b><span class="nm">${mt ? `${CONFIG.sample_points[pt]} ${big(mt.plays)} ${PLAY_CN[x.pl] || "播放"}，收藏率 ${pct(fr)}` : ""}</span></div>` };
    });
    const grp = k => plats.filter(x => x.st === k).map(x => plName(x.pl)).join("、");
    const parts = [["hi", "比平时好"], ["lo", "比平时差"]].filter(([k]) => grp(k)).map(([k, w]) => `${grp(k)}<b class="${k}">${w}</b>`);
    const cmp = plats.filter(x => ["hi", "lo", "eq"].includes(x.st));
    const verdict = parts.length ? parts.join("，") : cmp.length ? "各平台都和平时差不多" : "数据还不够下结论";
    return `<div class="p-perf"><div class="p-perf-h"><a href="#card-${c.id}">${esc(c.title)}</a>${dueAt ? `<span class="p-due">${CONFIG.sample_points[dueAt]}数据该读了</span>` : ""}</div><p class="v">${verdict}</p><div class="p-pcs">${plats.map(x => x.html).join("")}</div></div>`;
  }).join("");
  const why = { done: "采完、进了复盘", idea_30d: `灵感满 ${CONFIG.archive.idea_days} 天`, shelved_60d: `搁置满 ${CONFIG.archive.shelved_days} 天`, merged: "和另一条合并了" };
  const titleOf = id => esc(byId(id)?.title || id);
  const screen = (k, lab, b) => b ? `<a class="p-screen ${k}" href="#card-${b.card}"><span class="p-lab">${lab}</span><b>${titleOf(b.card)}</b><span class="why">${esc(b.why)}</span></a>` : "";
  const tabs = `<div class="p-seg p-weeks" aria-label="往期">${REVIEWS.slice(0, 6).map(x => `<a href="#review-${x.week}" ${x.week === r.week ? `aria-current="page"` : ""}>${weekTab(x.week)}</a>`).join("")}</div>`;
  const pats = (r.patterns || []).map(x => typeof x === "string" ? x : x.text);
  const arch = r.archived || [];
  return { nav: "review", title: `复盘 ${weekRange(r.week)}`, html: `
    ${head(`${weekRange(r.week)} 复盘`, `${r.status === "final" ? "agent 已定稿" : "草稿，agent 还在写"}${r.updated_at ? `，${fromNow(r.updated_at)}更新` : ""}。只按收藏率比，和每个平台自己平时比。`, tabs)}
    ${r.best || r.worst ? `<div class="p-screens">${screen("best", "这周最好", r.best)}${screen("worst", "这周最差", r.worst)}</div>` : ""}
    <div class="p-grid">
      <div class="p-stack">
        <section class="p-box"><h3>看出来的规律</h3>${pats.length ? `<ol class="p-pats">${pats.map((x, i) => `<li><i>${pad(i + 1)}</i><span>${esc(x)}</span></li>`).join("")}</ol>` : `<p class="p-cap">还没写。</p>`}</section>
        <section class="p-box"><h3>每条视频表现怎么样 <small>按收藏率，和这个平台自己平时比</small></h3><div class="p-perfs">${perf || `<p class="p-cap">这周没有发布。</p>`}</div></section>
      </div>
      <div class="p-stack">
        <section class="p-carry v"><span class="p-lab">下周改什么，会放到选题池顶上</span>${(r.next_week || []).length ? `<ol>${r.next_week.map(x => `<li>${esc(x)}</li>`).join("")}</ol>` : `<p class="p-cap">还没写。</p>`}</section>
        <section class="p-box"><h3>agent 这周归档了 <small>要撤回就说一声</small></h3><div class="p-rows">${arch.length ? arch.map(a => `<a class="p-row" href="#card-${a.card}"><i class="d"></i><span><b>${titleOf(a.card)}</b><span class="s">${why[a.reason] || a.reason}${a.reason === "merged" && a.merged_into ? `：「${titleOf(a.merged_into)}」` : ""}</span></span></a>`).join("") : `<p class="p-cap">这周没有归档。</p>`}</div></section>
      </div>
    </div>` };
}

function render(h) {
  if (h.startsWith("card-")) return viewCard(h.slice(5));
  if (h === "pool") return viewPool();
  if (h.startsWith("review")) return viewReview(h.slice(7));
  return null;
}
function click(e) {
  const t = e.target.closest("[data-tier]"); if (t) { poolTier = t.dataset.tier; return true; }
  const p = e.target.closest("[data-pt]"); if (p) { cmpPoint = p.dataset.pt; return true; }
  return false;
}
return { render, click, cardFor: no => (V.find(v => v.id === no) || {}).cid, resetPt: () => { cmpPoint = null; } };
})();

/* 选项是深色、暖色、跟随系统；跟随系统时系统浅色就用浅色场景、系统深色就用深色。墙、地、白模、灯光一起换 */
const THEMES = {
  dark:  { bg: 0x121317, floorA: "#2a2c32", floorB: "#32353c", wall: 0x2b2e35, panel: 0x474b54, zone: 0x34373e, model: 0xeceef2, dark: 0x222429, soft: 0x464a53, belt: 0x50545c, plant: 0x2f4a33,
           hemi: [0xdfe6ff, 0x2a2420, .5], sun: [0xfff4e6, 1.2], fill: [0x9db4ff, .25], exp: 1.05, wash: .16, screen: .62, neon: true },
  light: { bg: 0xe6e8ec, floorA: "#dde0e5", floorB: "#d0d4da", wall: 0xeef0f3, panel: 0xd6dae0, zone: 0xd3d7dd, model: 0xffffff, dark: 0x43474f, soft: 0xa7adb6, belt: 0x8f949c, plant: 0x5f8c64,
           hemi: [0xffffff, 0xbdb6ac, .9], sun: [0xffffff, 1.05], fill: [0xe2eaff, .3], exp: 1, wash: 0, screen: .92, neon: false },
  warm:  { bg: 0x15100c, floorA: "#3a2c22", floorB: "#44352a", wall: 0x2b221c, panel: 0x56443a, zone: 0x3b2f26, model: 0xf3e7d6, dark: 0x231b16, soft: 0x5c4b3f, belt: 0x5b4c41, plant: 0x3d5a35,
           hemi: [0xffd9b0, 0x2a1a10, .45], sun: [0xffc88e, 1.25], fill: [0xff9f5a, .22], exp: 1.1, wash: .28, screen: .66, neon: true }
};
const MODES = ["dark", "warm", "system"], sysDark = matchMedia("(prefers-color-scheme: dark)");
let MODE = "system";
try { const s = localStorage.getItem("vf-theme"); if (MODES.includes(s)) MODE = s; } catch (e) {}
const resolveTheme = () => MODE === "system" ? (sysDark.matches ? "dark" : "light") : MODE;
let TH = resolveTheme();

const C = { accent: 0xffc71a, red: 0xff3b30, amber: 0xff9f0a };
const DX = j => -16.5 + j * 5.5;        // 第 j 个工位的中心
const BELTZ = 1.3, BELTY = .5;         // 胶片传送带
const WALLZ = -6.4;                    // 后墙正面
let R, S, CAM, CTL, COMP, TSH, TSV, clock, HEMI, SUN, FILL, TM, DARK;
let sel = null, stSel = null, from = null, fly = null, t0 = 0, dragging = false, lastDrag = 0;
const objs = {};                      // id -> { g, reel, paint[], kind, home }
const anim = [];                      // 每帧要动的东西
const workLight = [], zoneMats = [], washes = [], screenMats = [];

/* ---------- 小工具 ---------- */
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const M = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: .82, metalness: 0 }, o));
const WHITE = () => TM.model;
const GLOW = (c = 0xfff1d6) => new THREE.MeshStandardMaterial({ color: 0x2a2c31, emissive: c, emissiveIntensity: .15, roughness: .4 });
function makeMats() {
  TM = { wall: M(0), panel: M(0, { roughness: 1 }), model: M(0), soft: M(0), belt: M(0), plant: M(0, { roughness: .9 }), dark: M(0) };
  DARK = TM.dark;
}
function box(w, h, d, mat, x = 0, y = 0, z = 0, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y + h / 2, z);
  m.castShadow = m.receiveShadow = true; if (parent) parent.add(m); return m;
}
function cyl(r, h, mat, x, y, z, parent, seg = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat); m.position.set(x, y + h / 2, z);
  m.castShadow = m.receiveShadow = true; if (parent) parent.add(m); return m;
}
function flat(w, d, mat, x, y, z, parent = S) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; parent.add(m); return m; }
function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return [c, c.getContext("2d")]; }
function wallPlane(w, h, mat, x, y, z = WALLZ + .02) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y, z); S.add(m); return m; }

/* ---------- 剪辑室 ---------- */
let beltTex, floorCv, floorTex, neonCv, neonTex;
function drawFloor(T) { const x = floorCv.getContext("2d"); x.fillStyle = T.floorA; x.fillRect(0, 0, 256, 256); x.fillStyle = T.floorB; x.fillRect(0, 0, 256, 3); x.fillRect(0, 0, 3, 256); }
function drawNeon(T) {
  const x = neonCv.getContext("2d"); x.clearRect(0, 0, 1024, 256);
  x.font = '700 176px "Barlow Condensed", sans-serif'; x.textAlign = "center"; x.textBaseline = "middle";
  if (T.neon) { x.shadowColor = "#ffc71a"; x.shadowBlur = 34; x.fillStyle = "#ffe08a"; x.fillText("VideoFlows", 512, 124); x.shadowBlur = 8; x.fillText("VideoFlows", 512, 124); }
  else { x.shadowBlur = 0; x.fillStyle = "#1d2026"; x.fillText("VideoFlows", 512, 124); x.fillStyle = "#ffc71a"; x.fillRect(312, 214, 400, 12); }
}
function buildWorld() {
  // 地面铺满地砖；后墙做得又高又宽，顶出画面，背景就是一整面剪辑室的墙
  [floorCv] = canvas(256, 256);
  floorTex = new THREE.CanvasTexture(floorCv); floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(60, 34); floorTex.anisotropy = 8;
  flat(120, 68, new THREE.MeshStandardMaterial({ map: floorTex, roughness: .9 }), 0, 0, 27);
  box(140, 40, .3, TM.wall, 0, 0, WALLZ - .15, S);
  backWall();
  // 每个工位一块地垫：选中时这块会亮
  for (let j = 0; j < 7; j++) { zoneMats[j] = M(0, { roughness: 1 }); flat(5, 6.2, zoneMats[j], DX(j), .01, -2.7); }
  // 胶片传送带：两边是齿孔，带子一直往右走
  const [cv, cx] = canvas(256, 128);
  cx.fillStyle = "#17181b"; cx.fillRect(0, 0, 256, 128); cx.fillStyle = "#3a3d44"; cx.fillRect(0, 24, 256, 80);
  cx.fillStyle = "#e8eaee"; for (let i = 0; i < 4; i++) { cx.fillRect(i * 64 + 16, 6, 30, 12); cx.fillRect(i * 64 + 16, 110, 30, 12); }
  cx.fillStyle = "#22242a"; for (let i = 0; i < 2; i++) cx.fillRect(i * 128 + 8, 30, 112, 68);
  beltTex = new THREE.CanvasTexture(cv); beltTex.wrapS = THREE.RepeatWrapping; beltTex.repeat.set(22, 1); beltTex.anisotropy = 8;
  box(44, BELTY - .02, 1.9, TM.belt, 0, 0, BELTZ, S);
  flat(44, 1.7, new THREE.MeshStandardMaterial({ map: beltTex, roughness: .6 }), 0, BELTY + .001, BELTZ);
  for (const x of [-22, 22]) { const r = cyl(.27, 1.9, WHITE(), x, BELTY - .27, BELTZ, S); r.rotation.x = Math.PI / 2; r.position.y = BELTY - .27; }
  anim.push((t, dt) => { if (!REDUCED) beltTex.offset.x -= dt * .25; });
  plant(-23.6, -4.9); plant(23.6, -4.9);
}

/* 后墙：片架、海报、监视器墙、时码钟、扩散板，一排射灯洗墙。都在工位后面，不挡胶片 */
function backWall() {
  const Z = WALLZ;
  box(80, .1, .12, DARK, 0, 9.7, Z + .55, S);   // 灯轨
  const [wc, wx] = canvas(256, 256); const gr = wx.createRadialGradient(128, 60, 4, 128, 110, 130);
  gr.addColorStop(0, "rgba(255,240,215,1)"); gr.addColorStop(.45, "rgba(255,240,215,.35)"); gr.addColorStop(1, "rgba(255,240,215,0)"); wx.fillStyle = gr; wx.fillRect(0, 0, 256, 256);
  const washT = new THREE.CanvasTexture(wc);
  for (const x of [-35, -27, -19.5, -10.5, -3.6, 3.6, 10.2, 18.5, 27, 35]) {
    const h = cyl(.17, .38, DARK, x, 9.3, Z + .7, S, 10); h.rotation.x = -.5;
    washes.push(wallPlane(9, 9, new THREE.MeshBasicMaterial({ map: washT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: .2 }), x, 5.6, Z + .01));
  }
  filmShelf(-19.5); posters(-10.5); monitorWall(0); timecode(10.2); diffuser(18.5);
  // 两头再挂几块吸音板，画面边上不至于空
  for (let x = -58; x <= 58; x += 1.25) { if (Math.abs(x) < 23) continue; for (let y = 0; y < 5; y++) if (rnd() < .38) box(1.1, 1.1, .08, TM.panel, x, 2.6 + y * 1.25, Z + .05, S); }
}
function filmShelf(cx) {
  const g = new THREE.Group(); g.position.set(cx, 0, WALLZ + .4); S.add(g);
  const W = 7, H0 = 2.9, rows = 4, rh = 1.4;
  const SP = [TM.model, TM.soft, M(0x8fa0b8), M(C.accent), M(0xb9614d), TM.model];
  for (const a of [-1, 1]) box(.12, rows * rh + .1, .7, DARK, a * W / 2, H0, 0, g);
  for (let r = 0; r <= rows; r++) box(W + .1, .08, .7, DARK, 0, H0 + r * rh, 0, g);
  for (let r = 0; r < rows; r++) {
    const y = H0 + r * rh + .08; let x = -W / 2 + .25;
    while (x < W / 2 - .5) {
      const k = rnd();
      if (k < .14 && x < W / 2 - 1.2) {        // 正面朝外摆一盘
        const d = cyl(.48, .07, WHITE(), x + .5, 0, 0, g, 28); d.rotation.x = Math.PI / 2; d.position.set(x + .5, y + .5, .05);
        const hb = cyl(.12, .1, DARK, x + .5, 0, 0, g, 12); hb.rotation.x = Math.PI / 2; hb.position.set(x + .5, y + .5, .1); x += 1.1;
      } else if (k < .22) x += .4;
      else { const n = 2 + Math.floor(rnd() * 6), m = SP[Math.floor(rnd() * SP.length)], hh = .72 + rnd() * .42; for (let i = 0; i < n && x < W / 2 - .3; i++) { box(.11, hh, .58, m, x, y, 0, g); x += .13; } x += .1; }
    }
  }
}
function posters(cx) {
  const P = [{ bg: "#2b3a55", fg: "#ffc71a", t: "选题", s: "第 01 期", f: "o" }, { bg: "#c9694f", fg: "#f6efe4", t: "剪辑", s: "第 02 期", f: "=" }, { bg: "#e9e4d8", fg: "#1d1f24", t: "复盘", s: "第 03 期", f: "^" }];
  P.forEach((p, i) => {
    const [c, x] = canvas(256, 352); x.fillStyle = p.bg; x.fillRect(0, 0, 256, 352); x.fillStyle = p.fg; x.strokeStyle = p.fg;
    if (p.f === "o") { x.beginPath(); x.arc(128, 140, 78, 0, 7); x.fill(); x.fillStyle = p.bg; x.beginPath(); x.arc(150, 120, 30, 0, 7); x.fill(); x.fillStyle = p.fg; }
    if (p.f === "=") for (let k = 0; k < 6; k++) x.fillRect(28, 60 + k * 26, 200 - k * 22, 12);
    if (p.f === "^") { x.beginPath(); x.moveTo(128, 50); x.lineTo(220, 220); x.lineTo(36, 220); x.closePath(); x.lineWidth = 14; x.stroke(); }
    x.font = '900 46px "Noto Sans SC", sans-serif'; x.fillText(p.t, 26, 290); x.font = '700 22px "Barlow Condensed", sans-serif'; x.fillText(p.s, 28, 328);
    const px = cx + (i - 1) * 2.9;
    box(2.5, 3.4, .08, DARK, px, 4.0, WALLZ + .05, S);
    wallPlane(2.3, 3.16, new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(c), roughness: .7 }), px, 5.7, WALLZ + .1);
  });
}
function screenTex(kind) {
  const [c, x] = canvas(256, 144); x.fillStyle = "#121418"; x.fillRect(0, 0, 256, 144);
  const T = Math.PI * 2 / 256;
  if (kind === "bars") { ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"].forEach((cl, i) => { x.fillStyle = cl; x.fillRect(i * 256 / 7, 0, 256 / 7 + 1, 104); }); x.fillStyle = "#e8e8e8"; x.fillRect(36, 112, 44, 26); }
  if (kind === "wave") { x.fillStyle = "#4ad66d"; for (const cy of [44, 100]) for (let i = 0; i < 256; i += 2) { const h = 3 + 24 * Math.abs(Math.sin(i * T * 5) * Math.sin(i * T * 3 + cy)); x.fillRect(i, cy - h, 1.5, h * 2); } }
  if (kind === "tl") { const cols = ["#eceef2", "#ffc71a", "#8fa0b8", "#cfd4dc"]; for (let r = 0; r < 4; r++) { let xx = 0; while (xx < 256) { const w = Math.min(256 - xx, 22 + Math.floor(rnd() * 46)); x.fillStyle = cols[(r + Math.floor(xx / 40)) % 4]; x.fillRect(xx + 2, 18 + r * 28, w - 4, 20); xx += w; } } }
  if (kind === "scope") { x.strokeStyle = "#3f6f4c"; x.lineWidth = 2; for (const r of [24, 48, 64]) { x.beginPath(); x.arc(128, 72, r, 0, 7); x.stroke(); } x.beginPath(); x.moveTo(64, 72); x.lineTo(192, 72); x.moveTo(128, 8); x.lineTo(128, 136); x.stroke(); x.fillStyle = "rgba(120,240,150,.5)"; for (let i = 0; i < 260; i++) { const a = rnd() * 7, r = rnd() * rnd() * 40; x.fillRect(128 + Math.cos(a) * r + 6, 72 + Math.sin(a) * r * .8 - 8, 2, 2); } }
  if (kind === "grid") { for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) { x.fillStyle = ["#2b3a55", "#c9694f", "#3d5a35", "#8fa0b8", "#4a4e57", "#b8962e"][(r * 4 + k) % 6]; x.fillRect(8 + k * 61, 8 + r * 44, 56, 38); } }
  if (kind === "meter") { for (let i = 0; i < 10; i++) { const h = 20 + rnd() * 100; for (let y = 0; y < h; y += 6) { x.fillStyle = y > 96 ? "#ff3b30" : y > 74 ? "#ffc71a" : "#4ad66d"; x.fillRect(16 + i * 23, 136 - y, 16, 4); } } }
  if (kind.startsWith("frame")) {
    const pal = { frame1: ["#9fc2d8", "#e8d6b0", "#3a4a5c"], frame2: ["#f0b27a", "#6b4f3a", "#22252b"], frame3: ["#c9d6c2", "#7f9a75", "#2f3b2c"], frame4: ["#2c3550", "#ffc71a", "#e9e4d8"] }[kind];
    const g = x.createLinearGradient(0, 0, 0, 144); g.addColorStop(0, pal[0]); g.addColorStop(1, pal[1]); x.fillStyle = g; x.fillRect(0, 0, 256, 144);
    x.fillStyle = pal[2]; x.beginPath(); x.arc(150, 62, 20, 0, 7); x.fill(); x.beginPath(); x.ellipse(150, 140, 46, 56, 0, Math.PI, 0); x.fill();
    x.fillStyle = "rgba(0,0,0,.35)"; x.fillRect(0, 0, 256, 10); x.fillRect(0, 134, 256, 10);
  }
  if (kind === "code") { for (let i = 0; i < 9; i++) { x.fillStyle = ["#8fa0b8", "#ffc71a", "#cfd4dc", "#4ad66d"][i % 4]; x.fillRect(14 + (i % 3) * 14, 12 + i * 14, 40 + rnd() * 140, 6); } }
  const tx = new THREE.CanvasTexture(c); tx.anisotropy = 4; return tx;
}
function monitorWall(cx) {
  const cols = 5, rows = 3, w = 1.9, h = 1.07, gp = .12, W = cols * w + (cols - 1) * gp, H = rows * h + (rows - 1) * gp, y0 = 3.5;
  box(W + .4, H + .4, .22, DARK, cx, y0 - .2, WALLZ + .12, S);
  const K = ["frame1", "grid", "bars", "frame2", "scope", "wave", "frame4", "tl", "frame3", "meter", "code", "tl", "wave", "grid", "frame1"];
  K.forEach((k, i) => {
    const c = i % cols, r = rows - 1 - Math.floor(i / cols), tx = screenTex(k);
    const m = new THREE.MeshBasicMaterial({ map: tx }); screenMats.push(m);
    wallPlane(w, h, m, cx - W / 2 + w / 2 + c * (w + gp), y0 + h / 2 + r * (h + gp), WALLZ + .25);
    if (k === "wave" || k === "tl") { tx.wrapS = THREE.RepeatWrapping; anim.push((t, dt) => { if (!REDUCED) tx.offset.x += dt * (k === "tl" ? .04 : .09); }); }
  });
  // 监视器墙上面挂 VideoFlows 招牌
  [neonCv] = canvas(1024, 256); neonTex = new THREE.CanvasTexture(neonCv);
  wallPlane(7.2, 1.8, new THREE.MeshBasicMaterial({ map: neonTex, transparent: true, depthWrite: false }), cx, y0 + H + 1.25, WALLZ + .2);
}
function timecode(cx) {
  box(4.7, 1.25, .22, DARK, cx, 6.1, WALLZ + .1, S);
  const [c, x] = canvas(512, 128), tx = new THREE.CanvasTexture(c), m = new THREE.MeshBasicMaterial({ map: tx }); screenMats.push(m);
  wallPlane(4.5, 1.1, m, cx, 6.725, WALLZ + .23);
  let last = -1;
  anim.push(t => {
    const f = REDUCED ? 0 : Math.floor(t * 25); if (f === last) return; last = f;
    const s = 4475 + Math.floor(f / 25), txt = `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(f % 25)}`;
    x.fillStyle = "#120807"; x.fillRect(0, 0, 512, 128); x.font = '700 100px "Barlow Condensed", sans-serif'; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillStyle = "#3a1412"; x.fillText("88:88:88:88", 256, 66); x.shadowColor = "#ff3b30"; x.shadowBlur = 16; x.fillStyle = "#ff5040"; x.fillText(txt, 256, 66); x.shadowBlur = 0;
    tx.needsUpdate = true;
  });
  // 下面一块「录音中」灯箱
  box(3.6, 1.05, .22, DARK, cx, 4.2, WALLZ + .1, S);
  const [c2, x2] = canvas(512, 150); x2.fillStyle = "#2a0c0b"; x2.fillRect(0, 0, 512, 150); x2.font = '900 72px "Noto Sans SC", sans-serif'; x2.textAlign = "center"; x2.textBaseline = "middle";
  x2.shadowColor = "#ff3b30"; x2.shadowBlur = 22; x2.fillStyle = "#ff6a5c"; x2.fillText("录音中 请安静", 256, 78);
  const m2 = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c2) }); screenMats.push(m2);
  wallPlane(3.4, .9, m2, cx, 4.725, WALLZ + .23);
}
function diffuser(cx) {
  const n = 12, rws = 9, s = .44, W = n * s, H = rws * s, y0 = 3.2;
  box(W + .3, H + .3, .12, DARK, cx, y0 - .15, WALLZ + .06, S);
  for (let i = 0; i < n; i++) for (let r = 0; r < rws; r++) { const d = .06 + ((i * 7 + r * 3) % 9) / 9 * .5; box(s - .04, s - .04, d, i % 2 === r % 2 ? TM.panel : TM.model, cx - W / 2 + s / 2 + i * s, y0 + r * s, WALLZ + .12 + d / 2, S); }
}
function plant(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z); S.add(g);
  cyl(.28, .5, WHITE(), 0, 0, 0, g, 14);
  for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(.3 + rnd() * .12, 0), TM.plant); b.position.set((rnd() - .5) * .4, .7 + i * .2, (rnd() - .5) * .4); b.castShadow = true; g.add(b); }
}
function desk(g, w, x, z, d = 1.2) { box(w, .08, d, WHITE(), x, .74, z, g); for (const a of [-1, 1]) box(.08, .74, d - .1, WHITE(), x + a * (w / 2 - .06), 0, z, g); }
function chair(g, x, z, ry = 0) {
  const c = new THREE.Group(); c.position.set(x, 0, z); c.rotation.y = ry; g.add(c);
  cyl(.05, .42, DARK, 0, 0, 0, c, 8); box(.55, .08, .55, DARK, 0, .42, 0, c); box(.55, .6, .08, DARK, 0, .5, .26, c);
}

/* 七个工位：一看就知道在干嘛 */
function station(j) {
  const g = new THREE.Group(); g.position.set(DX(j), 0, -2.9); S.add(g);
  const W = WHITE();
  let light;
  if (j === 0) {           // 选题：白板上贴满便利贴
    for (const x of [-1.5, 1.5]) box(.07, 2.6, .07, W, x, 0, -.6, g);
    box(3.2, 1.7, .08, W, 0, .85, -.56, g);
    const note = [W, M(C.accent), M(0xb9c2d0)];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) if (rnd() < .8) { const n = box(.42, .42, .03, note[(r * 5 + c) % 3 === 1 ? 1 : (r + c) % 4 === 0 ? 2 : 0], -1.2 + c * .6, 1.05 + r * .5, -.5, g); n.rotation.z = (rnd() - .5) * .2; }
    light = GLOW(0xffe9b0); box(3.2, .07, .12, light, 0, 2.58, -.5, g);
    cyl(.55, .05, W, 0, .7, 1.1, g, 24); cyl(.06, .7, W, 0, 0, 1.1, g, 8);
    for (const a of [0, 2.2, 4.2]) cyl(.2, .45, DARK, Math.cos(a) * .95, 0, 1.1 + Math.sin(a) * .95, g, 12);
  } else if (j === 1) {    // 文案：书桌、笔记本、台灯、一摞稿纸
    desk(g, 3, 0, 0);
    box(.9, .04, .6, W, -.3, .82, .05, g);
    light = GLOW(0xd8e6ff); const scr = box(.9, .58, .03, light, -.3, .82, -.25, g); scr.rotation.x = -.25;
    for (let i = 0; i < 7; i++) box(.6, .03, .8, W, .9, .82 + i * .035, .1 + (i % 2) * .03, g).rotation.y = (rnd() - .5) * .15;
    cyl(.15, .04, W, 1.2, .82, -.35, g, 12); const arm = cyl(.025, .7, W, 1.2, .86, -.35, g, 6); arm.rotation.z = .3;
    const head = new THREE.Mesh(new THREE.ConeGeometry(.16, .22, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0xeceef2, emissive: 0xfff0c8, emissiveIntensity: .8, side: THREE.DoubleSide }));
    head.position.set(1.0, 1.55, -.3); head.rotation.z = .5; g.add(head);
    chair(g, -.3, 1.1);
  } else if (j === 2) {    // 录制：背景纸、凳子、三脚架相机、环形灯
    box(3.6, 2.6, .06, M(0xd9dce2), 0, 0, -1.6, g); flat(3.6, 1.6, M(0xd9dce2), 0, .015, -.8, g);
    cyl(.22, .55, W, 0, 0, -.6, g, 14);
    const tri = new THREE.Group(); tri.position.set(-.7, 0, 1.2); g.add(tri);
    for (let i = 0; i < 3; i++) { const l = cyl(.025, 1.35, DARK, 0, 0, 0, tri, 6); l.position.set(Math.cos(i * 2.1) * .22, .62, Math.sin(i * 2.1) * .22); l.rotation.set(Math.sin(i * 2.1) * .3, 0, -Math.cos(i * 2.1) * .3); }
    box(.5, .36, .6, DARK, 0, 1.3, 0, tri); const lens = cyl(.14, .3, M(0x3a4a5c, { roughness: .3 }), 0, 1.33, -.4, tri, 16); lens.rotation.x = Math.PI / 2; lens.position.y = 1.48;
    const rec = new THREE.Mesh(new THREE.SphereGeometry(.05, 10, 8), new THREE.MeshBasicMaterial({ color: C.red })); rec.position.set(.18, 1.72, .1); tri.add(rec);
    anim.push(t => rec.visible = Math.sin(t * 5) > 0);
    light = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e0, emissiveIntensity: .15 });
    cyl(.025, 1.5, DARK, .9, 0, 1.0, g, 6); const ring = new THREE.Mesh(new THREE.TorusGeometry(.42, .07, 12, 40), light); ring.position.set(.9, 1.85, 1.0); g.add(ring);
  } else if (j === 3) {    // 剪辑：双屏 + 时间线，播放头在走
    desk(g, 3.4, 0, 0);
    const tex = screenTex("tl");
    light = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: .15 });
    for (const [x, ry] of [[-.75, .15], [.75, -.15]]) {
      const mon = new THREE.Group(); mon.position.set(x, .82, -.3); mon.rotation.y = ry; g.add(mon);
      box(1.4, .85, .06, DARK, 0, .3, 0, mon); const s = new THREE.Mesh(new THREE.PlaneGeometry(1.3, .75), light); s.position.set(0, .725, .035); mon.add(s);
      cyl(.04, .3, DARK, 0, 0, -.02, mon, 6);
      const ph = new THREE.Mesh(new THREE.PlaneGeometry(.025, .75), new THREE.MeshBasicMaterial({ color: C.red })); ph.position.set(0, .725, .04); mon.add(ph);
      anim.push(t => ph.position.x = -.62 + ((t * .12 + (x > 0 ? .4 : 0)) % 1) * 1.24);
    }
    box(1, .03, .32, DARK, 0, .82, .3, g);
    for (const x of [-1.5, 1.5]) box(.32, .5, .32, DARK, x, .82, -.35, g);
    chair(g, 0, 1.1);
  } else if (j === 4) {    // 样片：投影机打到幕布上
    for (const x of [-1.4, 1.4]) box(.06, 2.5, .06, W, x, 0, -1.3, g);
    light = new THREE.MeshStandardMaterial({ color: 0xf2f3f6, emissive: 0xffffff, emissiveIntensity: .15 });
    box(2.9, 1.65, .05, light, 0, .8, -1.25, g);
    const play = new THREE.Mesh(new THREE.CircleGeometry(.22, 3), new THREE.MeshBasicMaterial({ color: C.accent })); play.position.set(0, 1.62, -1.22); g.add(play);
    box(.7, .65, .7, W, 0, 0, 1.3, g); box(.5, .22, .42, DARK, 0, .65, 1.3, g);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.25, 2.55, 4, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff6dc, transparent: true, opacity: .08, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    cone.rotation.x = Math.PI / 2; cone.rotation.y = Math.PI / 4; cone.position.set(0, 1.25, 0); cone.scale.set(1, 1, .62); g.add(cone);
    for (const x of [-1, 1]) { const b = new THREE.Mesh(new THREE.SphereGeometry(.45, 16, 12), TM.soft); b.scale.set(1, .6, 1); b.position.set(x * 1.2, .27, .5); b.castShadow = true; g.add(b); }
  } else if (j === 5) {    // 发布：大手机，上传进度条在涨
    const ph = new THREE.Group(); ph.position.set(-.4, 0, -.6); ph.rotation.y = .12; g.add(ph);
    box(1.4, 2.7, .16, DARK, 0, .1, 0, ph); box(.9, .12, .5, W, 0, 0, .1, ph);
    light = new THREE.MeshStandardMaterial({ color: 0x2a2c31, emissive: 0xdfe8ff, emissiveIntensity: .15 });
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.24, 2.45), light); scr.position.set(0, 1.45, .085); ph.add(scr);
    box(.95, .1, .02, M(0x55595f), 0, 1.0, .09, ph);
    const bar = box(.95, .1, .025, new THREE.MeshBasicMaterial({ color: C.accent }), 0, 1.0, .095, ph);
    anim.push(t => { const k = (t * .18) % 1; bar.scale.x = Math.max(.01, k); bar.position.x = -.475 + .475 * k; });
    const up = new THREE.Mesh(new THREE.ConeGeometry(.22, .3, 3), new THREE.MeshBasicMaterial({ color: 0xeceef2 })); up.position.set(0, 1.75, .1); ph.add(up);
    box(.9, 1.9, .9, DARK, 1.3, 0, -.9, g);
    for (let i = 0; i < 6; i++) { const led = new THREE.Mesh(new THREE.BoxGeometry(.5, .05, .02), new THREE.MeshBasicMaterial({ color: i % 2 ? 0x4ad66d : C.accent })); led.position.set(1.3, .3 + i * .27, -.44); g.add(led); const ph2 = rnd() * 6; anim.push(t => led.visible = Math.sin(t * 3 + ph2 + i) > -.3); }
  } else {                 // 数据：大屏，柱子在涨
    light = new THREE.MeshStandardMaterial({ color: 0x1f2329, emissive: 0x6d87b5, emissiveIntensity: .15 });
    box(4.2, 2.5, .1, light, 0, 1.3, -2.95, g);
    for (let i = 0; i < 7; i++) {
      const b = box(.36, 1, .06, new THREE.MeshBasicMaterial({ color: i === 4 ? C.accent : 0xeceef2 }), -1.5 + i * .5, 1.55, -2.88, g);
      const base = .3 + rnd() * .7, ph = rnd() * 6; anim.push(t => { const h = base * (.75 + .25 * Math.sin(t * .9 + ph)) * 1.7; b.scale.y = h; b.position.y = 1.55 + h / 2; });
    }
    desk(g, 2.6, 0, -.6); box(.8, .04, .55, W, -.5, .82, -.6, g); chair(g, -.3, .4);
  }
  workLight[j] = light;
}

/* 胶片盘：一盘就是一条视频，选中时两片盘面变黄，agent 在做就转 */
const REEL_Y = BELTY + .24 + .81;
function reel(v, x) {
  const g = new THREE.Group(); g.rotation.y = .12; S.add(g);
  box(1, .1, .9, DARK, 0, BELTY, 0, g);
  for (const zz of [-.25, .25]) box(.5, .14, .12, DARK, 0, BELTY + .1, zz, g);
  const r = new THREE.Group(); r.position.y = REEL_Y; r.scale.setScalar(1.3); g.add(r);
  const fl = [M(0), M(0)];
  [-.15, .15].forEach((z, i) => { const d = new THREE.Mesh(new THREE.CylinderGeometry(.62, .62, .05, 40), fl[i]); d.rotation.x = Math.PI / 2; d.position.z = z; d.castShadow = true; r.add(d); });
  const film = new THREE.Mesh(new THREE.CylinderGeometry(.46, .46, .25, 36), M(0x1b1c20, { roughness: .4 })); film.rotation.x = Math.PI / 2; r.add(film);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(.1, .1, .4, 12), DARK); hub.rotation.x = Math.PI / 2; r.add(hub);
  for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2, h = new THREE.Mesh(new THREE.CylinderGeometry(.11, .11, .06, 14), DARK); h.rotation.x = Math.PI / 2; h.position.set(Math.cos(a) * .34, Math.sin(a) * .34, .16); r.add(h); }
  const tail = new THREE.Mesh(new THREE.PlaneGeometry(.22, .7), M(0x1b1c20, { side: THREE.DoubleSide })); tail.position.set(.55, REEL_Y - .6, .0); tail.rotation.z = .5; g.add(tail);
  const o = { g, reel: r, paint: fl, kind: "reel", home: new THREE.Vector3(x, 0, BELTZ) };
  addSignals(v, o, g);
  if (flowing(v)) anim.push((t, dt) => { if (!REDUCED) r.rotation.z -= dt * 1.6; });
  objs[v.id] = o;
}
/* 红灯 = 等你，黄灯 = 卡住；托盘边一根小灯杆，带子上一圈光 */
function addSignals(v, o, g) {
  if (!v.ask && !v.stuck) return;
  const c = v.ask ? C.red : C.amber;
  cyl(.025, 1.75, M(0x55595f), .62, BELTY + .1, -.4, g, 6);
  const b = new THREE.Mesh(new THREE.SphereGeometry(.15, 16, 12), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 2 }));
  b.position.set(.62, BELTY + 1.95, -.4); g.add(b);
  const pl = new THREE.PointLight(c, 1.4, 4, 2); b.add(pl);
  const ring = new THREE.Mesh(new THREE.RingGeometry(.78, .92, 56), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: .45, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = BELTY + .02; g.add(ring);
  const ph = rnd() * 6;
  anim.push(t => { const k = .5 + .5 * Math.sin(t * 4 + ph); b.material.emissiveIntensity = .8 + 2 * k; pl.intensity = .4 + 1.4 * k; const s = 1 + ((t * .8 + ph) % 1) * .45; ring.scale.set(s, s, s); ring.material.opacity = .65 * (1 - ((t * .8 + ph) % 1)); });
}
/* 选中的那盘：头顶一束追光 */
let spot;
function buildPin() { spot = new THREE.SpotLight(0xfff2cc, 0, 16, .3, .55, 1.4); S.add(spot); S.add(spot.target); }

/* ---------- 摆位 ---------- */
const stacks = {};                    // 站 -> { g, home, list, lab, top }
function layout() {
  // 每站带子上放几盘、谁排队，都照 index 的 stations（等你 > 卡住 > 计划早 > 编号小）
  STATIONS.forEach(({ on, q }, s) => {
    on.forEach((v, k) => { reel(v, DX(s) + (k - (on.length - 1) / 2) * 1.75); objs[v.id].lift = (on.length - 1 - k) * 1.1 + (s % 2 ? 0 : 1.2); });
    if (q.length) stack(s, q);
  });
  // 有 agent 在做的工位，屏幕和灯亮；等你的工位亮一半
  V.forEach(v => { if (flowing(v)) workLight[v.s].emissiveIntensity = .95; });
  V.forEach(v => { if (!flowing(v)) workLight[v.s].emissiveIntensity = Math.max(workLight[v.s].emissiveIntensity, .4); });
}
function stack(s, list) {
  const g = new THREE.Group(), home = new THREE.Vector3(DX(s) + 2.3, 0, BELTZ + 1.9); g.position.copy(home); S.add(g);
  box(1.3, .32, 1.3, DARK, 0, 0, 0, g); for (const [x, z] of [[-.5, -.5], [.5, -.5], [-.5, .5], [.5, .5]]) cyl(.07, .1, DARK, x, -.02, z, g, 8);
  const can = M(0), paint = [can], tab = M(C.accent);
  list.forEach((v, i) => { if (i > 7) return; const c = cyl(.5, .14, can, (rnd() - .5) * .12, .32 + i * .16, (rnd() - .5) * .12, g, 28); box(.36, .02, .1, tab, c.position.x, .32 + i * .16 + .14, c.position.z + .22, g); });
  list.forEach((v, i) => { v.queued = true; v.qn = i + 1; objs[v.id] = { g, reel: null, paint, kind: "queued", home, lift: 0 }; });
  stacks[s] = { g, home, list, top: .32 + Math.min(list.length, 8) * .16 + .5 };
}

/* ---------- 开场：胶片盘从左边顺着带子滚进来 ---------- */
function introPose(v, o, t) {
  const i = V.indexOf(v), st = .25 + i * .18, k = REDUCED || QUICK ? 1 : Math.min(1, Math.max(0, (t - st) / 2.4));
  if (o.kind === "queued") return k;
  const e = 1 - Math.pow(1 - k, 3), h = o.home, sx = -30;
  o.g.position.set(sx + (h.x - sx) * e, 0, h.z);
  if (k < 1) o.reel.rotation.z = -(h.x - sx) * e / .62;
  return k;
}

/* ---------- 主题 ---------- */
function recolor() {
  const T = THEMES[TH];
  V.forEach(v => objs[v.id].paint.forEach(m => { m.color.setHex(T.model); m.emissive.setHex(0); }));
  if (sel != null) objs[sel].paint.forEach(m => { m.color.setHex(C.accent); m.emissive.setHex(0x3a2a00); });
}
function applyTheme(mode) {
  if (mode) MODE = MODES.includes(mode) ? mode : "system";
  TH = resolveTheme(); const T = THEMES[TH];
  document.getElementById("yard").dataset.scene = TH;
  if (MODE === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = TH === "light" ? "light" : "dark";
  document.querySelectorAll("#theme button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.th === MODE)));
  try { localStorage.setItem("vf-theme", MODE); } catch (e) {}
  if (!S) return;
  ["wall", "panel", "model", "soft", "belt", "plant", "dark"].forEach(k => TM[k].color.setHex(T[k]));
  zoneMats.forEach(m => m.color.setHex(T.zone));
  drawFloor(T); floorTex.needsUpdate = true; drawNeon(T); neonTex.needsUpdate = true;
  washes.forEach(w => w.material.opacity = T.wash);
  screenMats.forEach(m => m.color.setScalar(T.screen));
  S.background.setHex(T.bg); S.fog.color.setHex(T.bg);
  HEMI.color.setHex(T.hemi[0]); HEMI.groundColor.setHex(T.hemi[1]); HEMI.intensity = T.hemi[2];
  SUN.color.setHex(T.sun[0]); SUN.intensity = T.sun[1]; FILL.color.setHex(T.fill[0]); FILL.intensity = T.fill[1];
  R.toneMappingExposure = T.exp;
  recolor();
}

/* ---------- 选中：镜头不动，只换高亮和左边面板 ---------- */
function curStage() { return stSel != null ? stSel : sel != null ? V.find(v => v.id === sel).s : -1; }
function refresh() {
  recolor();
  const s = curStage();
  zoneMats.forEach((m, j) => { m.emissive.setHex(j === s ? 0x6b5000 : 0); m.emissiveIntensity = .4; });
  stgs.forEach((d, j) => d.classList.toggle("on", j === s));
  if (sel != null) { const o = objs[sel]; spot.position.set(o.home.x, 9, o.home.z + 3); spot.target.position.set(o.home.x, o.kind === "queued" ? 1 : REEL_Y, o.home.z); spot.intensity = 3; }
  else spot.intensity = 0;
  renderPanel();
}
function select(id) {
  from = id != null ? (stSel != null ? stSel : from) : null;
  sel = id; stSel = null; refresh();
}
function openStation(s) { sel = null; stSel = s; from = null; refresh(); }
function goBack() { if (sel != null && from != null) openStation(from); else select(null); }

function stationsHTML(v) {
  return `<div class="stations">${STAGES.map((n, j) => `<div class="${isSkip(v, j) ? "skip" : j < v.s ? "done" : j === v.s ? "now" : ""}">${n}</div>`).join("")}</div>`;
}
function renderPanel() {
  const p = document.getElementById("panel");
  if (stSel != null) {
    const list = [...STATIONS[stSel].on, ...STATIONS[stSel].q], q = STATIONS[stSel].q.length;
    const sub = !list.length ? "" : q ? `带子上放 ${list.length - q} 条，另外 ${q} 条叠在旁边排队。等你的和卡住的先上带，前面走一条就补一条。` : `这一站现在有 ${list.length} 条。`;
    p.innerHTML = `<div class="col"><div class="kick"><b>${pad(stSel + 1)}</b><s></s>${STAGES[stSel]}站</div>
      <h2>${list.length ? `${list.length} 条停在${STAGES[stSel]}` : `${STAGES[stSel]}站是空的`}</h2>
      ${sub ? `<p class="sub">${sub}</p>` : `<p class="empty">现在没有视频停在这一站。</p>`}
      <div class="acts"><button type="button" class="back" data-back>← 回总览</button></div></div>
      <div class="col">${list.length ? `<ol class="slist">${list.map(v => `<li><button type="button" data-id="${v.id}" class="${v.ask ? "r" : v.queued ? "q" : ""}"><i>${pad(v.id)}</i><span>${esc(v.t)}</span><em>${v.ask ? "等你" : v.stuck ? `卡 ${v.stuck} 天` : v.queued ? `排队 ${v.qn}` : "在做"}</em></button></li>`).join("")}</ol>` : ""}</div>`;
    return;
  }
  if (sel == null) {
    const np = parts(NOW), upd = `数据 ${fromNow(IDX.generated_at)} 更新`;
    if (!V.length && !ASKS.length) {
      p.innerHTML = `<div class="col"><div class="kick">${np.m}/${np.d} ${WD[np.wd] || ""}<s></s>总览</div>
        <h2>流水线还是空的</h2>
        <p class="sub">还没有定下要拍的视频。选题池里定了一条，它就会出现在选题站。灵感可以在选题池里直接记，agent 改完推到仓库后这里自己更新。</p></div>
        <div class="col"><p class="sub">${CARDS.length ? `选题池里现在有 ${CARDS.length} 张卡。<a class="more" href="#pool">去选题池</a>` : "仓库里还没有卡。"}</p>
        ${DEMO ? "" : `<p class="sub"><a class="more" href="?demo">先看一份示例数据</a></p>`}
        <div class="legend"><span>${upd}</span></div></div>`;
      return;
    }
    const waits = ASKS.map(({ a, v }) => v
      ? `<li><button type="button" data-id="${v.id}"><i>${pad(v.id)}</i><b>${esc(a.question)}</b><span>${esc(v.sh)}，停在「${STAGES[v.s]}」${v.must && v.deadline ? `，${short(v.deadline)} 截止` : ""}</span></button></li>`
      : `<li><a href="#card-${a.card}"><i>${pad(a.no)}</i><b>${esc(a.question)}</b><span>${esc(a.short_title)}</span></a></li>`).join("");
    p.innerHTML = `<div class="col"><div class="kick">${np.m}/${np.d} ${WD[np.wd] || ""}<s></s>总览</div>
      <h2>${ASKS.length ? `${ASKS.length} 件在等你` : "现在没有要你回的"}</h2>
      <p class="sub">剪辑室里 ${SUM.videos} 条视频：${SUM.asks} 条等你拍板，${SUM.working} 条 agent 在做，${SUM.stuck} 条卡住了，${SUM.queued} 条在排队。其余的不用你管。</p></div>
      <div class="col">${ASKS.length ? `<ol class="waits">${waits}</ol>` : `<p class="sub">都在走，不用你管。</p>`}
      <div class="legend"><span><em style="background:var(--red)"></em>红灯：等你</span><span><em style="background:var(--amber)"></em>黄灯：卡住</span><span><em style="background:#eceef2;box-shadow:inset 0 0 0 3px #1b1c20"></em>胶片在转：agent 在做</span>${ASKS.length > 4 ? `<span>共 ${ASKS.length} 件，横着滑看全部</span>` : ""}<span>${upd}</span></div></div>`;
    const w = p.querySelector(".waits");
    if (w) {
      requestAnimationFrame(() => w.classList.toggle("more", w.scrollWidth > w.clientWidth + 4));
      w.addEventListener("scroll", () => w.classList.toggle("more", w.scrollLeft + w.clientWidth < w.scrollWidth - 4));
      w.addEventListener("wheel", e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && w.scrollWidth > w.clientWidth) { w.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
    }
    return;
  }
  const v = V.find(x => x.id === sel);
  const tags = [`<span class="hot">现在：${STAGES[v.s]}</span>`, `<span>第 ${v.s + 1}/7 站</span>`];
  if (v.queued) tags.push(`<span>排队第 ${v.qn} 个</span>`);
  if (v.stuck) tags.push(`<span class="warn">停了 ${v.stuck} 天</span>`);
  const pt = planTag(v); if (pt) tags.push(pt);
  const ask = v.ask ? `<div class="ask red"><div class="q">${esc(v.ask.q)}</div>${v.ask.c ? `<div class="cx">${esc(v.ask.c)}</div>` : ""}
      ${replyUI({ kind: v.ask.kind, question: v.ask.q, options: v.ask.say, card: v.cid })}
      <div class="df">${v.ask.past ? "没等到你回，agent 按默认做" : "你不回的话"}：<b>${esc(v.ask.d)}</b></div></div>`
    : v.pend.length ? `<div class="ask"><div class="q">你回了，等 agent 处理</div>${pendLines(v.pend)}</div>`
    : `<div class="ask"><div class="q">${esc(v.stat)}</div><div class="cx">${v.stuck ? "卡住了，agent 在想办法。" : "agent 在跟，不用你管。"}</div></div>`;
  const asking = ASKS.filter(x => x.v), i = asking.findIndex(x => x.v === v), nx = i >= 0 && asking.length > 1 ? asking[(i + 1) % asking.length] : (i < 0 && asking.length ? asking[0] : null);
  p.innerHTML = `<div class="col"><div class="kick"><b>${pad(v.id)}</b><s></s>共 ${V.length} 条</div>
    <h2 title="${esc(v.t)}">${esc(v.t)}</h2><div class="tags">${tags.join("")}</div>
    <div class="acts">${nx ? `<button type="button" class="nextask" data-id="${nx.v.id}">下一件等你：${esc(nx.a.question)}</button>` : ""}
    <a class="more" href="#card-${v.cid}">打开详情页</a>
    <button type="button" class="back" data-back>${from != null ? `← 回到${STAGES[from]}站` : "← 回总览"}</button></div></div>
    <div class="col">${stationsHTML(v)}${ask}</div>`;
}
function step(d) { if (!V.length) return; const i = sel == null ? (d > 0 ? -1 : 0) : V.findIndex(v => v.id === sel); select(V[(i + d + V.length) % V.length].id); }

/* ---------- 浮动牌子 + 站名 ---------- */
const labs = {}, stgs = [];
function buildLabels() {
  const host = document.getElementById("labels");
  V.forEach(v => {
    const d = document.createElement("button"); d.type = "button"; d.className = "lab hide"; d.dataset.id = v.id;
    const al = v.ask ? `<span class="al">等你：${esc(v.ask.q)}${v.stuck ? `（停 ${v.stuck} 天）` : ""}</span>` : v.stuck ? `<span class="al am">停 ${v.stuck} 天</span>` : "";
    d.innerHTML = `${al}<span class="nm"><b>${v.id}</b>${esc(v.sh)}</span>`;
    host.appendChild(d); labs[v.id] = d;
  });
  Object.entries(stacks).forEach(([s, st]) => {
    const d = document.createElement("button"); d.type = "button"; d.className = "lab stk hide"; d.dataset.st = s;
    d.innerHTML = `<span class="nm">还有 ${st.list.length} 盘排队</span>`; host.appendChild(d); st.lab = d;
  });
  STAGES.forEach((n, j) => { const d = document.createElement("button"); d.type = "button"; d.className = "stg"; d.dataset.st = j; d.setAttribute("aria-label", `看${n}站的全部视频`); d.innerHTML = `<i>${pad(j + 1)}</i><span>${n}</span>`; host.appendChild(d); stgs.push(d); });
}
const tmp = new THREE.Vector3();
function placeLabels(intro) {
  const el = R.domElement, w = el.clientWidth, h = el.clientHeight;
  const pr = document.getElementById("panel").getBoundingClientRect(), yr = document.getElementById("yard").getBoundingClientRect();
  const floor = w > 900 ? pr.top - yr.top - 8 : 1e4;   // 别压在底部信息栏上
  // 先算每块牌子钉在哪，再从画面下方往上排，压到别的牌子就往上抬（引线变长）
  const L = [];
  V.forEach(v => {
    const o = objs[v.id], d = labs[v.id];
    o.g.getWorldPosition(tmp); tmp.y += BELTY + 2.0; tmp.project(CAM);
    const bx = (tmp.x * .5 + .5) * w, by = (-tmp.y * .5 + .5) * h;
    const off = v.queued || tmp.z > 1 || Math.abs(tmp.x) > 1.2 || Math.abs(tmp.y) > 1.2 || by > floor || (w < 600 && flowing(v) && v.id !== sel);   // 手机上只留等你和卡住的牌子
    d.classList.toggle("hide", off || intro[v.id] < 1);
    d.classList.toggle("dim", (sel != null && v.id !== sel) || (stSel != null && v.s !== stSel));
    d.classList.toggle("sel", v.id === sel);
    if (!d._bw) { d._bw = d.offsetWidth; d._bh = d.offsetHeight - (parseFloat(d.style.getPropertyValue("--lead")) || 10); }
    L.push({ d, bx, by, lead: 10, on: !d.classList.contains("hide") });
  });
  Object.entries(stacks).forEach(([s, st]) => {
    const d = st.lab; tmp.copy(st.home); tmp.y = st.top; tmp.project(CAM);
    const bx = (tmp.x * .5 + .5) * w, by = (-tmp.y * .5 + .5) * h;
    const off = tmp.z > 1 || Math.abs(tmp.x) > 1.2 || Math.abs(tmp.y) > 1.2 || by > floor;
    const mine = sel != null && objs[sel].home === st.home;
    d.classList.toggle("hide", off || w < 600 || (performance.now() - t0) < 2600);
    d.classList.toggle("on", stSel === +s || mine); d.classList.toggle("dim", (sel != null && !mine) || (stSel != null && stSel !== +s));
    if (!d._bw) { d._bw = d.offsetWidth; d._bh = d.offsetHeight - 10; }
    L.push({ d, bx, by, lead: 10, on: !d.classList.contains("hide") });
  });
  const placed = [];
  L.filter(l => l.on).sort((a, b) => b.by - a.by).forEach(l => {
    for (let k = 0; k < 30; k++) {
      const x0 = l.bx - l.d._bw / 2 - 3, x1 = l.bx + l.d._bw / 2 + 3, y1 = l.by - l.lead + 3, y0 = y1 - l.d._bh - 6;
      const hit = placed.find(p => x0 < p.x1 && x1 > p.x0 && y0 < p.y1 && y1 > p.y0);
      if (!hit) { placed.push({ x0, x1, y0, y1 }); break; }
      l.lead += y1 - hit.y0 + 1;
    }
  });
  L.forEach(l => { l.d.style.setProperty("--lead", `${l.lead}px`); l.d.style.transform = `translate(${l.bx}px, ${l.by}px) translate(-50%, -100%)`; });
  stgs.forEach((d, j) => {
    tmp.set(DX(j), 0, 3.4); tmp.project(CAM);
    const y = (-tmp.y * .5 + .5) * h;
    d.style.transform = `translate(${(tmp.x * .5 + .5) * w}px, ${y}px) translate(-50%, -50%)`;
    d.classList.toggle("off", Math.abs(tmp.x) > 1.05 || y > floor + 8);
  });
}

/* ---------- 渲染 ---------- */
function resize() {
  const el = document.getElementById("yard"), cv = R.domElement;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  R.setSize(w, h, false); COMP.setSize(w, h);
  CAM.aspect = w / h;
  CAM.updateProjectionMatrix();
  fitOverview();
}
/* 总览镜头：正对着传送带、从斜上方看，按画框大小自动算远近，整条线、牌子、站名一屏放下 */
let OV_R = .45;
const OV = { p: new THREE.Vector3(0, 60, 52), t: new THREE.Vector3(0, 2, -1) };
const OV_DIR = new THREE.Vector3(.05, .66, 1).normalize();
function fitOverview() {
  const el = R.domElement, w = el.clientWidth, h = el.clientHeight; if (!w || !h) return;
  const yr = document.getElementById("yard").getBoundingClientRect(), pr = document.getElementById("panel").getBoundingClientRect();
  const desk = document.getElementById("yard").clientWidth > 900;
  const L = 60, Rt = w - 60, T = 76 + 40, B = (desk ? pr.top - yr.top : h) - 30;
  const pts = [new THREE.Vector3(-22.3, BELTY, BELTZ), new THREE.Vector3(22.3, BELTY, BELTZ), new THREE.Vector3(-21, 8.6, WALLZ), new THREE.Vector3(21, 8.6, WALLZ)];
  STAGES.forEach((n, j) => pts.push(new THREE.Vector3(DX(j), 0, 3.8)));
  V.forEach(v => { const o = objs[v.id]; if (!v.queued) pts.push(new THREE.Vector3(o.home.x, BELTY + 2.0 + (o.lift || 0) + 1.4, o.home.z)); });
  Object.values(stacks).forEach(st => pts.push(new THREE.Vector3(st.home.x, st.top + 1.2, st.home.z)));
  const sp = CAM.position.clone(), sq = CAM.quaternion.clone(), t = OV.t.clone(), v3 = new THREE.Vector3();
  const box2 = d => { CAM.position.copy(t).addScaledVector(OV_DIR, d); CAM.lookAt(t); CAM.updateMatrixWorld();
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    pts.forEach(p => { v3.copy(p).project(CAM); const x = (v3.x * .5 + .5) * w, y = (-v3.y * .5 + .5) * h; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
    return { x0, x1, y0, y1 }; };
  let d = 80;
  for (let it = 0; it < 4; it++) {
    let lo = 15, hi = 300;
    for (let k = 0; k < 26; k++) { const m = (lo + hi) / 2, b = box2(m); if (b.x1 - b.x0 <= Rt - L && b.y1 - b.y0 <= B - T) hi = m; else lo = m; }
    d = hi; const b = box2(d);
    const wpp = 2 * d * Math.tan(THREE.MathUtils.degToRad(CAM.fov / 2)) / h;
    const dx = (b.x0 + b.x1) / 2 - (L + Rt) / 2, dy = (b.y0 + b.y1) / 2 - (T + B) / 2;
    const right = new THREE.Vector3().setFromMatrixColumn(CAM.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(CAM.matrixWorld, 1);
    t.addScaledVector(right, dx * wpp).addScaledVector(up, -dy * wpp);
  }
  OV.t.copy(t); OV.p.copy(t).addScaledVector(OV_DIR, d);
  CAM.position.copy(sp); CAM.quaternion.copy(sq); CAM.updateMatrixWorld();
  if (fly) { fly.tp.copy(OV.p); fly.tt.copy(OV.t); } else if (CTL && t0 && !dragging) { CAM.position.copy(OV.p); CTL.target.copy(OV.t); }
  OV_R = 1 - (T + B) / 2 / h;
}
function init() {
  const cv = document.getElementById("cv");
  try { R = new THREE.WebGLRenderer({ canvas: cv, antialias: true }); } catch (e) { document.getElementById("fail").style.display = "grid"; return; }
  R.setPixelRatio(Math.min(devicePixelRatio, 2)); R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap;
  R.toneMapping = THREE.ACESFilmicToneMapping;
  makeMats();
  S = new THREE.Scene(); S.background = new THREE.Color(0x121317); S.fog = new THREE.Fog(0x121317, 160, 340);
  CAM = new THREE.PerspectiveCamera(24, 1, 1, 420); CAM.position.set(0, 95, 120);
  CTL = new THREE.OrbitControls(CAM, cv); CTL.enableDamping = true; CTL.target.copy(OV.t);
  CTL.enableZoom = false; CTL.enablePan = false; CTL.rotateSpeed = .45;
  CTL.minAzimuthAngle = -.45; CTL.maxAzimuthAngle = .5; CTL.minPolarAngle = .4; CTL.maxPolarAngle = 1.12; CTL.minDistance = 10; CTL.maxDistance = 400;
  CTL.addEventListener("start", () => { dragging = true; fly = null; });
  CTL.addEventListener("end", () => { dragging = false; lastDrag = performance.now(); });
  HEMI = new THREE.HemisphereLight(0xdfe6ff, 0x2a2420, .5); S.add(HEMI);
  SUN = new THREE.DirectionalLight(0xfff4e6, 1.2); SUN.position.set(-16, 30, 20); SUN.castShadow = true;
  SUN.shadow.mapSize.set(2048, 2048); Object.assign(SUN.shadow.camera, { left: -34, right: 34, top: 24, bottom: -24, near: 1, far: 110 });
  SUN.shadow.bias = -.0004; SUN.shadow.normalBias = .03; S.add(SUN);
  FILL = new THREE.DirectionalLight(0x9db4ff, .25); FILL.position.set(20, 12, 10); S.add(FILL);
  buildWorld(); for (let j = 0; j < 7; j++) station(j); layout(); buildPin(); buildLabels();
  applyTheme();

  COMP = new THREE.EffectComposer(R); COMP.addPass(new THREE.RenderPass(S, CAM));
  TSH = new THREE.ShaderPass(THREE.HorizontalTiltShiftShader); TSV = new THREE.ShaderPass(THREE.VerticalTiltShiftShader);
  COMP.addPass(TSH); COMP.addPass(TSV);
  resize(); new ResizeObserver(resize).observe(document.getElementById("yard"));
  camTo(OV.p, OV.t, REDUCED || QUICK ? 1 : 2600);

  // 点胶片盘选中；点空地回总览
  const ray = new THREE.Raycaster(), m = new THREE.Vector2(); let down = null;
  cv.addEventListener("pointerdown", e => down = [e.clientX, e.clientY]);
  cv.addEventListener("pointerup", e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const r = cv.getBoundingClientRect(); m.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(m, CAM);
    const groups = [...new Set(V.map(v => objs[v.id].g))];
    const hit = ray.intersectObjects(groups, true)[0];
    let v = null;
    if (hit) { let o = hit.object; while (o && !groups.includes(o)) o = o.parent; v = V.find(x => objs[x.id].g === o); }
    if (!v) { if (sel != null || stSel != null) select(null); return; }
    if (v.queued) openStation(v.s); else if (v.id === sel) goBack(); else select(v.id);
  });
  clock = new THREE.Clock(); t0 = performance.now();
  refresh(); loop();
  if (AFTER && AFTER.sel != null && V.some(v => v.id === AFTER.sel)) select(AFTER.sel);
}
function camTo(p, t, dur = 1200) { fly = { t0: performance.now(), dur, fp: CAM.position.clone(), ft: CTL.target.clone(), tp: p.clone(), tt: t.clone() }; }
function loop() {
  requestAnimationFrame(loop);
  if (FLAT) return;   // 在平面页时 3D 停着
  const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime;
  const it = (performance.now() - t0) / 1000, intro = {};
  V.forEach(v => intro[v.id] = introPose(v, objs[v.id], it));
  anim.forEach(f => f(t, dt));
  if (fly) {
    const k = Math.min(1, (performance.now() - fly.t0) / fly.dur), e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    CAM.position.lerpVectors(fly.fp, fly.tp, e); CTL.target.lerpVectors(fly.ft, fly.tt, e); if (k >= 1) fly = null;
  } else if (!dragging && performance.now() - lastDrag > 900) {   // 松手后自己回正
    CAM.position.lerp(OV.p, .05); CTL.target.lerp(OV.t, .05);
  }
  CTL.update();
  TSH.uniforms.r.value = TSV.uniforms.r.value = OV_R;
  TSH.uniforms.h.value = 1.3 / R.domElement.width; TSV.uniforms.v.value = 1.3 / R.domElement.height;
  COMP.render(); placeLabels(intro);
}

/* ---------- logo 方案 ---------- */
const LOGO_SVG = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="3" width="25" height="26" rx="6" fill="var(--y-ink)"/><path d="M5.2 9.5 9.2 22.5 13.2 9.5" fill="none" stroke="var(--yard)" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 22.5V9.5h5.6" fill="none" stroke="var(--yard)" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 16h11.2" stroke="var(--accent)" stroke-width="2.8" stroke-linecap="round"/><path d="M26.4 12.4 30.4 16l-4 3.6z" fill="var(--accent)" stroke="var(--accent)" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
function renderLogos() { document.getElementById("logo").innerHTML = LOGO_SVG; }

/* ---------- 交互 ---------- */
document.getElementById("yard").addEventListener("click", e => {
  if (e.target.closest("canvas") || e.target.closest("#pg") || e.target.closest("a[href^='#']")) return;
  const th = e.target.closest("[data-th]"); if (th) { applyTheme(th.dataset.th); return; }
  if (e.target.closest("[data-back]")) { goBack(); return; }
  const sb = e.target.closest("[data-st]"); if (sb) { const s = +sb.dataset.st; if (stSel === s) select(null); else openStation(s); return; }
  const b = e.target.closest("[data-id]"); if (b) { const id = +b.dataset.id; if (b.classList.contains("lab") && id === sel) goBack(); else select(id); }
});
addEventListener("keydown", e => {
  if (FLAT) return;
  if (e.target.closest && e.target.closest("input, textarea")) return;
  if (e.key === "ArrowRight") { step(1); e.preventDefault(); }
  if (e.key === "ArrowLeft") { step(-1); e.preventDefault(); }
  if (e.key === "Escape") select(null);
});
sysDark.addEventListener("change", () => { if (MODE === "system") applyTheme(); });
applyTheme();
renderLogos();
/* ---------- 页面切换：#pool、#review、#review-2026-W44、#card-<id>，不带就是流水线 ---------- */
const PGEL = document.getElementById("pg");
function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  const r = PG.render(h), yard = document.getElementById("yard");
  const navKey = r ? r.nav : "home";
  document.querySelectorAll("#nav a").forEach(a => { if (a.dataset.nav === navKey) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  document.getElementById("hint").hidden = !!r;
  if (!r) {
    FLAT = false; yard.classList.remove("flat"); PGEL.hidden = true; PGEL.innerHTML = "";
    document.title = "VideoFlows 剪辑室";
    if (R && R.domElement) { resize(); clock && clock.getDelta(); }
    return;
  }
  FLAT = true; yard.classList.add("flat"); PGEL.hidden = false; PGEL.innerHTML = r.html;
  document.title = `${r.title} · VideoFlows`;
}
PGEL.addEventListener("click", e => { if (PG.click(e)) { const y = scrollY; route(); scrollTo(0, y); } });
addEventListener("hashchange", () => { PG.resetPt(); route(); scrollTo(0, 0); });
document.querySelector('#nav a[data-nav="home"]').insertAdjacentHTML("beforeend", ASKS.length ? `<b aria-label="${ASKS.length} 件等你">${ASKS.length}</b>` : "");
if (DEMO) document.querySelector(".brand").insertAdjacentHTML("afterend", `<a class="demo-tag" href="./" title="现在看的是假数据">示例数据 · 回到我的</a>`);
route();
if (AFTER && AFTER.y) scrollTo(0, AFTER.y);
if (!window.THREE || !THREE.EffectComposer) document.getElementById("fail").style.display = "grid";
else Promise.race([Promise.all([document.fonts.load('900 40px "Noto Sans SC"'), document.fonts.load('700 40px "Barlow Condensed"')]), new Promise(r => setTimeout(r, 1500))]).catch(() => {}).then(init);
})();
