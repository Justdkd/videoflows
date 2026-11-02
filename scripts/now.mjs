#!/usr/bin/env node
// 打印 config.json 时区下的当前时间，如 2026-11-06T19:00:00+08:00；写 last_touched、stage_since、taken_at 时用。
// 加 --week 打印当前 ISO 周，如 2026-W45。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatTime, isoWeek } from './lib/time.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { timezone } = JSON.parse(fs.readFileSync(path.join(REPO, 'config.json'), 'utf8'));
console.log(process.argv.includes('--week') ? isoWeek(Date.now(), timezone) : formatTime(Date.now(), timezone));
