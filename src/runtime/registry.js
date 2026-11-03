// 模块注册表：所有功能域的 action 在此汇合。
//
// CLI 命令表、HTTP 路由表、help 文本三者全部由此派生 —— 这是
// 「Web 上每个操作都有等价 CLI 命令」得以成为**结构性保证**而非口头约定的原因：
// 一条 action 同时声明 cli 与 http，二者写在同一处，不可能分叉。
//
// 新增功能域只需两步：
//   1. 写 src/modules/<name>/（index.js 声明 actions，service.js 写业务，view.jsx 写面板）
//   2. 在下面 import 并加进 MODULES；再到 web/frontend/registry.js 登记视图
import { cliPathsOf } from './spec.js';
import home from '../modules/home/index.js';
import skill from '../modules/skill/index.js';
import clip from '../modules/clip/index.js';

export const MODULES = [home, skill, clip].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

export const ACTIONS = MODULES.flatMap((m) =>
  (m.actions || []).map((a) => ({ ...a, module: m.id }))
);

// 装载期自检：把「两个模块声明了同名命令」这类问题暴露在启动瞬间，
// 而不是等某个用户敲到那条命令时才发现。
//
// 方向性约定（刻意的不对称）：
//   - 每条 action 都必须有 cli —— 保证「Web 上能做的，CLI 都能做」
//   - 有 http 才谈得上 Web 入口；http: null 只留给两类：
//       a) 豁免前缀（serve / server / skill —— 天然是 CLI 侧能力）
//       b) 显式 web: false（这个操作就是不给面板入口）
//     其余 http: null 一律视为漏声明，启动即失败（与 eslint 的 local/action-parity 同规）
//   - 不允许声明 http 却没有 cli，也不允许 http 与 web: false 同时出现
//
// 豁免前缀必须与 eslint.config.js 里 local/action-parity 的 cliOnlyPrefixes 一致，
// tests/unit/registry.test.mjs 会对账。
export const CLI_ONLY_PREFIXES = ['serve', 'server', 'skill'];

const seenIds = new Set();
const seenCli = new Set();
const seenHttp = new Set();
for (const a of ACTIONS) {
  if (seenIds.has(a.id)) throw new Error('action id 重复: ' + a.id);
  seenIds.add(a.id);

  const paths = cliPathsOf(a);
  if (!paths.length) throw new Error(`action 没有声明 CLI 命令（Web 操作必须有 CLI 等价）: ${a.id}`);
  for (const path of paths) {
    const key = path.join(' ');
    if (seenCli.has(key)) throw new Error(`CLI 命令重复: ${key}（action ${a.id}）`);
    seenCli.add(key);
  }

  if (a.http) {
    const httpKey = a.http[0] + ' ' + a.http[1];
    if (seenHttp.has(httpKey)) throw new Error(`HTTP 路由重复: ${httpKey}（action ${a.id}）`);
    seenHttp.add(httpKey);
    if (a.web === false) {
      throw new Error(`action 同时声明了 http 与 web: false，语义冲突: ${a.id}`);
    }
  } else if (a.http === null) {
    const segment = paths[0][0];
    if (a.web !== false && !CLI_ONLY_PREFIXES.includes(segment)) {
      throw new Error(
        `action 没有声明 HTTP 路由（CLI 与 Web 必须成对；纯 CLI 请显式 web: false 或使用豁免前缀）: ${a.id}`
      );
    }
  } else {
    throw new Error(`action 的 http 必须是路由数组或显式 null: ${a.id}`);
  }

  if (!a.run) throw new Error(`action 缺少 run: ${a.id}`);
}
