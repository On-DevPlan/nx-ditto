// 剪贴板域的纯逻辑单测：不依赖本机是否装了 Ditto，CI 上也能跑。
//
// 覆盖三块：
//   1. 参数归一（core/ditto-args.js）—— CLI 与 HTTP 两端共用
//   2. DIB → PNG/BMP（core/ditto-image.js）—— 用合成位图，不碰真实库
//   3. 终端格式化（core/format.js）—— CJK 对齐
import assert from 'node:assert/strict';
import { test } from 'node:test';
import zlib from 'node:zlib';

import { parseSince, limitOf, idOf, offsetOf, pageOf } from '../../src/core/ditto-args.js';
import { dibToPng, dibToBmp, parseDib, encodePng } from '../../src/core/ditto-image.js';
import { width, pad, clip, fmtBytes, fmtStamp } from '../../src/core/format.js';

// ---- 合成 DIB ----

// 造一个 2x2 的 32bpp 位图。像素按 BGRA 存，行序自下而上（biHeight > 0）。
// 期望的显示结果：上行 红绿，下行 蓝白。
const PIXELS_TOP = [
  [0, 0, 255, 255], // 红
  [0, 255, 0, 255], // 绿
];
const PIXELS_BOTTOM = [
  [255, 0, 0, 255], // 蓝
  [255, 255, 255, 255], // 白
];

function buildDib({ compression = 0, withAlphaMask = false } = {}) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(2, 4); // biWidth
  header.writeInt32LE(2, 8); // biHeight（正数 = 自下而上）
  header.writeUInt16LE(1, 12); // biPlanes
  header.writeUInt16LE(32, 14); // biBitCount
  header.writeUInt32LE(compression, 16);
  header.writeUInt32LE(16, 20); // biSizeImage

  const rows = [...PIXELS_BOTTOM, ...PIXELS_TOP]; // 文件里先放底行
  const pixels = Buffer.concat(rows.map((row) => Buffer.from(row.flat())));

  if (compression !== 3) return Buffer.concat([header, pixels]);

  // BI_BITFIELDS：头后面跟掩码区（RGB 三个，或再加 alpha 一个）
  const masks = Buffer.alloc(withAlphaMask ? 16 : 12);
  masks.writeUInt32LE(0x00ff0000, 0); // R
  masks.writeUInt32LE(0x0000ff00, 4); // G
  masks.writeUInt32LE(0x000000ff, 8); // B
  if (withAlphaMask) masks.writeUInt32LE(0xff000000, 12); // A
  return Buffer.concat([header, masks, pixels]);
}

// ---- PNG 解包（只为断言像素） ----

function decodePng(buf) {
  assert.ok(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'PNG 签名不对');
  let off = 8;
  let ihdr = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9] };
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = ihdr.width * 4;
  const pixels = [];
  for (let y = 0; y < ihdr.height; y++) {
    assert.equal(raw[y * (stride + 1)], 0, '扫描行 filter 字节应为 0');
    pixels.push([...raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))]);
  }
  return { ...ihdr, pixels };
}

// ---- 1. 参数归一 ----

test('parseSince：相对时长 / 日期 / 时间戳', () => {
  const now = Math.floor(Date.now() / 1000);
  assert.ok(Math.abs(parseSince('30m') - (now - 1800)) <= 2);
  assert.ok(Math.abs(parseSince('2h') - (now - 7200)) <= 2);
  assert.ok(Math.abs(parseSince('3d') - (now - 259200)) <= 2);
  assert.equal(parseSince('1700000000'), 1700000000);
  assert.equal(parseSince(''), null);
  assert.equal(parseSince(undefined), null);
  assert.ok(Math.abs(parseSince('2026-11-01') - Date.parse('2026-11-01T00:00:00') / 1000) <= 1);
});

test('parseSince：非法输入报错而不是默默返回 undefined', () => {
  assert.throws(() => parseSince('昨天'), /无法解析时间过滤/);
});

test('limitOf：0 表示全部，缺省走默认值，负数报错', () => {
  assert.equal(limitOf(undefined, 20), 20);
  assert.equal(limitOf(5, 20), 5);
  assert.equal(limitOf('7', 20), 7);
  assert.equal(limitOf(0, 20), Number.MAX_SAFE_INTEGER);
  assert.throws(() => limitOf(-1, 20), /非负数字/);
});

test('idOf：只接受正整数', () => {
  assert.equal(idOf('34582'), 34582);
  assert.equal(idOf(12), 12);
  assert.throws(() => idOf('abc'), /正整数/);
  assert.throws(() => idOf(0), /正整数/);
  assert.throws(() => idOf(-3), /正整数/);
  assert.throws(() => idOf(1.5), /正整数/);
});

// ---- 分页参数 ----

test('offsetOf：不传 = 0；负数报错', () => {
  assert.equal(offsetOf(undefined), 0);
  assert.equal(offsetOf(null), 0);
  assert.equal(offsetOf(''), 0);
  assert.equal(offsetOf(0), 0);
  assert.equal(offsetOf('40'), 40);
  assert.throws(() => offsetOf(-1), /非负整数/);
});

test('pageOf：不传 = null；必须是 ≥1 的整数', () => {
  assert.equal(pageOf(undefined), null);
  assert.equal(pageOf(''), null);
  assert.equal(pageOf(1), 1);
  assert.equal(pageOf('3'), 3);
  assert.throws(() => pageOf(0), /大于 0/);
  assert.throws(() => pageOf(-2), /大于 0/);
  assert.throws(() => pageOf(1.5), /大于 0/);
});

// ---- 2. DIB → PNG ----

test('DIB(BI_RGB 32bpp) → PNG：像素正确且行序已翻转', () => {
  const png = dibToPng(buildDib());
  const { width: w, height: h, depth, color, pixels } = decodePng(png);
  assert.equal(w, 2);
  assert.equal(h, 2);
  assert.equal(depth, 8);
  assert.equal(color, 6); // RGBA
  assert.deepEqual(pixels[0].slice(0, 4), [255, 0, 0, 255], '上行第一个像素应是红');
  assert.deepEqual(pixels[0].slice(4, 8), [0, 255, 0, 255], '上行第二个像素应是绿');
  assert.deepEqual(pixels[1].slice(0, 4), [0, 0, 255, 255], '下行第一个像素应是蓝');
  assert.deepEqual(pixels[1].slice(4, 8), [255, 255, 255, 255], '下行第二个像素应是白');
});

test('DIB(BI_BITFIELDS，只有 3 个掩码) → PNG：像素区起点是 52 且不透明', () => {
  const dib = buildDib({ compression: 3 });
  const info = parseDib(dib);
  assert.equal(info.pixelOffset, 52, 'BI_BITFIELDS 的像素区应在 12 字节掩码之后');
  assert.equal(info.masks.a, 0, '只有 3 个掩码时不应把像素数据当成 alpha 掩码');

  const { pixels } = decodePng(dibToPng(dib));
  assert.deepEqual(pixels[0].slice(0, 4), [255, 0, 0, 255], '像素应与 BI_RGB 情况一致');
  assert.deepEqual(pixels[1].slice(4, 8), [255, 255, 255, 255]);
});

test('DIB(BI_BITFIELDS，带 alpha 掩码) → PNG：像素区起点是 56 且用上 alpha', () => {
  const dib = buildDib({ compression: 3, withAlphaMask: true });
  const info = parseDib(dib);
  assert.equal(info.pixelOffset, 56);
  assert.equal(info.masks.a, 0xff000000);

  const { pixels } = decodePng(dibToPng(dib));
  assert.deepEqual(pixels[0].slice(0, 4), [255, 0, 0, 255]);
});

test('DIB → BMP：带 BITMAPFILEHEADER，像素行序正确', () => {
  const bmp = dibToBmp(buildDib());
  assert.equal(bmp.toString('ascii', 0, 2), 'BM');
  assert.equal(bmp.readUInt32LE(2), bmp.length, '文件大小字段应等于实际长度');
  assert.equal(bmp.readInt32LE(18), 2, '宽度');
  assert.equal(bmp.readInt32LE(22), 2, '高度（正数 = 自下而上）');
  // BMP 像素区起点：14 + 40
  const px = bmp.subarray(54, 54 + 8);
  assert.deepEqual([...px.subarray(0, 4)], [255, 0, 0, 255], 'BMP 第一行是底行 = 蓝');
});

test('encodePng：像素缓冲不足时给清晰报错', () => {
  assert.throws(() => encodePng(2, 2, Buffer.alloc(4)), /rgba 缓冲不足/);
  assert.throws(() => encodePng(2, 2, null), /rgba 缓冲不足/);
});

// ---- 3. 终端格式化 ----

test('width/pad：中文按两列算', () => {
  assert.equal(width('abc'), 3);
  assert.equal(width('剪贴板'), 6);
  assert.equal(width('a剪'), 3);
  // 补的是「空格个数」，字符串长度不等于显示宽度——中文场景下两者不同
  assert.equal(pad('剪贴板', 10).length, 7);
  assert.equal(width(pad('剪贴板', 10)), 10);
});

test('clip：超宽截断并以 … 收尾', () => {
  assert.equal(clip('abcdefgh', 5), 'abcd…');
  assert.equal(clip('abc', 10), 'abc');
  assert.equal(clip('多行\n文本', 10), '多行 文本');
});

test('fmtBytes / fmtStamp', () => {
  assert.equal(fmtBytes(512), '512 B');
  assert.equal(fmtBytes(2048), '2.0 KB');
  assert.equal(fmtBytes(5 * 1048576), '5.0 MB');
  assert.match(fmtStamp(1793637103), /^\d{8}-\d{6}$/);
});
