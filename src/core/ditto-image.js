// CF_DIB（BITMAPINFOHEADER 位图）→ PNG / BMP。
//
// 为什么需要这一层：Ditto 存的是**原始 CF_DIB**（BITMAPINFOHEADER + 像素），
// 不是 PNG/BMP。同一台机器上两种压缩方式混着出现：
//   BI_RGB (0)       像素区紧跟 40 字节头
//   BI_BITFIELDS (3) 像素区前面多 12 字节颜色掩码
// 两者像素区起点差 12 字节，写死偏移会解出花屏——所以按实际长度反推。
import zlib from 'node:zlib';

const BI_BITFIELDS = 3;

// ---- CRC32（PNG 分块校验） ----

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** RGBA8 像素 → PNG（color type 6，8bit，无隔行） */
export function encodePng(width, height, rgba) {
  const need = width * height * 4;
  if (!rgba || rgba.length < need) {
    // 不校验就会在 Buffer.copy 里炸成 RangeError——信息量全无，看不出是尺寸对不上
    throw new Error(`rgba 缓冲不足：需要 ${need} 字节，实际 ${rgba ? rgba.length : 0}`);
  }
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (None)
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- DIB 解析 ----

/**
 * 解析 DIB 头，算出像素区起点、宽高、位深、压缩方式。
 */
export function parseDib(buf) {
  if (!buf || buf.length < 40) throw new Error('DIB 太短，不是有效的 BITMAPINFOHEADER');
  const headerSize = buf.readUInt32LE(0);
  const width = buf.readInt32LE(4);
  const rawHeight = buf.readInt32LE(8);
  const bitCount = buf.readUInt16LE(14);
  const compression = buf.readUInt32LE(16);
  const clrUsed = buf.readUInt32LE(32);

  if (width <= 0 || rawHeight === 0) throw new Error(`DIB 尺寸异常: ${width}x${rawHeight}`);
  if (bitCount === 16) throw new Error('暂不支持 16bpp DIB');

  const height = Math.abs(rawHeight);
  const expected = width * height * (bitCount / 8);

  // 像素区起点：用实际长度反推（BI_BITFIELDS 掩码占 12 或 16 字节）
  const candidates = compression === BI_BITFIELDS ? [52, 56, 40] : [40, 52, 56];
  let pixelOffset = candidates.find((off) => buf.length - off === expected);
  if (pixelOffset === undefined) pixelOffset = candidates.find((off) => buf.length - off >= expected);
  if (pixelOffset === undefined) throw new Error(`像素区定位失败: len=${buf.length} expected=${expected}`);

  const rowStride = bitCount === 24 ? Math.ceil((width * 3) / 4) * 4 : Math.ceil((width * bitCount) / 8);

  return {
    headerSize,
    width,
    height,
    bottomUp: rawHeight > 0,
    bitCount,
    compression,
    clrUsed,
    pixelOffset,
    rowStride,
    masks: readMasks(buf, compression, pixelOffset),
  };
}

/**
 * 读 BI_BITFIELDS 的颜色掩码。
 *
 * 掩码区可能是 12 字节（RGB 三个）或 16 字节（再加一个 alpha）。
 * 哪个才是真的，取决于像素区起点：pixelOffset 56 → 有 alpha 掩码；
 * 52 → 只有 RGB 三个。
 *
 * 这个区分很重要：把 52 处的像素数据当成 alpha 掩码读，会得到一个
 * 「恰好等于 0xFF000000」的假掩码，于是整张图被当成带 alpha 的
 * BGRA 处理——透明像素全变透明，图直接看不见。
 */
function readMasks(buf, compression, pixelOffset) {
  if (compression !== BI_BITFIELDS || buf.length < 52) return null;
  const masks = {
    r: buf.readUInt32LE(40),
    g: buf.readUInt32LE(44),
    b: buf.readUInt32LE(48),
    a: 0,
  };
  if (pixelOffset >= 56 && buf.length >= 56) masks.a = buf.readUInt32LE(52);
  return masks;
}

function paletteFrom(buf, info) {
  const entries = info.clrUsed || (1 << info.bitCount);
  const off = info.headerSize;
  const pal = [];
  for (let i = 0; i < entries && off + i * 4 + 3 < buf.length; i++) {
    pal.push([buf[off + i * 4 + 2], buf[off + i * 4 + 1], buf[off + i * 4], buf[off + i * 4 + 3]]);
  }
  return pal;
}

/** DIB → RGBA8 像素缓冲 */
export function dibToRgba(buf) {
  const info = parseDib(buf);
  const { width, height, bottomUp, bitCount, compression, pixelOffset, rowStride } = info;
  const rgba = Buffer.alloc(width * height * 4);
  const useAlpha = compression === BI_BITFIELDS && info.masks && info.masks.a === 0xff000000;

  for (let y = 0; y < height; y++) {
    const srcRow = bottomUp ? height - 1 - y : y;
    let src = pixelOffset + srcRow * rowStride;
    let dst = y * width * 4;

    if (bitCount === 32) {
      for (let x = 0; x < width; x++) {
        rgba[dst] = buf[src + 2];
        rgba[dst + 1] = buf[src + 1];
        rgba[dst + 2] = buf[src];
        rgba[dst + 3] = useAlpha ? buf[src + 3] : 255;
        src += 4;
        dst += 4;
      }
    } else if (bitCount === 24) {
      for (let x = 0; x < width; x++) {
        rgba[dst] = buf[src + 2];
        rgba[dst + 1] = buf[src + 1];
        rgba[dst + 2] = buf[src];
        rgba[dst + 3] = 255;
        src += 3;
        dst += 4;
      }
    } else {
      const pal = paletteFrom(buf, info);
      const perByte = 8 / bitCount;
      for (let x = 0; x < width; x++) {
        const byte = buf[src + Math.floor(x / perByte)];
        const shift = 8 - bitCount * ((x % perByte) + 1);
        const idx = (byte >> shift) & ((1 << bitCount) - 1);
        const c = pal[idx] || [0, 0, 0, 255];
        rgba[dst] = c[0];
        rgba[dst + 1] = c[1];
        rgba[dst + 2] = c[2];
        rgba[dst + 3] = c[3] || 255;
        dst += 4;
      }
    }
  }
  return { width, height, rgba };
}

/** DIB → PNG Buffer */
export function dibToPng(buf) {
  const { width, height, rgba } = dibToRgba(buf);
  return encodePng(width, height, rgba);
}

/** DIB → BMP Buffer（补 BITMAPFILEHEADER，像素无损） */
export function dibToBmp(buf) {
  const info = parseDib(buf);
  const { height, bottomUp, bitCount, headerSize, pixelOffset, rowStride } = info;
  const paletteEntries = bitCount <= 8 ? (info.clrUsed || (1 << bitCount)) : 0;
  const paletteSize = paletteEntries * 4;
  const offset = 14 + headerSize + paletteSize;

  const out = Buffer.alloc(offset + rowStride * height);
  out.write('BM', 0, 'ascii');
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(offset, 10);
  buf.copy(out, 14, 0, headerSize);
  out.writeInt32LE(Math.abs(height), 14 + 8); // BMP 约定：正数 = 自下而上
  if (paletteSize > 0) buf.copy(out, 14 + headerSize, headerSize, headerSize + paletteSize);

  for (let y = 0; y < height; y++) {
    const srcRow = bottomUp ? y : height - 1 - y;
    buf.copy(out, offset + y * rowStride, pixelOffset + srcRow * rowStride, pixelOffset + srcRow * rowStride + rowStride);
  }
  return out;
}
