// POST /api/act 的处理逻辑：网页上点的按钮，服务器直接改卡，一个提交写回仓库，不等 agent。
// 由 functions/api/act.js（Cloudflare Pages Function，跑在服务器上）调用；写仓库的密钥只在服务器上，页面拿不到。
// 放在 scripts/lib/ 而不是 functions/ 里，是因为 functions/ 下每个文件都会变成一个网址。
//
// 要在 Cloudflare Pages 项目里设的环境变量（都不进仓库）：
//   GITHUB_TOKEN        只管这个仓库、只给 Contents 读写的 fine-grained token（设成 Secret）
//   GITHUB_REPO         owner/仓库名
//   GITHUB_BRANCH       写到哪个分支，默认 main
//   ACCESS_TEAM_DOMAIN  Cloudflare Access 的团队域名，如 xxx.cloudflareaccess.com
//   ACCESS_AUD          这个 Access 应用的 AUD 标签
//   ALLOWED_EMAILS      必填，逗号分隔；只收这些邮箱（不设就拒收，不靠 Access 策略兜底）
//
// 层层把关：同源 + JSON 才收；Access 签发的登录凭证要验签、验受众、验过期；邮箱在名单里；
// 动作按 scripts/lib/actions.mjs 的规则算出新卡，过 card.schema.json 才写；
// 读和写都对着同一个提交（expectedHeadOid），中间有人推了新提交就重读重算，不覆盖别人的改动。

import { parseAction, applyAction } from './actions.mjs';

const MAX_BODY = 8 * 1024;
const CERT_TTL = 10 * 60 * 1000;
const TRIES = 3;
let certCache = null; // { url, at, keys }

const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const out = (status, obj) => new Response(JSON.stringify(obj), { status, headers: HEADERS });
const fail = (status, code, message) => out(status, { ok: false, code, message });

class GitHubError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function handleAct(request, env, deps = {}) {
  const fetchFn = deps.fetch || fetch;
  const nowFn = deps.now || (() => Date.now());
  const cardSchema = deps.cardSchema;

  if (request.method !== 'POST') return fail(405, 'method', '只收 POST');

  const need = ['GITHUB_TOKEN', 'GITHUB_REPO', 'ACCESS_TEAM_DOMAIN', 'ACCESS_AUD', 'ALLOWED_EMAILS'].filter((k) => !String(env[k] || '').trim());
  if (need.length) return fail(503, 'not_configured', `网页回写还没开通：Cloudflare 里还缺设置 ${need.join('、')}`);
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPO)) return fail(503, 'not_configured', 'GITHUB_REPO 要写成 owner/仓库名');
  const allowed = String(env.ALLOWED_EMAILS).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length) return fail(503, 'not_configured', '网页回写还没开通：ALLOWED_EMAILS 里没有有效邮箱');
  if (!cardSchema) return fail(500, 'internal', '服务器没带上卡的校验规则');

  // 同源：只收自己页面发来的请求
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) return fail(403, 'origin', '只收本站页面发来的请求');
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) return fail(415, 'type', '要 JSON');

  // 登录：Cloudflare Access 的凭证
  let claims;
  try {
    claims = await verifyAccess(request.headers.get('cf-access-jwt-assertion'), env, fetchFn, nowFn());
  } catch (e) {
    return fail(401, 'auth', `登录没验过（${e.message}），刷新页面重新登录`);
  }
  if (!allowed.includes(String(claims.email || '').toLowerCase())) return fail(403, 'email', '这个账号不能写');

  // 内容
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return fail(413, 'size', '内容太长');
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY) return fail(413, 'size', '内容太长');
  let body;
  try { body = JSON.parse(raw); } catch { return fail(400, 'json', '内容不是 JSON'); }
  const parsed = parseAction(body);
  if (parsed.error) return fail(400, 'invalid', parsed.error);
  const action = parsed.action;

  // 读仓库 → 算新卡 → 对着同一个提交写回；中间有人推了就重来
  const branch = env.GITHUB_BRANCH || 'main';
  const gh = (query, variables) => graphql(fetchFn, env.GITHUB_TOKEN, query, variables);
  try {
    for (let attempt = 0; attempt < TRIES; attempt++) {
      const snap = await readRepo(gh, env.GITHUB_REPO, branch);
      const nowMs = nowFn();
      const res = applyAction(action, { cards: snap.cards, cardSchema, tz: snap.tz, nowMs, rand: deps.rand ? deps.rand() : rand(4) });
      if (res.error) return fail(res.code === 'invalid_card' ? 422 : 409, res.code || 'stale', res.error);
      const commit = await createCommit(gh, env.GITHUB_REPO, branch, snap.oid, res);
      if (commit === 'moved') continue;
      return out(200, {
        ok: true,
        item: { id: commit.oid.slice(0, 12), at: new Date(nowMs).toISOString(), card: res.card.id, kind: action.kind, value: action.value, amount: action.amount, text: action.text, question: action.question, summary: res.summary },
      });
    }
    return fail(409, 'busy', '仓库刚好在被别人改，过几秒再点一次');
  } catch (e) {
    if (e instanceof GitHubError && (e.status === 401 || e.status === 403 || e.status === 404)) return fail(502, 'github', `写不进仓库：GitHub 密钥无效、过期或权限不够（${e.status}）`);
    return fail(502, 'github', `写不进仓库（${e.message}），过一会儿再试`);
  }
}

function rand(n) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(b, (x) => 'abcdefghijklmnopqrstuvwxyz0123456789'[x % 36]).join('');
}

function b64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function graphql(fetchFn, token, query, variables) {
  const r = await fetchFn('https://api.github.com/graphql', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': 'videoflows-act' },
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) throw new GitHubError(r.status, `GitHub ${r.status}`);
  const j = await r.json();
  return j;
}

const BLOB = '... on Blob { text }';
const READ_QUERY = `query($owner: String!, $name: String!, $ref: String!) {
  repository(owner: $owner, name: $name) {
    ref(qualifiedName: $ref) { target { ... on Commit {
      oid
      config: file(path: "config.json") { object { ${BLOB} } }
      active: file(path: "cards/active") { object { ... on Tree { entries { name object { ${BLOB} } } } } }
      archive: file(path: "cards/archive") { object { ... on Tree { entries { name object { ... on Tree { entries { name object { ${BLOB} } } } } } } } }
    } } }
  }
}`;

// 一次读出同一个提交里的 config.json 和所有卡（含归档）
export async function readRepo(gh, repo, branch) {
  const [owner, name] = repo.split('/');
  const j = await gh(READ_QUERY, { owner, name, ref: `refs/heads/${branch}` });
  if (j.errors && j.errors.length) {
    const t = j.errors[0].type;
    throw new GitHubError(t === 'NOT_FOUND' || t === 'FORBIDDEN' ? 403 : 502, j.errors[0].message);
  }
  const c = j.data && j.data.repository && j.data.repository.ref && j.data.repository.ref.target;
  if (!c || !c.oid) throw new GitHubError(404, `找不到分支 ${branch}`);
  let tz = 'Asia/Shanghai';
  try { tz = JSON.parse(c.config.object.text).timezone || tz; } catch { /* 用默认时区 */ }
  const cards = [];
  const take = (path, obj) => {
    if (!path.endsWith('.json') || !obj || typeof obj.text !== 'string') return;
    try { cards.push({ path, card: JSON.parse(obj.text) }); } catch { cards.push({ path, card: null }); }
  };
  for (const e of (c.active && c.active.object && c.active.object.entries) || []) take(`cards/active/${e.name}`, e.object);
  for (const y of (c.archive && c.archive.object && c.archive.object.entries) || []) {
    for (const e of (y.object && y.object.entries) || []) take(`cards/archive/${y.name}/${e.name}`, e.object);
  }
  return { oid: c.oid, tz, cards };
}

const COMMIT_MUTATION = `mutation($input: CreateCommitOnBranchInput!) {
  createCommitOnBranch(input: $input) { commit { oid } }
}`;

// 返回 { oid }；分支在读和写之间被推过返回 'moved'
export async function createCommit(gh, repo, branch, expectedOid, res) {
  const j = await gh(COMMIT_MUTATION, {
    input: {
      branch: { repositoryNameWithOwner: repo, branchName: branch },
      expectedHeadOid: expectedOid,
      message: { headline: res.message, body: res.summary },
      fileChanges: {
        additions: res.files.map((f) => ({ path: f.path, contents: b64(f.content) })),
        deletions: res.deletions.map((p) => ({ path: p })),
      },
    },
  });
  if (j.errors && j.errors.length) {
    const msg = j.errors.map((e) => e.message).join('；');
    if (/expected branch to point|but it did not|pull and try again|not a fast.?forward/i.test(msg)) return 'moved';
    if (/permission|access|resource not accessible|forbidden/i.test(msg)) throw new GitHubError(403, msg);
    throw new GitHubError(502, msg);
  }
  const commit = j.data && j.data.createCommitOnBranch && j.data.createCommitOnBranch.commit;
  if (!commit) throw new GitHubError(502, 'GitHub 没回提交');
  return commit;
}

// ---------- Cloudflare Access 凭证（RS256 JWT）----------
function b64urlBytes(s) {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

async function accessKeys(url, fetchFn, now, force) {
  if (!force && certCache && certCache.url === url && now - certCache.at < CERT_TTL) return certCache.keys;
  const r = await fetchFn(url);
  if (!r.ok) throw new Error(`取不到 Access 公钥 ${r.status}`);
  const j = await r.json();
  if (!j || !Array.isArray(j.keys)) throw new Error('Access 公钥格式不对');
  certCache = { url, at: now, keys: j.keys };
  return j.keys;
}

export async function verifyAccess(token, env, fetchFn, now) {
  if (!token) throw new Error('没带登录凭证');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('凭证格式不对');
  let header, payload;
  try { header = b64urlJson(parts[0]); payload = b64urlJson(parts[1]); } catch { throw new Error('凭证读不出来'); }
  if (header.alg !== 'RS256' || !header.kid) throw new Error('凭证算法不对');

  const team = String(env.ACCESS_TEAM_DOMAIN).replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const certsUrl = `https://${team}/cdn-cgi/access/certs`;
  let keys = await accessKeys(certsUrl, fetchFn, now, false);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) { keys = await accessKeys(certsUrl, fetchFn, now, true); jwk = keys.find((k) => k.kid === header.kid); }
  if (!jwk) throw new Error('找不到对应的公钥');

  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new Error('签名不对');

  const sec = Math.floor(now / 1000);
  if (payload.iss !== `https://${team}`) throw new Error('签发方不对');
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) throw new Error('不是这个站的凭证');
  if (typeof payload.exp !== 'number' || payload.exp < sec) throw new Error('登录过期');
  if (typeof payload.nbf === 'number' && payload.nbf > sec + 60) throw new Error('凭证还没生效');
  return payload;
}

// 测试用：清掉公钥缓存
export function _resetCache() { certCache = null; }
