// Ditto 域的业务：读剪贴板历史库、导出图片、读当前剪贴板。
//
// 数据来源只有一个——Ditto 自己写的 SQLite 库。本模块**只读**它，
// 写操作只发生在「导出图片到目录」这一件事上（写新文件，不覆盖已有文件）。
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  withDb,
  listClips,
  listImages,
  listTexts,
  getClip,
  getText,
  getImageBlob,
  decodeDropFiles,
  stats,
  countClips,
  countImages,
} from '../../core/ditto-db.js';
import { parseSince, limitOf as limitArgOf, idOf as idArgOf, offsetOf, pageOf } from '../../core/ditto-args.js';
import { dibToPng, dibToBmp, parseDib } from '../../core/ditto-image.js';
import { readCurrentClipboard, cleanupClipboardTmp } from '../../core/clipboard-now.js';
import { EXPORT_DIR } from '../../core/paths.js';
import { badInput, notFound } from '../../core/errors/index.js';
import { fmtBytes, fmtTime, fmtStamp, printTable } from '../../core/format.js';

const DEFAULT_LIMIT = 20;
const DEFAULT_EXPORT_LIMIT = 10;

// ---- 参数归一 ----
// 归一逻辑在 core/ditto-args.js（纯函数、可单测），这里只把 ctx 里的字段递进去。

/** 条数上限。0 表示「全部」。 */
function limitOf(ctx, dflt = DEFAULT_LIMIT) {
  return limitArgOf(ctx.limit, dflt);
}

function idOf(ctx) {
  return idArgOf(ctx.id);
}

/**
 * 分页参数归一。
 *
 * `--page` 与 `--offset` 同时给时以 `--offset` 为准（更精确）。
 * 两者都不给 = 从最新一条开始（向后翻 = 更早的历史）。
 */
function pagingOf(ctx, dfltLimit) {
  const limit = limitArgOf(ctx.limit, dfltLimit);
  const explicitOffset = offsetOf(ctx.offset);
  const page = pageOf(ctx.page);
  const offset = explicitOffset > 0 ? explicitOffset : page ? (page - 1) * limit : 0;
  return { limit, page, offset };
}

/** 翻页信息（面板与 CLI 都要显示「第几页 / 共几页」） */
function pagingInfo({ limit, page, offset }, total) {
  const perPage = limit >= Number.MAX_SAFE_INTEGER ? total || 1 : limit;
  const pages = perPage > 0 ? Math.max(1, Math.ceil(total / perPage)) : 1;
  const current = page || (perPage > 0 ? Math.floor(offset / perPage) + 1 : 1);
  return { limit, offset, page: current, pages, total };
}

/** 目标文件已存在时不覆盖，加 -1 / -2 后缀。导出命令不该毁掉用户已有文件。 */
function uniquePath(target) {
  if (!existsSync(target)) return target;
  const ext = path.extname(target);
  const base = target.slice(0, -ext.length);
  for (let i = 1; i < 1000; i++) {
    const candidate = `${base}-${i}${ext}`;
    if (!existsSync(candidate)) return candidate;
  }
  throw badInput(`同名文件过多，无法生成新文件名: ${target}`);
}

// ---- 读命令 ----

/** 库位置与统计 */
export async function info() {
  return withDb((db, loc) => {
    const s = stats(db);
    return {
      status: 'ok',
      db: loc.path,
      source: loc.from,
      size: loc.size,
      mtime: loc.mtime ? loc.mtime.toISOString() : null,
      clips: s.clips,
      images: s.images,
      imageBytes: s.imageBytes,
      texts: s.texts,
      files: s.files,
      newest: s.newest,
      oldest: s.oldest,
    };
  });
}

/** 最近条目列表（支持翻页） */
export async function list(ctx) {
  const paging = pagingOf(ctx, DEFAULT_LIMIT);
  const since = parseSince(ctx.since);
  const type = ctx.type || 'all';
  return withDb((db) => {
    const items = listClips(db, { ...paging, type, since, includeGrouped: !!ctx['include-grouped'] });
    const total = countClips(db, { type, since, includeGrouped: !!ctx['include-grouped'] });
    return { status: 'ok', count: items.length, type, ...pagingInfo(paging, total), items };
  });
}

/** 最近图片条目（支持翻页） */
export async function images(ctx) {
  const paging = pagingOf(ctx, DEFAULT_LIMIT);
  const since = parseSince(ctx.since);
  return withDb((db) => {
    const items = listImages(db, { ...paging, since, includeGrouped: !!ctx['include-grouped'] });
    const total = countImages(db, { since, includeGrouped: !!ctx['include-grouped'] });
    return { status: 'ok', count: items.length, ...pagingInfo(paging, total), items };
  });
}

/** 最近文本内容（支持翻页） */
export async function texts(ctx) {
  const paging = pagingOf(ctx, DEFAULT_LIMIT);
  const since = parseSince(ctx.since);
  return withDb((db) => {
    const items = listTexts(db, { ...paging, since, includeGrouped: !!ctx['include-grouped'] });
    const total = countClips(db, { type: 'text', since, includeGrouped: !!ctx['include-grouped'] });
    return { status: 'ok', count: items.length, ...pagingInfo(paging, total), items };
  });
}

/** 单条详情 */
export async function show(ctx) {
  const id = idOf(ctx);
  return withDb((db) => {
    const clip = getClip(db, id);
    if (!clip) throw notFound(`没有 id=${id} 的条目`);
    const out = {
      status: 'ok',
      id: clip.id,
      date: clip.date,
      kind: clip.kind,
      formats: clip.formats,
      text: clip.text,
    };
    if (clip.kind === 'file') {
      out.files = clip.data.flatMap((d) => decodeDropFiles(d.data));
    } else if (clip.kind !== 'image') {
      out.content = getText(db, id) ?? clip.text;
    }
    return out;
  });
}

// ---- 图片二进制 ----

/**
 * 取一条图片并转成 PNG。
 *
 * 两端形态不同是**有意的**：HTTP 端要把字节直接发给浏览器（面板要显示缩略图），
 * CLI 端要把字节写成文件（给人拿走）。业务（读 blob → 解 DIB → 编 PNG）两端共用。
 *
 * @param ctx  入参（applySpec 之后）
 * @param meta run 的第二个参数，meta.transport 是 'cli' | 'http'
 */
export async function image(ctx, meta) {
  const id = idOf(ctx);
  const { blob, date } = await withDb((db) => {
    const c = getClip(db, id);
    return { blob: getImageBlob(db, id), date: c ? c.date : null };
  });
  if (!blob) throw notFound(`没有 id=${id} 的图片条目`);

  const head = parseDib(blob);
  const png = dibToPng(blob);

  if (meta && meta.transport === 'http') {
    return { __raw: { mime: 'image/png', body: png } };
  }

  const outDir = path.resolve(ctx.out || EXPORT_DIR);
  await fs.mkdir(outDir, { recursive: true });
  const dest = uniquePath(path.join(outDir, `clip-${id}-${fmtStamp(date)}.png`));
  await fs.writeFile(dest, png);
  return {
    status: 'ok',
    id,
    width: head.width,
    height: head.height,
    bytes: png.length,
    file: dest,
  };
}

// ---- 写命令（只写新文件，不覆盖） ----

/**
 * 把最近图片导出成 PNG / BMP。
 * 有 --dry-run：只报「将要写什么」，不落盘。
 */
export async function exportImages(ctx) {
  const limit = limitOf(ctx, DEFAULT_EXPORT_LIMIT);
  const since = parseSince(ctx.since);
  const format = ctx.format === 'bmp' ? 'bmp' : 'png';
  const outDir = path.resolve(ctx.out || EXPORT_DIR);
  const dryRun = !!ctx['dry-run'];

  const items = await withDb((db) => listImages(db, { limit, since }));
  if (!items.length) return { status: 'ok', count: 0, outDir, written: [], dryRun };

  if (dryRun) {
    return {
      status: 'ok',
      dryRun: true,
      outDir,
      count: items.length,
      planned: items.map((it) => ({
        id: it.id,
        date: it.date,
        sourceFormat: it.format,
        bytes: it.bytes,
        file: path.join(outDir, `clip-${it.id}-${fmtStamp(it.date)}.${format}`),
      })),
    };
  }

  await fs.mkdir(outDir, { recursive: true });
  const written = await withDb(async (db) => {
    const out = [];
    for (const it of items) {
      const blob = getImageBlob(db, it.id);
      if (!blob) continue;
      const buf = format === 'bmp' ? dibToBmp(blob) : dibToPng(blob);
      const dest = uniquePath(path.join(outDir, `clip-${it.id}-${fmtStamp(it.date)}.${format}`));
      await fs.writeFile(dest, buf);
      out.push({
        id: it.id,
        date: it.date,
        sourceFormat: it.format,
        bytes: buf.length,
        file: dest,
      });
    }
    return out;
  });

  return { status: 'ok', count: written.length, outDir, written };
}

// ---- 当前剪贴板 ----

/**
 * 读「当前」系统剪贴板（文本 / 图片 / 文件列表）。
 * 与历史无关：Windows 剪贴板只有一个槽位，一次性读取只能拿到当前值。
 */
export async function now(ctx) {
  const live = readCurrentClipboard({ keepImage: true });
  try {
    const out = { status: 'ok', text: live.text ?? null, files: live.files ?? [] };
    if (live.image) {
      out.image = { width: live.image.width, height: live.image.height };
      if (live.image.path) {
        const buf = await fs.readFile(live.image.path);
        out.image.bytes = buf.length;
        if (ctx.out) {
          const outDir = path.resolve(ctx.out);
          await fs.mkdir(outDir, { recursive: true });
          const dest = uniquePath(path.join(outDir, `clip-now-${fmtStamp(Math.floor(Date.now() / 1000))}.png`));
          await fs.writeFile(dest, buf);
          out.image.file = dest;
        }
      }
    }
    return out;
  } finally {
    cleanupClipboardTmp(live.tmpDir);
  }
}

// ---- CLI 渲染 ----

export function renderInfo(r) {
  return [
    `数据库   : ${r.db}`,
    `来源     : ${r.source}`,
    `大小     : ${fmtBytes(r.size)}（最后写入 ${r.mtime}）`,
    `条目     : ${r.clips} 条`,
    `图片     : ${r.images} 张 / ${fmtBytes(r.imageBytes)}`,
    `文本     : ${r.texts} 条`,
    `文件     : ${r.files} 条`,
    `时间跨度 : ${fmtTime(r.oldest)} → ${fmtTime(r.newest)}`,
  ].join('\n');
}

/** 翻页提示行（CLI 人读模式） */
function pagingLine(r) {
  if (!r.total) return '';
  return `第 ${r.page} / ${r.pages} 页 · 共 ${r.total} 条${r.offset ? `（已跳过 ${r.offset} 条）` : ''}`;
}

export function renderList(r) {
  if (!r.items.length) return '没有匹配的条目';
  const lines = [];
  printTable(
    ['ID', '时间', '类型', '大小', '格式', '预览'],
    r.items.map((x) => [x.id, fmtTime(x.date), x.kind, fmtBytes(x.bytes), x.formats.join('|'), x.text]),
    (s) => lines.push(s)
  );
  const p = pagingLine(r);
  if (p) lines.push('', p);
  return lines.join('\n');
}

export function renderImages(r) {
  if (!r.items.length) return '没有找到图片条目';
  const lines = [];
  printTable(
    ['ID', '时间', '格式', '大小'],
    r.items.map((x) => [x.id, fmtTime(x.date), x.format, fmtBytes(x.bytes)]),
    (s) => lines.push(s)
  );
  const p = pagingLine(r);
  if (p) lines.push('', p);
  return lines.join('\n');
}

export function renderTexts(r) {
  if (!r.items.length) return '没有找到文本条目';
  const head = pagingLine(r);
  const body = r.items.map((x) => `----- [${x.id}] ${fmtTime(x.date)} -----\n${x.text}`).join('\n\n');
  return head ? `${head}\n\n${body}` : body;
}

export function renderShow(r) {
  const head = `id=${r.id}  ${fmtTime(r.date)}  [${r.kind}]  格式: ${r.formats.join('|')}`;
  if (r.files) return [head, '文件:', ...r.files.map((f) => `  ${f}`)].join('\n');
  if (r.content !== undefined) return [head, '---', r.content, '---'].join('\n');
  return head;
}

export function renderImage(r) {
  return `图片已保存: ${r.file}（${r.width}x${r.height}，${fmtBytes(r.bytes)}）`;
}

export function renderExport(r) {
  if (r.dryRun) {
    const lines = [`将要导出 ${r.count} 张图片到 ${r.outDir}（dry-run，未落盘）`];
    for (const p of r.planned || []) lines.push(`  ${p.id}  ${fmtTime(p.date)}  ${fmtBytes(p.bytes)}  ${p.file}`);
    return lines.join('\n');
  }
  const lines = [`已导出 ${r.count} 张图片到 ${r.outDir}`];
  for (const w of r.written || []) lines.push(`  ${w.id}  ${fmtTime(w.date)}  ${fmtBytes(w.bytes)}  ${w.file}`);
  return lines.join('\n');
}

export function renderNow(r) {
  const lines = [];
  if (r.text) lines.push(r.text);
  if (r.image) {
    lines.push(`[图片] ${r.image.width}x${r.image.height}${r.image.file ? ` -> ${r.image.file}` : ''}`);
  }
  if (r.files?.length) lines.push(`[文件] ${r.files.join(', ')}`);
  if (!lines.length) lines.push('剪贴板是空的');
  return lines.join('\n');
}
