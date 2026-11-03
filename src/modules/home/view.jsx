// 首页视图：面板的落地页，把「项目概览 + 本机设置」放在同一页。
//
// 它示范了三件事，照着改就能长出你自己的面板：
//   1. 数据从 /api 拉（不是硬编码），失败有兜底
//   2. 每个 Web 操作都配一行等价的 CLI 命令，两端不会分叉
//   3. 用 .card / .row / .tag 这些原子类，不自己写样式
//
// 页面分两部分：上半是项目概览（项目信息、CLI↔HTTP 路由表），
// 下半是本机设置（外观主题、栏目管理）。主题点击即保存；栏目管理一页一保存。
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../web/frontend/api/client.js';
import { CliHints } from '../../web/frontend/components/CliHints.jsx';
import { useStore } from '../../web/frontend/store.jsx';
import { useGuard, useToast } from '../../web/frontend/components/ui.jsx';
import { ThemePicker } from '../../web/frontend/components/theme.jsx';
import * as nav from '../../web/frontend/components/navModel.js';
import NavManager from './navManager.jsx';

// 面板里也把 CLI 等价写法亮出来（agent 与人都能照着敲）
const NAV_CLI_HINT = "nx-ditto setting set --set 'navGroups=[{\"title\":\"求职\",\"views\":[\"home\"]}]'"
  + ' / --set navHidden=home / --set navOrder=["home"]';

export default function HomeView() {
  const { boot, settings, refreshSettings } = useStore();
  const toast = useToast();
  const guard = useGuard();

  const [routes, setRoutes] = useState(null);
  const [err, setErr] = useState('');

  // 栏目管理的工作副本（编辑都在副本上，放弃即丢弃）
  const [cfg, setCfg] = useState(nav.emptyConfig());
  const [baseline, setBaseline] = useState(nav.emptyConfig());

  useEffect(() => {
    api('/api/routes')
      .then((r) => setRoutes(r))
      .catch((e) => setErr(String(e.message || e)));
  }, []);

  const sections = useMemo(
    () => (settings?.views || []).map((v) => ({ id: v.id, title: v.title })),
    [settings],
  );
  const allIds = useMemo(() => sections.map((s) => s.id), [sections]);

  // 后端配置 → 工作副本
  useEffect(() => {
    if (!settings) return;
    const next = nav.configFromSettings(settings.settings);
    setCfg(next);
    setBaseline(next);
  }, [settings]);

  const problems = useMemo(() => nav.validate(cfg, allIds), [cfg, allIds]);
  const dirty = nav.isDirty(cfg, baseline);

  // useGuard 是「跑一次并兜错」（不是包装器）：直接调用它，失败的 toast 由它统一发
  const save = () => guard(async () => {
    if (problems.length) { toast(`保存失败：${problems[0].message}`); return; }
    await api('/api/settings', { method: 'PATCH', body: { set: nav.configToPayload(cfg) } });
    await refreshSettings();
    toast('设置已保存');
  });

  const discard = () => setCfg(structuredClone(baseline));

  if (err) return <div className="empty bad">接口调用失败：{err}</div>;

  return (
    <div className="stack">
      {/* ① 项目概览 */}
      <div className="card">
        <div className="colhead">项目信息</div>
        <dl className="kv">
          <div className="kv-row">
            <dt>名称</dt>
            <dd className="mono">{boot?.app?.name || '—'}</dd>
          </div>
          <div className="kv-row">
            <dt>版本</dt>
            <dd className="mono">{boot?.app?.version || '—'}</dd>
          </div>
          <div className="kv-row">
            <dt>存储</dt>
            <dd className="mono nowrap">{boot?.storePath || '—'}</dd>
          </div>
          <div className="kv-row">
            <dt>默认路径</dt>
            <dd className="mono nowrap">{boot?.storeDefault || '—'}</dd>
          </div>
        </dl>
      </div>

      <div className="card">
        <div className="colhead">
          <span>CLI 命令与 HTTP 路由（同源）</span>
          <span className="tag">{routes ? routes.count : '…'} 条</span>
        </div>
        {(routes?.routes || []).map((r) => (
          <div key={r.id} className="row">
            <div className="name mono">{r.cli}</div>
            <div className="desc mono muted">{r.http || '(仅 CLI)'}</div>
            <div className="acts">
              <span className="tag">{r.module}</span>
            </div>
          </div>
        ))}
        {routes && !routes.routes.length && <div className="empty">暂无命令</div>}
        <CliHints command="nx-ditto routes" note="这两张表由同一份 action 声明派生" />
      </div>

      {/* ② 本机设置：外观 */}
      <div className="card">
        <div className="colhead">
          外观
          <span className="right muted">色彩主题 · 点击即保存</span>
        </div>
        <div style={{ padding: 12 }} className="stack">
          <div className="toolbar">
            <ThemePicker />
            <span className="muted">
              浅色 / 深色 / 跟随系统（深色下自动切换为暗色 token）；CLI 等价：
              <code>{'nx-ditto setting set --key theme --value dark'}</code>
            </span>
          </div>
        </div>
      </div>

      {/* ② 本机设置：栏目管理 */}
      <div className="card">
        <div className="colhead">
          栏目管理
          <span className="right muted">
            头部显示 {allIds.length - cfg.hidden.length} 个 · 隐藏 {cfg.hidden.length} 个
            {cfg.groups.length ? ` · ${cfg.groups.length} 个分组` : ''}
          </span>
        </div>
        <div style={{ padding: 12 }} className="stack">
          <div className="toolbar">
            <span className="muted">
              拖动就是把结构摆成你要的样子：页面可以拖进分组、组内换位、拖回平铺区即移出；拖分组把手换分组顺序。
              被隐藏的页面只是头部不显示入口，用 <code>#/页面id</code> 直达仍然可用。
            </span>
            <span className="right rowgap">
              {dirty ? (
                <>
                  <span className="tag">有未保存的改动</span>
                  <button className="btn small" onClick={() => { void save(); }}>保存</button>
                  <button className="btn small ghost" onClick={discard}>放弃改动</button>
                </>
              ) : <span className="muted">已保存</span>}
            </span>
          </div>
          <NavManager sections={sections} value={cfg} onChange={setCfg} />
          {problems.map((p) => <div key={p.field} className="bad">· {p.message}</div>)}
        </div>
      </div>

      <div className="muted" style={{ padding: '0 2px' }}>
        CLI 等价：<code>{NAV_CLI_HINT}</code>
      </div>
    </div>
  );
}
