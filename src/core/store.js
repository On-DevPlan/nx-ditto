// JSON 存储：用户目录下的单一数据文件，Web 表单与 agent CLI 共同读写。
//
// 设计要点：
// - 原子写（临时文件 + rename），进程中断不会损坏数据
// - 进程内缓存 + mtime 失效检测：外部进程（如 CLI）改写后，Web 服务侧能立刻看到
// - 自己写入后主动刷新缓存 mtime，避免「自己触发自己重读」
//
// 这是**通用**存储：结构由 initialState() 决定。项目要加字段就改它，
// normalize 会自动给老数据补默认值——不需要写迁移脚本。
import fsp from 'node:fs/promises';
import { dirname } from 'node:path';
import { storePathFromEnv } from './paths.js';

// 项目自己的存储结构。改这里即可扩展，老数据由 normalize 自动补齐。
// settings 里的导航三项是**显示配置**：分组 / 隐藏 / 平铺顺序；theme 是色彩主题。
export function initialState() {
  return {
    version: 1,
    settings: { navGroups: [], navHidden: [], navOrder: [], theme: 'light' },
  };
}

let cache = null;
let cacheMtime = -1;

export function newId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export async function loadStore(explicitPath) {
  const p = explicitPath || storePathFromEnv();
  try {
    const st = await fsp.stat(p);
    if (cache && cacheMtime === st.mtimeMs) return cache;
    const raw = await fsp.readFile(p, 'utf8');
    cache = normalize(JSON.parse(raw));
    cacheMtime = st.mtimeMs;
    return cache;
  } catch {
    // 文件不存在或损坏：返回空结构（首次运行 / 允许外部修复后恢复）
    cache = normalize(null);
    cacheMtime = -1;
    return cache;
  }
}

export async function saveStore(next, explicitPath) {
  const p = explicitPath || storePathFromEnv();
  const data = normalize(next);
  await fsp.mkdir(dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, p);
  cache = data;
  try {
    cacheMtime = (await fsp.stat(p)).mtimeMs;
  } catch {
    cacheMtime = -1;
  }
  return data;
}

// 读-改-写事务：fn 直接修改传入的深拷贝 store；fn 抛错则不落盘。
// 这条语义很重要——半个事务写进磁盘比不写更糟。
export async function mutateStore(fn, explicitPath) {
  const cur = structuredClone(await loadStore(explicitPath));
  const result = fn(cur);
  await saveStore(cur, explicitPath);
  return result === undefined ? cur : result;
}

// 归一化：以 initialState() 为底，把已有数据合并上去。
// 新增字段自动获得默认值，因此**不需要迁移脚本**。
export function normalize(data) {
  const base = initialState();
  if (!data || typeof data !== 'object') return base;

  base.version = typeof data.version === 'number' ? data.version : base.version;
  if (data.settings && typeof data.settings === 'object') {
    base.settings = { ...base.settings, ...data.settings };
  }
  for (const [k, v] of Object.entries(data)) {
    if (k === 'version' || k === 'settings') continue;
    if (Array.isArray(v)) base[k] = v;
    else if (v && typeof v === 'object') base[k] = { ...(base[k] || {}), ...v };
    else base[k] = v;
  }
  return base;
}

// 测试与调试用：清掉进程内缓存，强制下次重读
export function clearCache() {
  cache = null;
  cacheMtime = -1;
}
