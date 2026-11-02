#!/usr/bin/env node
// 生成可部署的静态网站：node scripts/build-site.mjs（Cloudflare Pages 的构建命令就是这一行）
//
// 1. 跑 build-index，校验所有卡并算出 index.json / index.archive.json（有错就停，不出半份网站）
// 2. 把 site/ 拷到 dist/
// 3. 写 dist/data.json：index、归档摘要、config、原始卡片（发布记录、记录、素材页面要用）、周复盘
// 4. 写 dist/data-demo.json：tests/fixtures/board 的假数据，页面加 ?demo 时读它
//
// 参数：
//   --out <目录>   输出目录，默认 dist
//   --root <目录>  数据目录，默认仓库根目录（测试用）
//   --now <时间>   传给 build-index，把「现在」固定住（测试用）
//   --no-git       传给 build-index，不读 git 历史
//   --no-demo      不生成示例数据
//
// 零依赖，Node 18+。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_INDEX = path.join(REPO, 'scripts/build-index.mjs');
const DEMO_NOW = '2026-11-09T09:30:00+08:00';

function parseArgs(argv) {
  const opt = { out: path.join(REPO, 'dist'), root: REPO, pass: [], demo: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opt.out = path.resolve(argv[++i]);
    else if (a === '--root') opt.root = path.resolve(argv[++i]);
    else if (a === '--now') opt.pass.push('--now', argv[++i]);
    else if (a === '--no-git') opt.pass.push('--no-git');
    else if (a === '--no-demo') opt.demo = false;
    else { console.error(`不认识的参数：${a}`); process.exit(2); }
  }
  return opt;
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const jsonFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(dir, f)) : []);

// Cloudflare Pages 等平台可能是浅克隆：先尽量补全历史，阶段时间线才准。补不了也继续，build-index 会在 warnings 里提示
function unshallow(root) {
  const r = spawnSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0 || r.stdout.trim() !== 'true') return;
  console.log('git 是浅克隆，补全历史…');
  const f = spawnSync('git', ['fetch', '--unshallow', '--quiet'], { cwd: root, encoding: 'utf8' });
  if (f.status !== 0) console.log('补全历史失败，继续构建（阶段时间线可能不全）');
}

function buildIndex(root, extra) {
  const r = spawnSync(process.execPath, [BUILD_INDEX, '--root', root, ...extra], { encoding: 'utf8' });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  if (r.status !== 0) {
    console.error(`\n✗ build-index 没过（${root}），不生成网站。`);
    process.exit(r.status || 1);
  }
}

function bundle(root) {
  const cards = {};
  for (const f of jsonFiles(path.join(root, 'cards/active'))) { const c = readJson(f); cards[c.id] = c; }
  const archiveRoot = path.join(root, 'cards/archive');
  if (fs.existsSync(archiveRoot)) {
    for (const y of fs.readdirSync(archiveRoot).sort()) {
      for (const f of jsonFiles(path.join(archiveRoot, y))) { const c = readJson(f); cards[c.id] = c; }
    }
  }
  return {
    index: readJson(path.join(root, 'index.json')),
    archive: readJson(path.join(root, 'index.archive.json')),
    config: readJson(path.join(root, 'config.json')),
    cards,
    reviews: jsonFiles(path.join(root, 'reviews')).map(readJson),
  };
}

function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (!opt.pass.includes('--no-git')) unshallow(opt.root);
  buildIndex(opt.root, opt.pass);
  const data = bundle(opt.root);

  let demo = null;
  if (opt.demo) {
    // 假数据放到临时目录里算，不碰仓库
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-demo-'));
    fs.cpSync(path.join(REPO, 'tests/fixtures/board'), dir, { recursive: true });
    fs.copyFileSync(path.join(REPO, 'config.json'), path.join(dir, 'config.json'));
    fs.cpSync(path.join(REPO, 'adapters'), path.join(dir, 'adapters'), { recursive: true });
    buildIndex(dir, ['--now', DEMO_NOW, '--no-git']);
    demo = bundle(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  fs.rmSync(opt.out, { recursive: true, force: true });
  fs.cpSync(path.join(REPO, 'site'), opt.out, { recursive: true });
  fs.writeFileSync(path.join(opt.out, 'data.json'), JSON.stringify(data));
  if (demo) fs.writeFileSync(path.join(opt.out, 'data-demo.json'), JSON.stringify(demo));

  const n = Object.keys(data.cards).length;
  console.log(`\n已生成网站：${path.relative(process.cwd(), opt.out) || opt.out}（${n} 张卡，${data.reviews.length} 份复盘${demo ? '，含示例数据' : ''}）`);
}

main();
