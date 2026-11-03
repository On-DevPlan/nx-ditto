// Ditto 剪贴板历史库（SQLite）只读访问。
//
// 库结构（来自 Ditto 源码 src/DatabaseUtilities.cpp 的 CreateDB）：
//   Main(lID, lDate, mText, bIsGroup, lParentID, clipOrder, ...)      条目元信息
//   Data(lID, lParentID, strClipBoardFormat, ooData BLOB)              每条目的各格式内容
// 顶层条目 = bIsGroup 0 且 lParentID = -1（被拖进分组的条目 lParentID 指向分组）。
//
// **只读**：本文件从不写库。Ditto 正在运行时读它完全安全（SQLite 允许并发读），
// 写入的一侧是 Ditto 自己。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { notFound } from './errors/index.js';
import { DITTO_DB_ENV, DITTO_DIR_NAME, DITTO_DB_NAME } from './paths.js';

// node:sqlite 在 Node 22 里仍是实验特性，会往 stderr 打 ExperimentalWarning。
// CLI 的输出契约是「stdout 是数据、stderr 是错误」，一行无关警告就会污染 agent 解析，
// 所以就地屏蔽这一条——导入完立刻恢复，别的警告照常冒出来。
const originalEmitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  const name = typeof warning === 'object' && warning ? warning.name : rest[0];
  const message = typeof warning === 'object' && warning ? warning.message : String(warning);
  if (name === 'ExperimentalWarning' && /SQLite/i.test(message)) return;
  return originalEmitWarning.call(process, warning, ...rest);
};
const { DatabaseSync } = await import('node:sqlite');
process.emitWarning = originalEmitWarning;

export const IMAGE_FORMATS = ['CF_DIB', 'CF_DIBV5', 'PNG', 'BITMAP'];
export const FILE_FORMATS = ['CF_HDROP'];
export const TEXT_FORMATS = ['CF_UNICODETEXT', 'CF_TEXT'];

const inList = (col, list) => `${col} IN (${list.map((v) => `'${v}'`).join(',')})`;

/**
 * 找到 Ditto 数据库。找不到就抛 NOT_FOUND——错误文案里带「不存在」，
 * agent 侧可据此分类（见 assets 的错误分类约定）。
 */
export function locateDb() {
  const override = process.env[DITTO_DB_ENV];
  const candidates = [];

  if (override) candidates.push({ path: override, from: `环境变量 ${DITTO_DB_ENV}` });
  const appdata = process.env.APPDATA;
  if (appdata) {
    candidates.push({ path: path.join(appdata, DITTO_DIR_NAME, DITTO_DB_NAME), from: '%APPDATA%\\Ditto' });
  }

  for (const c of candidates) {
    if (fs.existsSync(c.path)) return { ...c, ...statOf(c.path) };
  }

  // 便携版：找正在运行的 Ditto.exe，库在它旁边
  const portable = portableDb();
  if (portable) return portable;

  throw notFound(
    `Ditto 数据库不存在（查找顺序：${DITTO_DB_ENV} 环境变量 → %APPDATA%\\${DITTO_DIR_NAME}\\${DITTO_DB_NAME} → Ditto.exe 同目录）。` +
      '请先启动一次 Ditto 让它建库，或用 ' + DITTO_DB_ENV + ' 指定路径。'
  );
}

function portableDb() {
  try {
    const exe = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command',
        "(Get-Process Ditto -ErrorAction SilentlyContinue | Select-Object -First 1).Path"],
      { encoding: 'utf8', timeout: 10000, windowsHide: true }
    ).trim();
    if (!exe) return null;
    const p = path.join(path.dirname(exe), DITTO_DB_NAME);
    if (!fs.existsSync(p)) return null;
    return { path: p, from: `便携版（${exe} 同目录）`, ...statOf(p) };
  } catch {
    return null;
  }
}

function statOf(p) {
  const st = fs.statSync(p);
  return { size: st.size, mtime: st.mtime };
}

/** 只读打开 */
export function openDb(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

/**
 * 打开 → 跑 → 关闭。调用方拿不到 db 句柄，就没法写它。
 * 回调可以是 async：await 之后才关闭连接，所以回调里的异步写文件不会踩到已关闭的库。
 */
export async function withDb(fn) {
  const info = locateDb();
  const db = openDb(info.path);
  try {
    return await fn(db, info);
  } finally {
    db.close();
  }
}

function whereClause({ since, includeGrouped, type }) {
  const where = [];
  const params = [];
  if (!includeGrouped) where.push('m.bIsGroup = 0 AND m.lParentID = -1');
  if (since != null) {
    where.push('m.lDate >= ?');
    params.push(since);
  }
  if (type && type !== 'all') {
    const table =
      type === 'image' ? IMAGE_FORMATS : type === 'file' ? FILE_FORMATS : type === 'text' ? TEXT_FORMATS : null;
    if (table) {
      where.push(
        `EXISTS (SELECT 1 FROM Data d WHERE d.lParentID = m.lID AND ${inList('upper(d.strClipBoardFormat)', table)})`
      );
    }
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

/** 列出最近的剪贴板条目（只读格式名，不解 blob） */
export function listClips(db, opts = {}) {
  const { limit = 20, offset = 0, type = 'all', since = null, includeGrouped = false } = opts;
  const w = whereClause({ since, includeGrouped, type });
  const sql = `
    SELECT m.lID AS id, m.lDate AS date, m.bIsGroup AS isGroup, m.lParentID AS parentId,
           m.mText AS text,
           (SELECT group_concat(d.strClipBoardFormat, '|') FROM Data d WHERE d.lParentID = m.lID) AS formats,
           (SELECT max(length(d.ooData)) FROM Data d WHERE d.lParentID = m.lID) AS bytes
    FROM Main m
    ${w.sql}
    ORDER BY COALESCE(m.clipOrder, m.lDate) DESC
    LIMIT ? OFFSET ?`;
  const rows = db.prepare(sql).all(...w.params, limit, offset);
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    isGroup: r.isGroup === 1,
    parentId: r.parentId,
    text: r.text ?? '',
    formats: r.formats ? r.formats.split('|') : [],
    bytes: r.bytes ?? 0,
    kind: classify(r.formats),
  }));
}

/** 符合筛选条件的总条数（翻页器算页数用；与 listClips 用同一套 WHERE） */
export function countClips(db, opts = {}) {
  const { type = 'all', since = null, includeGrouped = false } = opts;
  const w = whereClause({ since, includeGrouped, type });
  return db.prepare(`SELECT count(*) AS c FROM Main m ${w.sql}`).get(...w.params).c;
}

/**
 * 列出图片条目（含 blob 字节数，不解像素）。
 *
 * 一个条目可能有多种图片格式（CF_DIB 与 PNG 并存），这里在 **SQL 层** 选定
 * 「blob 最大的那一份」再分页——否则同一个条目会占掉两行，LIMIT/OFFSET 会跳格。
 */
export function listImages(db, opts = {}) {
  const { limit = 20, offset = 0, since = null, includeGrouped = false } = opts;
  const where = [];
  const params = [];
  if (!includeGrouped) where.push('m.bIsGroup = 0 AND m.lParentID = -1');
  if (since != null) {
    where.push('m.lDate >= ?');
    params.push(since);
  }
  const sql = `
    SELECT m.lID AS id, m.lDate AS date, d.strClipBoardFormat AS format, length(d.ooData) AS bytes
    FROM Main m JOIN Data d ON d.lID = (
      SELECT d2.lID FROM Data d2
      WHERE d2.lParentID = m.lID AND ${inList('upper(d2.strClipBoardFormat)', IMAGE_FORMATS)}
      ORDER BY length(d2.ooData) DESC LIMIT 1)
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY COALESCE(m.clipOrder, m.lDate) DESC
    LIMIT ? OFFSET ?`;
  return db
    .prepare(sql)
    .all(...params, limit, offset)
    .map((r) => ({ id: r.id, date: r.date, format: r.format, bytes: r.bytes }));
}

/** 图片条目的总数 */
export function countImages(db, opts = {}) {
  const { since = null, includeGrouped = false } = opts;
  const where = [];
  const params = [];
  if (!includeGrouped) where.push('m.bIsGroup = 0 AND m.lParentID = -1');
  if (since != null) {
    where.push('m.lDate >= ?');
    params.push(since);
  }
  const exists = `EXISTS (SELECT 1 FROM Data d WHERE d.lParentID = m.lID AND ${inList('upper(d.strClipBoardFormat)', IMAGE_FORMATS)})`;
  const clause = [...where, exists].join(' AND ');
  return db.prepare(`SELECT count(*) AS c FROM Main m WHERE ${clause}`).get(...params).c;
}

/** 取某个条目的全部格式与 blob */
export function getClip(db, id) {
  const main = db
    .prepare('SELECT lID AS id, lDate AS date, bIsGroup AS isGroup, lParentID AS parentId, mText AS text FROM Main WHERE lID = ?')
    .get(id);
  if (!main) return null;
  const data = db.prepare('SELECT strClipBoardFormat AS format, ooData AS data FROM Data WHERE lParentID = ?').all(id);
  const formats = data.map((d) => d.format);
  return {
    id: main.id,
    date: main.date,
    isGroup: main.isGroup === 1,
    parentId: main.parentId,
    text: main.text ?? '',
    formats,
    kind: classify(formats.join('|')),
    data,
  };
}

/** 取图片 blob（node:sqlite 返回 Uint8Array，统一转 Buffer） */
export function getImageBlob(db, id) {
  const row = db
    .prepare(
      `SELECT d.ooData AS data FROM Data d WHERE d.lParentID = ? AND ${inList('upper(d.strClipBoardFormat)', IMAGE_FORMATS)} LIMIT 1`
    )
    .get(id);
  return row && row.data != null ? Buffer.from(row.data) : null;
}

/** 取文本（CF_UNICODETEXT 优先） */
export function getText(db, id) {
  const row = db
    .prepare("SELECT d.ooData AS data FROM Data d WHERE d.lParentID = ? AND upper(d.strClipBoardFormat) = 'CF_UNICODETEXT' LIMIT 1")
    .get(id);
  if (!row || row.data == null) return null;
  return decodeText(row.data);
}

/** 列出最近若干条文本条目 */
export function listTexts(db, opts = {}) {
  const { limit = 20, offset = 0, since = null, includeGrouped = false } = opts;
  const w = whereClause({ since, includeGrouped, type: 'text' });
  const sql = `
    SELECT m.lID AS id, m.lDate AS date, m.mText AS preview
    FROM Main m
    ${w.sql}
      AND EXISTS (SELECT 1 FROM Data d WHERE d.lParentID = m.lID AND upper(d.strClipBoardFormat) IN ('CF_UNICODETEXT','CF_TEXT'))
    ORDER BY COALESCE(m.clipOrder, m.lDate) DESC
    LIMIT ? OFFSET ?`;
  const ids = db.prepare(sql).all(...w.params, limit, offset);
  return ids.map((r) => ({ id: r.id, date: r.date, preview: r.preview ?? '', text: getText(db, r.id) ?? '' }));
}

/** CF_UNICODETEXT blob 是 UTF-16LE，尾部带一个 NUL */
export function decodeText(buf) {
  let s = Buffer.from(buf).toString('utf16le');
  while (s.endsWith('\u0000')) s = s.slice(0, -1);
  return s;
}

/** CF_HDROP blob → 文件路径数组（DROPFILES 结构 + UTF-16 双零结尾列表） */
export function decodeDropFiles(buf) {
  const b = Buffer.from(buf);
  if (b.length < 20) return [];
  const pFiles = b.readUInt32LE(0);
  if (pFiles < 20 || pFiles >= b.length) return [];
  return b
    .subarray(pFiles)
    .toString('utf16le')
    .split('\u0000')
    .filter((s) => s.length > 0);
}

function classify(formats) {
  if (!formats) return 'unknown';
  const set = new Set(formats.split('|').map((f) => f.toUpperCase()));
  if (IMAGE_FORMATS.some((f) => set.has(f))) return 'image';
  if (FILE_FORMATS.some((f) => set.has(f))) return 'file';
  if (TEXT_FORMATS.some((f) => set.has(f))) return 'text';
  if (set.has('HTML FORMAT')) return 'html';
  return 'other';
}

/** 库统计 */
export function stats(db) {
  const one = (sql) => db.prepare(sql).get();
  return {
    clips: one('SELECT count(*) AS c FROM Main').c,
    images: one(`SELECT count(*) AS c FROM Data WHERE ${inList('upper(strClipBoardFormat)', IMAGE_FORMATS)}`).c,
    imageBytes: one(`SELECT COALESCE(sum(length(ooData)),0) AS c FROM Data WHERE ${inList('upper(strClipBoardFormat)', IMAGE_FORMATS)}`).c,
    texts: one(`SELECT count(*) AS c FROM Data WHERE ${inList('upper(strClipBoardFormat)', TEXT_FORMATS)}`).c,
    files: one(`SELECT count(*) AS c FROM Data WHERE ${inList('upper(strClipBoardFormat)', FILE_FORMATS)}`).c,
    newest: one('SELECT max(lDate) AS t FROM Main').t,
    oldest: one('SELECT min(lDate) AS t FROM Main').t,
  };
}
