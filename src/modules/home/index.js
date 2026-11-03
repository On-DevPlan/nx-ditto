// 首页域：面板的落地页，同时承担「启动上下文 + 本机设置」两类职责。
// 新增功能域时照着这个文件的形状写即可。
//
// 为什么首页和设置合成一个模块：两者都是「关于这个应用本身」的内容——
// 启动上下文（bootstrap / 命令表 / 健康 / 存储）与本机设置（主题 / 头部导航）。
// 拆成两个模块，初始就凭空多出一个只有 meta 信息的空壳页；合成一个，出厂模块都有真实内容。
import * as service from './service.js';

export default {
  id: 'home',
  title: '首页',
  order: 1,
  view: () => import('./view.jsx'),
  actions: [
    {
      id: 'home.bootstrap',
      cli: ['bootstrap', 'show'],
      http: ['GET', '/api/bootstrap'],
      summary: '一次取齐面板启动所需的全部上下文',
      run: () => service.bootstrap(),
    },
    {
      id: 'home.routes',
      cli: ['routes'],
      http: ['GET', '/api/routes'],
      summary: '列出 CLI 命令与 HTTP 路由的对照表',
      run: async () => {
        const { commandTable } = await import('./commands.js');
        const table = await commandTable();
        return {
          status: 'ok',
          count: table.length,
          routes: table.map((c) => ({
            id: c.id,
            module: c.module,
            cli: c.command,
            http: c.http ? `${c.http.method} ${c.http.path}` : null,
            summary: c.summary,
          })),
        };
      },
      render: (r) => {
        const lines = [`共 ${r.count} 条命令（CLI ↔ HTTP 对照）`, ''];
        const width = Math.max(...r.routes.map((x) => x.cli.length));
        for (const x of r.routes) {
          lines.push('  ' + x.cli.padEnd(width + 2) + (x.http || '(仅 CLI)') + '   ' + (x.summary || ''));
        }
        return lines.join('\n');
      },
    },
    {
      id: 'home.health',
      cli: ['health'],
      http: ['GET', '/api/health'],
      summary: '自检：存储可读、命令表可生成',
      run: async () => {
        const { commandTable } = await import('./commands.js');
        const table = await commandTable();
        const b = await service.bootstrap();
        return {
          status: 'ok',
          app: b.app.name,
          version: b.app.version,
          storePath: b.storePath,
          commands: table.length,
        };
      },
      render: (r) =>
        `正常 · ${r.app} v${r.version} · ${r.commands} 条命令\n存储: ${r.storePath}`,
    },
    {
      id: 'home.store',
      cli: ['store', 'path'],
      http: ['GET', '/api/store'],
      summary: '显示存储路径（可用环境变量覆盖）',
      run: async () => {
        const b = await service.bootstrap();
        return { status: 'ok', path: b.storePath, default: b.storeDefault };
      },
      render: (r) => `${r.path}    （默认 ${r.default}）`,
    },
    {
      id: 'setting.get',
      cli: ['setting', 'get'],
      http: ['GET', '/api/settings'],
      summary: '读取全部设置（含头部导航分组 / 隐藏 / 平铺顺序）与页面清单',
      flags: {},
      run: () => service.getSettings(),
      render: (d) => service.renderSettings(d),
    },
    {
      id: 'setting.set',
      cli: ['setting', 'set'],
      http: ['PATCH', '/api/settings'],
      summary: '修改设置（PATCH 语义：只改传入的项）',
      flags: {
        key: { type: 'string', hint: '设置项名' },
        value: { type: 'string', hint: '取值' },
        set: { type: 'kv', hint: 'k=v，可重复（值可以是 JSON 数组，如 navGroups=[{...}]）' },
        'dry-run': { type: 'boolean' },
      },
      run: (ctx) => service.setSettings(ctx),
      render: (d) => service.renderSettingSet(d),
    },
  ],
};
