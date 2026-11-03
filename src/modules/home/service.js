// home 域的 service：业务真相源。CLI 与 Web 面板共用这一层。
//
// 本模块同时承担两件事：
//   ① 面板启动上下文（bootstrap / 健康自检 / 命令表 / 存储路径）——面板一打开就要的东西；
//   ② 本机设置的读写与**严格校验**（主题、头部导航：分组 / 隐藏 / 平铺顺序）。
//
// 为什么「首页」和「设置」合成一个模块：这两块都是「关于这个应用本身」的内容，
// 拆成两个模块，初始就凭空多出一个只有 meta 信息的空壳页。合成一个模块，
// 每一个出厂模块都有真实内容。它示范了 service 的三种返回形态：
//   throw        失败（调用方无从处理）
//   { status }   业务结果（调用方要拿它做决策）
//   普通对象     数据（调用方直接展示）
import { readFileSync } from 'node:fs';
import { APP_NAME, APP_DESC, APP_TITLE, STORE_PATH, storePathFromEnv } from '../../core/paths.js';
import { loadStore, mutateStore } from '../../core/store.js';
import { VIEWS_META, viewMetaOf } from '../../core/views.js';
import { badInput, notFound } from '../../core/errors/index.js';

const VERSION = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
).version;

// ---- ① 启动上下文 ----

// 一次拿齐面板启动所需的上下文。
// 面板用它渲染标题、版本、存储路径与「CLI 等价」提示——
// 各视图不自己拼这些字符串，否则迟早与实际不符。
export async function bootstrap() {
  const { commandTable } = await import('./commands.js');
  return {
    app: { name: APP_NAME, title: APP_TITLE, description: APP_DESC, version: VERSION },
    storePath: storePathFromEnv(),
    storeDefault: STORE_PATH,
    commands: await commandTable(),
  };
}

// 大整数的可读化，供展示
export function formatBytes(n) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = Number(n) || 0;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// ---- ② 本机设置 ----

/** 已知设置项 → 说明 + 校验器（面板据此提示）。 */
const SCHEMA = {
  navGroups: { hint: '头部导航分组：[{title, views:[页面id…]}]，数组顺序 = 显示顺序', coerce: coerceNavGroups },
  navHidden: { hint: '隐藏的页面 id（入口不显示，直达仍可用）', coerce: coerceNavHidden },
  navOrder: { hint: '平铺区的显示顺序（页面 id 数组；没列进去的按页面自身顺序跟在后面）', coerce: coerceNavOrder },
  theme: { hint: '色彩主题：light（浅色）/ dark（深色）/ auto（跟随系统）', coerce: coerceTheme },
};

/** 主题白名单：只认 light / dark / auto，别的一律拒绝。 */
function coerceTheme(value) {
  const t = String(value ?? '').trim().toLowerCase();
  if (!['light', 'dark', 'auto'].includes(t)) {
    throw badInput('主题只能是 light / dark / auto，收到: ' + value);
  }
  return t;
}

/**
 * 「页面 id 清单」校验（隐藏清单 / 平铺顺序共用）：每一项都必须是真实存在的页面；
 * 去重保序，并归一成真实 id。label 只影响报错措辞。
 * 三种写法都吃：数组（面板）、`a,b`（CLI 省事写法）、`["a","b"]`（CLI 的 JSON 写法）。
 */
function coerceIdList(value, label) {
  let raw = value;
  if (typeof raw === 'string' && raw.trim().startsWith('[')) {
    try {
      raw = JSON.parse(raw);
    } catch (e) {
      throw badInput(`${label}需要 JSON 数组或逗号分隔：${e.message}`);
    }
  }
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
  const out = [];
  for (const item of list) {
    const id = String(item ?? '').trim();
    if (!id) continue;
    if (!viewMetaOf(id)) throw badInput(`${label}里的页面不存在: ${id}`);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

// 函数声明（会提升）：SCHEMA 在模块顶层引用它们，const 箭头函数会踩 TDZ
function coerceNavHidden(value) {
  return coerceIdList(value, '隐藏清单');
}

function coerceNavOrder(value) {
  return coerceIdList(value, '平铺顺序');
}

/** 分组校验 + 归一：组名非空、页面必须存在、组内去重、跨组重复拒绝、空组拒绝。 */
function coerceNavGroups(value) {
  let arr = value;
  if (typeof arr === 'string') {
    try {
      arr = JSON.parse(arr);
    } catch (e) {
      throw badInput(`navGroups 需要 JSON 数组（${e.message}）：[{"title":"求职","views":["home"]}, …]`);
    }
  }
  if (!Array.isArray(arr)) {
    throw badInput('navGroups 需要是数组：[{"title":"求职","views":["home"]}, …]');
  }
  const owner = new Map();
  return arr.map((g, i) => {
    if (!g || typeof g !== 'object') throw badInput(`第 ${i + 1} 个分组不是对象`);
    const title = String(g.title ?? '').trim();
    if (!title) throw badInput(`第 ${i + 1} 个分组缺少 title（组名）`);
    const views = [];
    for (const item of Array.isArray(g.views) ? g.views : []) {
      const id = String(item ?? '').trim();
      if (!id || views.includes(id)) continue; // 组内重复（或空串）直接去重
      if (!viewMetaOf(id)) throw badInput(`分组「${title}」里的页面不存在: ${id}`);
      const ownerTitle = owner.get(id);
      if (ownerTitle) throw badInput(`页面 ${id} 同时在分组「${ownerTitle}」与「${title}」里——一个页面只能属于一个分组`);
      owner.set(id, title);
      views.push(id);
    }
    if (!views.length) throw badInput(`分组「${title}」没有任何页面——要么加一个，要么删掉这个分组`);
    return { title, views };
  });
}

export async function getSettings() {
  const store = await loadStore();
  return {
    settings: store.settings,
    // 页面清单随设置一起给：面板的头部导航与本页都按它渲染
    views: VIEWS_META.map((v) => ({ ...v })),
    schema: Object.entries(SCHEMA).map(([key, s]) => ({ key, hint: s.hint })),
  };
}

/** PATCH 语义：只改传入的项。返回**最新全量设置**，面板保存后直接拿来刷新头部。 */
export async function setSettings({ key, value, set, 'dry-run': dryRun } = {}) {
  const patch = { ...(set || {}) };
  if (key !== undefined) patch[key] = value;

  const keys = Object.keys(patch);
  if (!keys.length) throw badInput('至少要给一项：setting set --key <名> --value <值>，或 --set k=v（可重复）');

  const resolved = {};
  for (const k of keys) {
    const spec = SCHEMA[k];
    if (!spec) throw notFound(`未知设置项: ${k}（可用: ${Object.keys(SCHEMA).join(', ')}）`);
    resolved[k] = spec.coerce(patch[k]);
  }

  if (dryRun) return { status: 'skipped', dryRun: true, wouldSet: resolved };

  const after = await mutateStore((s) => {
    for (const [k, v] of Object.entries(resolved)) s.settings[k] = v;
    return { ...s.settings };
  });
  return { status: 'ok', settings: after };
}

export function renderSettings(d) {
  const hidden = new Set(d.settings.navHidden || []);
  const lines = [`当前设置（改：nx-ditto setting set --set k=v）· 主题: ${d.settings.theme || 'light'}`];
  for (const s of d.schema) lines.push(`  ${s.key.padEnd(12)} ${s.hint}`);

  lines.push('', `页面（${d.views.length}）· 隐藏 ${hidden.size} 个`);
  for (const v of d.views) {
    lines.push(`  ${v.id.padEnd(12)} ${v.title.padEnd(10)} ${hidden.has(v.id) ? '隐藏' : '显示'}`);
  }

  const ranked = (d.settings.navOrder || []).filter((id) => d.views.some((v) => v.id === id));
  if (ranked.length) lines.push(`平铺顺序（前 ${ranked.length} 个已显式排序）: ${ranked.join(' → ')}`);

  const groups = d.settings.navGroups || [];
  if (!groups.length) {
    lines.push('', '分组：无（全部页面平铺在头部）');
  } else {
    lines.push('', `分组（${groups.length}）· 组顺序 = 头部顺序，组内顺序 = 展开列表顺序`);
    for (const g of groups) lines.push(`  ${g.title}: ${g.views.join(' → ')}`);
  }
  return lines.join('\n');
}

export function renderSettingSet(d) {
  if (d.status === 'skipped') return `试运行（未落盘）：将写入 ${JSON.stringify(d.wouldSet)}`;
  const groups = d.settings?.navGroups || [];
  const hidden = d.settings?.navHidden || [];
  const lines = [`已更新设置：${groups.length} 个导航分组，隐藏 ${hidden.length} 个页面`];
  for (const g of groups) lines.push(`  ${g.title}: ${g.views.join(' → ')}`);
  if (hidden.length) lines.push(`  隐藏: ${hidden.join(', ')}`);
  return lines.join('\n');
}
