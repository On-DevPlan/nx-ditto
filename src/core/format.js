// 终端输出格式化：CJK 宽字符对齐、时间与体积的可读写法。
//
// 为什么自己算宽度：剪贴板里的中文预览很常见，而中文占两列，
// 用 String.padEnd 对齐会让表格全歪——按显示宽度补空格才对得上。
const CJK = /[\u1100-\u115F\u2E80-\uA4CF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;

/** 字符串的显示宽度（CJK 算 2 列） */
export function width(str) {
  let w = 0;
  for (const ch of String(str ?? '')) w += CJK.test(ch) ? 2 : 1;
  return w;
}

/** 按显示宽度右侧补空格 */
export function pad(str, n) {
  const s = String(str ?? '');
  const diff = n - width(s);
  return diff > 0 ? s + ' '.repeat(diff) : s;
}

/** 截断到给定显示宽度（超出用 … 收尾） */
export function clip(str, n) {
  const s = String(str ?? '').replace(/\s+/g, ' ').trim();
  if (width(s) <= n) return s;
  let out = '';
  for (const ch of s) {
    if (width(out + ch) > n - 1) break;
    out += ch;
  }
  return out + '…';
}

/** Unix 秒 → 本地时间 */
export function fmtTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Unix 秒 → 文件名用的时间戳 */
export function fmtStamp(ts) {
  const d = new Date((ts || 0) * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 字节数 → 可读体积 */
export function fmtBytes(n) {
  if (n == null) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

/**
 * 打印一张表。末列不截断（留给可读的长文本），其余列按宽度裁剪。
 */
export function printTable(headers, rows, out = console.log) {
  const cells = rows.map((r) => r.map((c) => String(c ?? '')));
  const widths = headers.map((h, i) =>
    Math.max(width(h), ...cells.map((r) => width(r[i] ?? '')), 0)
  );
  const line = (row) =>
    row
      .map((c, i) => (i === row.length - 1 ? c : pad(clip(c, widths[i]), widths[i])))
      .join('  ');

  out(line(headers));
  out(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of cells) out(line(r));
}
