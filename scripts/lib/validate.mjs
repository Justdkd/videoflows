// 零依赖 JSON Schema 校验器，只实现本仓库 schema/ 用到的 draft 2020-12 子集。
// 不认识的关键字会直接报错，避免 schema 里写了却没被校验。

const KNOWN = new Set([
  '$schema', '$id', '$defs', '$ref', '$comment', 'title', 'description', 'examples', 'default',
  'type', 'enum', 'const', 'properties', 'required', 'additionalProperties', 'propertyNames',
  'items', 'minItems', 'maxItems', 'uniqueItems', 'minimum', 'maximum', 'exclusiveMinimum',
  'minLength', 'maxLength', 'pattern', 'format', 'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else',
  'minProperties', 'maxProperties', 'multipleOf',
]);

// 时间必须带时区：Z 或 ±hh:mm
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function typeMatches(v, t) {
  const actual = typeOf(v);
  if (t === 'number') return actual === 'number' || actual === 'integer';
  return actual === t;
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function ptr(path) {
  return path.length ? '/' + path.join('/') : '/';
}

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`只支持本文件内的 $ref：${ref}`);
  let node = root;
  for (const part of ref.slice(2).split('/')) {
    node = node?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
    if (node === undefined) throw new Error(`$ref 指向不存在的位置：${ref}`);
  }
  return node;
}

function checkFormat(v, format) {
  if (typeof v !== 'string') return null;
  if (format === 'date-time') {
    if (!DATE_TIME.test(v) || Number.isNaN(Date.parse(v))) return '必须是带时区的时间，如 2026-11-06T19:00:00+08:00';
  } else if (format === 'date') {
    if (!DATE.test(v) || Number.isNaN(Date.parse(v + 'T00:00:00Z'))) return '必须是日期 YYYY-MM-DD';
  } else if (format === 'uri') {
    try { new URL(v); } catch { return '必须是完整网址'; }
  } else {
    throw new Error(`未实现的 format：${format}`);
  }
  return null;
}

function walk(root, schema, value, path, errors) {
  if (schema === true) return;
  if (schema === false) { errors.push({ path: ptr(path), message: '这里不允许有值' }); return; }
  for (const k of Object.keys(schema)) {
    if (!KNOWN.has(k)) throw new Error(`schema 用了校验器不支持的关键字 ${k}（${ptr(path)}）`);
  }
  const err = (message, p = path) => errors.push({ path: ptr(p), message });

  if (schema.$ref) {
    walk(root, resolveRef(root, schema.$ref), value, path, errors);
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(value, t))) {
      err(`类型应为 ${types.join(' 或 ')}，实际是 ${typeOf(value)}`);
      return; // 类型错了，后面的检查没有意义
    }
  }
  if (schema.const !== undefined && !deepEqual(value, schema.const)) {
    err(`必须等于 ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some((e) => deepEqual(e, value))) {
    err(`只能是 ${schema.enum.map((e) => JSON.stringify(e)).join('、')} 之一，实际是 ${JSON.stringify(value)}`);
  }

  const t = typeOf(value);
  if (t === 'string') {
    if (schema.minLength !== undefined && [...value].length < schema.minLength) err(`至少 ${schema.minLength} 个字符`);
    if (schema.maxLength !== undefined && [...value].length > schema.maxLength) err(`最多 ${schema.maxLength} 个字符`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) err(`格式不对，要匹配 ${schema.pattern}`);
    if (schema.format) { const m = checkFormat(value, schema.format); if (m) err(m); }
  }
  if (t === 'number' || t === 'integer') {
    if (schema.minimum !== undefined && value < schema.minimum) err(`不能小于 ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) err(`不能大于 ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) err(`必须大于 ${schema.exclusiveMinimum}`);
    if (schema.multipleOf !== undefined && Math.abs(value / schema.multipleOf - Math.round(value / schema.multipleOf)) > 1e-9) err(`必须是 ${schema.multipleOf} 的倍数`);
  }
  if (t === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) err(`至少 ${schema.minItems} 项`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) err(`最多 ${schema.maxItems} 项`);
    if (schema.uniqueItems) {
      const seen = new Set();
      value.forEach((v, i) => { const s = JSON.stringify(v); if (seen.has(s)) err('有重复项', [...path, i]); seen.add(s); });
    }
    if (schema.items !== undefined) value.forEach((v, i) => walk(root, schema.items, v, [...path, i], errors));
  }
  if (t === 'object') {
    const keys = Object.keys(value);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) err(`至少 ${schema.minProperties} 个字段`);
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) err(`最多 ${schema.maxProperties} 个字段`);
    for (const r of schema.required || []) {
      if (!(r in value)) err('缺少必填字段', [...path, r]);
    }
    const props = schema.properties || {};
    for (const k of keys) {
      if (schema.propertyNames) walk(root, schema.propertyNames, k, [...path, k], errors);
      if (k in props) walk(root, props[k], value[k], [...path, k], errors);
      else if (schema.additionalProperties === false) err('不认识的字段（schema 里没有）', [...path, k]);
      else if (typeof schema.additionalProperties === 'object') walk(root, schema.additionalProperties, value[k], [...path, k], errors);
    }
  }

  // 所有分支都不过时：只因类型不符而失败的分支（比如 null 分支）不提，剩一个分支就直接报它的错
  const reportBranches = (results) => {
    const here = ptr(path);
    const real = results.filter((e) => !(e.length === 1 && e[0].path === here && e[0].message.startsWith('类型应为')));
    if (real.length === 1) { errors.push(...real[0]); return; }
    const use = real.length ? real : results;
    err(`不满足任何一种允许的写法：${use.map((e) => e.map((x) => `${x.path} ${x.message}`).join('；')).join(' | ')}`);
  };
  for (const sub of schema.allOf || []) walk(root, sub, value, path, errors);
  if (schema.anyOf) {
    const results = schema.anyOf.map((s) => { const e = []; walk(root, s, value, path, e); return e; });
    if (!results.some((e) => e.length === 0)) reportBranches(results);
  }
  if (schema.oneOf) {
    const results = schema.oneOf.map((s) => { const e = []; walk(root, s, value, path, e); return e; });
    const ok = results.filter((e) => e.length === 0).length;
    if (ok === 0) reportBranches(results);
    else if (ok > 1) err('同时满足了多种写法，有歧义');
  }
  if (schema.not) {
    const e = []; walk(root, schema.not, value, path, e);
    if (e.length === 0) err(schema.not.description || '命中了不允许的写法');
  }
  if (schema.if !== undefined) {
    const e = []; walk(root, schema.if, value, path, e);
    if (e.length === 0) { if (schema.then !== undefined) walk(root, schema.then, value, path, errors); }
    else if (schema.else !== undefined) walk(root, schema.else, value, path, errors);
  }
}

// 返回 [{path, message}]，空数组表示通过
export function validate(schema, value) {
  const errors = [];
  walk(schema, schema, value, [], errors);
  // 同一位置同一句只留一条
  const seen = new Set();
  return errors.filter((e) => { const k = e.path + e.message; if (seen.has(k)) return false; seen.add(k); return true; });
}
