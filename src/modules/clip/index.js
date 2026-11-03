// Ditto 域：读 Ditto 剪贴板历史库 + 读当前剪贴板。
//
// 每条 action 同时声明 CLI 路径与 HTTP 路由，命令表 / 路由表 / help 全部由它派生。
// 读命令的过滤 flag **一律不带 default**——「不传」本身是一种有意义的输入
// （不限条数 / 不过滤），参数层若无条件注入默认值，那个分支就永远走不到。
import * as service from './service.js';

export default {
  id: 'clip',
  title: '剪贴板',
  order: 2,
  view: () => import('./view.jsx'),
  actions: [
    {
      id: 'clip.info',
      cli: ['clip', 'info'],
      http: ['GET', '/api/clip/info'],
      summary: 'Ditto 库位置与统计（条目数、图片数、最后写入时间）',
      run: () => service.info(),
      render: (r) => service.renderInfo(r),
    },
    {
      id: 'clip.list',
      cli: ['clip', 'list'],
      http: ['GET', '/api/clip/clips'],
      summary: '列出最近的剪贴板条目（可按类型与时间过滤，可翻页）',
      flags: {
        limit: { type: 'number', hint: '每页条数，0 表示全部' },
        offset: { type: 'number', hint: '跳过前 N 条' },
        page: { type: 'number', hint: '页码（1 起，与 --offset 二选一）' },
        type: { type: 'string', enum: ['all', 'text', 'image', 'file'], hint: '条目类型' },
        since: { type: 'string', hint: '时间过滤：30m / 2h / 3d / 1w / 2026-11-01' },
        'include-grouped': { type: 'boolean', hint: '把已归入 Ditto 分组的条目也算进来' },
      },
      run: (ctx) => service.list(ctx),
      render: (r) => service.renderList(r),
    },
    {
      id: 'clip.images',
      cli: ['clip', 'images'],
      http: ['GET', '/api/clip/images'],
      summary: '列出最近的图片条目（含原始 blob 字节数，可翻页）',
      flags: {
        limit: { type: 'number', hint: '每页条数，0 表示全部' },
        offset: { type: 'number', hint: '跳过前 N 条' },
        page: { type: 'number', hint: '页码（1 起，与 --offset 二选一）' },
        since: { type: 'string', hint: '时间过滤：30m / 2h / 3d / 1w / 2026-11-01' },
        'include-grouped': { type: 'boolean', hint: '把已归入 Ditto 分组的条目也算进来' },
      },
      run: (ctx) => service.images(ctx),
      render: (r) => service.renderImages(r),
    },
    {
      id: 'clip.text',
      cli: ['clip', 'text'],
      http: ['GET', '/api/clip/text'],
      summary: '导出最近的文本剪贴板内容（UTF-16LE 已解码，可翻页）',
      flags: {
        limit: { type: 'number', hint: '每页条数，0 表示全部' },
        offset: { type: 'number', hint: '跳过前 N 条' },
        page: { type: 'number', hint: '页码（1 起，与 --offset 二选一）' },
        since: { type: 'string', hint: '时间过滤：30m / 2h / 3d / 1w / 2026-11-01' },
        'include-grouped': { type: 'boolean', hint: '把已归入 Ditto 分组的条目也算进来' },
      },
      run: (ctx) => service.texts(ctx),
      render: (r) => service.renderTexts(r),
    },
    {
      id: 'clip.show',
      cli: ['clip', 'show'],
      http: ['GET', '/api/clip/clips/:id'],
      summary: '看一条目的内容（文本直接打印，文件列表展开）',
      args: ['id'],
      run: (ctx) => service.show(ctx),
      render: (r) => service.renderShow(r),
    },
    {
      id: 'clip.image',
      cli: ['clip', 'image'],
      http: ['GET', '/api/clip/image/:id'],
      summary: '取一条图片并转成 PNG（CLI 存成文件，面板拿字节显示缩略图）',
      args: ['id'],
      flags: {
        out: { type: 'string', hint: '输出目录（默认本项目导出目录）' },
      },
      // transport 在 run 的**第二个**参数里（第一个是 applySpec 后的入参）——
      // 把它当 ctx.transport 读会永远拿到 undefined，HTTP 端就会走错分支。
      run: (ctx, meta) => service.image(ctx, meta),
      render: (r) => service.renderImage(r),
    },
    {
      id: 'clip.export',
      cli: ['clip', 'export'],
      http: ['POST', '/api/clip/export'],
      summary: '把最近的图片导出成 PNG / BMP（只写新文件，不覆盖同名）',
      flags: {
        limit: { type: 'number', hint: '导出张数上限，0 表示全部' },
        since: { type: 'string', hint: '时间过滤：30m / 2h / 3d / 1w / 2026-11-01' },
        out: { type: 'string', hint: '输出目录（默认本项目导出目录）' },
        format: { type: 'string', enum: ['png', 'bmp'], default: 'png', hint: '导出格式' },
        'dry-run': { type: 'boolean', hint: '只报将要写什么，不落盘' },
      },
      run: (ctx) => service.exportImages(ctx),
      render: (r) => service.renderExport(r),
    },
    {
      id: 'clip.now',
      cli: ['clip', 'now'],
      http: ['GET', '/api/clip/now'],
      summary: '读「当前」系统剪贴板（文本 / 图片 / 文件列表，不是历史）',
      flags: {
        out: { type: 'string', hint: '把当前剪贴板里的图片存到该目录' },
      },
      run: (ctx) => service.now(ctx),
      render: (r) => service.renderNow(r),
    },
  ],
};
