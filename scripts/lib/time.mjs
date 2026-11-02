// 时区相关的小工具。所有时间在内部都是毫秒时间戳，输出时按 config.timezone 带偏移写出。

export const HOUR = 3600 * 1000;
export const DAY = 24 * HOUR;

export function parseTime(s) {
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) throw new Error(`无法解析时间：${s}`);
  return ms;
}

function parts(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const { type, value } of f.formatToParts(new Date(ms))) p[type] = value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

function offsetMinutes(ms, tz) {
  const p = parts(ms, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

// 2026-11-06T19:00:00+08:00
export function formatTime(ms, tz) {
  const p = parts(ms, tz);
  const off = offsetMinutes(ms, tz);
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export function localDate(ms, tz) {
  const p = parts(ms, tz);
  return { y: p.y, m: p.m, d: p.d };
}

// 某个本地日期 00:00 在该时区对应的时间戳
export function localMidnight(dateStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  return guess - offsetMinutes(guess, tz) * 60000;
}

// 日历加天数：'2026-10-05' + 30 → '2026-11-04'（不受夏令时影响）
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

// ISO 周几：1 = 周一 … 7 = 周日
export function isoWeekday(ms, tz) {
  const { y, m, d } = localDate(ms, tz);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

// ISO 周，如 2026-W45
export function isoWeek(ms, tz) {
  const { y, m, d } = localDate(ms, tz);
  const date = new Date(Date.UTC(y, m - 1, d));
  const wd = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - wd);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date - yearStart) / DAY + 1) / 7);
  return `${date.getUTCFullYear()}-W${pad(week)}`;
}

// ISO 周的周一：'2026-W45' → '2026-11-02'
export function isoWeekMonday(week) {
  const [y, w] = week.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const wd = jan4.getUTCDay() || 7;
  const t = new Date(Date.UTC(y, 0, 4 - (wd - 1) + (w - 1) * 7));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

// 两个本地日期差几天（b - a），按日历算，不受夏令时影响
export function daysBetween(a, b) {
  const ms = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((ms(b) - ms(a)) / DAY);
}
