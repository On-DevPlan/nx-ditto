// 路径与安全校验：项目里所有「东西放哪」都从这里取，不在别处拼字符串。
//
// ⚠️ 本文件是生成器的**参数化中心**——新项目由模板生成时，只有这里的
// nx-ditto / nx-ditto / Ditto 剪贴板历史工具：只读 Ditto SQLite 库，CLI 与 Web 面板同源 / 7883 被替换，其余文件一律引用这些常量。
// 要加新常量请加在这里，不要在别处写字符串字面量。
import { homedir } from 'node:os';
import { join } from 'node:path';
import { badInput } from './errors/index.js';

// ---- 项目标识 ----
export const APP_NAME = 'nx-ditto';
export const APP_TITLE = 'nx-ditto';
export const APP_DESC = 'Ditto 剪贴板历史工具：只读 Ditto SQLite 库，CLI 与 Web 面板同源';

// ---- 数据目录（用户主目录下，可用环境变量覆盖）----
export const APP_DIR = join(homedir(), '.nx-ditto');
export const STORE_PATH = join(APP_DIR, 'store.json');

// ---- Ditto 剪贴板历史库 ----
// 库路径查找顺序：环境变量 → %APPDATA%\Ditto\Ditto.db → 便携版（与 Ditto.exe 同目录）。
// 环境变量可覆盖：测试与「同时装了多个 Ditto」的机器靠它指到别的库。
export const DITTO_DB_ENV = 'NX_DITTO_DB';
export const DITTO_DIR_NAME = 'Ditto';
export const DITTO_DB_NAME = 'Ditto.db';

// 导出目录：CLI 与面板共用同一个默认落点，避免两端写去不同地方。
export const EXPORT_DIR = join(APP_DIR, 'exports');

// ---- 端口 ----
// serve 的 HTTP 端口。vite dev server 的端口在 vite.config.js 里单独配。
export const DEFAULT_PORT = 7883;

// 测试必须能指向临时目录，否则会写脏用户的真实数据。
export const STORE_ENV = 'NX_DITTO_STORE';

export function storePathFromEnv() {
  return process.env[STORE_ENV] || STORE_PATH;
}

// ---- 输入校验 ----
//
// 名称与路径分开校验：名称禁前导点（`.foo` 不像个名字），
// 路径允许（`.gitignore` 是完全正常的文件）。
// 早期把两者混用一套规则，结果拒绝了 `.gitignore`。
export function assertSafeName(name, label = '名称') {
  if (!name || typeof name !== 'string') throw badInput(`${label}不能为空`);
  if (/[\\/]/.test(name) || name.includes('..') || name.startsWith('.')) {
    throw badInput(`非法 ${label}: ${name}`);
  }
  return name;
}

export function assertSafeRelPath(input, { label = '文件路径', allowSubdir = true } = {}) {
  if (!input || typeof input !== 'string') throw badInput(label + '不能为空');
  if (/^([a-zA-Z]:|[\\/])/.test(input)) throw badInput(label + '必须是相对路径: ' + input);
  const segments = input.split(/[\\/]+/).filter((x) => x !== '' && x !== '.');
  if (!segments.length) throw badInput('非法 ' + label + ': ' + input);
  if (segments.includes('..')) throw badInput(label + '不得包含 ..: ' + input);
  if (!allowSubdir && segments.length > 1) {
    throw badInput(label + '不能包含路径分隔符: ' + input);
  }
  return segments.join('/');
}
