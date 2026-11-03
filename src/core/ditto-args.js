// Ditto 命令的输入归一：纯逻辑，不碰文件系统与数据库。
//
// 放在 core 是因为它是**平台无关的纯函数**：CLI 与 HTTP 两端都走这里，
// 一端改了另一端不会分叉；也能在 CI 上直接单测（不依赖本机装了 Ditto）。
import { badInput } from './errors/index.js';

/**
 * 解析 --since 时间过滤。支持相对时长（30m / 2h / 3d / 1w）、日期（2026-11-01）
 * 与 Unix 时间戳；返回 Unix 秒。空值表示不过滤。
 */
export function parseSince(value) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).trim();

  const rel = /^(\d+)\s*([smhdw])$/i.exec(s);
  if (rel) {
    const mult = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[rel[2].toLowerCase()];
    return Math.floor(Date.now() / 1000) - Number(rel[1]) * mult;
  }
  if (/^\d+$/.test(s)) return Number(s);

  const normalized = s.includes('T') ? s : s.replace(/\//g, '-');
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(normalized) ? `${normalized}T00:00:00` : normalized);
  if (Number.isNaN(t)) throw badInput(`无法解析时间过滤: ${s}（支持 30m / 2h / 3d / 1w / 2026-11-01 / Unix 时间戳）`);
  return Math.floor(t / 1000);
}

/**
 * 条数上限。0 表示「全部」（放大到极大值，交给查询层截断）。
 * 不传 → 用调用方给的默认值。
 */
export function limitOf(value, dflt) {
  if (value === undefined || value === null) return dflt;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw badInput('用法: --limit 需要是非负数字（0 表示全部）');
  return n === 0 ? Number.MAX_SAFE_INTEGER : Math.floor(n);
}

/** 条目 id：正整数 */
export function idOf(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw badInput('用法: nx-ditto clip show <id> —— id 必须是正整数');
  }
  return n;
}

/**
 * 偏移量（跳过的条数）。不传 = 0（从最新一条开始）。
 */
export function offsetOf(value) {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw badInput('用法: --offset 需要是非负整数');
  return Math.floor(n);
}

/** 页码（1 起）。不传 = null（不按页翻）。 */
export function pageOf(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw badInput('用法: --page 需要是大于 0 的整数');
  return n;
}
