// 面板壳：tab 导航 + 当前视图。
//
// 这一层**只做投影**，不认识任何业务：
//   有哪些页面   ← 后端 core/views.js（随 /api/settings 发来）
//   页面组件     ← ./registry.js 的 COMPONENTS（id → 懒加载组件）
//   怎么摆/显不显示 ← settings.navGroups / navHidden / navOrder（在首页里改）
// 于是「收拢分组、隐藏不常用的页、平铺排序」全是配置，壳不用动。
//
// 隐藏只隐藏**入口**：`#/被隐藏的页` 直达仍然渲染（不删功能）。
import { Suspense, useEffect, useRef, useState } from 'react';
import { COMPONENTS } from './registry.js';
import { useStore } from './store.jsx';
import { ErrorBoundary } from './components/ui.jsx';
import { ThemeToggle, currentTheme } from './components/theme.jsx';

function viewFromHash() {
  const h = location.hash.replace(/^#\/?/, '');
  return h || '';
}

export default function App() {
  const { ui, patchUi, boot, refreshBoot, settings } = useStore();

  const views = settings?.views ?? [];
  const hidden = new Set(settings?.settings.navHidden ?? []);

  // 分组：成员按配置顺序，隐藏的成员在入口里不出现；成员全被隐藏的组不显示
  const groups = (settings?.settings.navGroups ?? [])
    .map((g) => ({
      title: g.title,
      views: g.views.map((id) => views.find((v) => v.id === id)).filter(Boolean).filter((v) => !hidden.has(v.id)),
    }))
    .filter((g) => g.views.length);
  const grouped = new Set(groups.flatMap((g) => g.views.map((v) => v.id)));
  // 平铺顺序：settings.navOrder 里显式排过的优先（按它的次序），其余按页面自己的 order 跟在后面
  const rank = new Map((settings?.settings.navOrder ?? []).map((id, i) => [id, i]));
  const rankOf = (v) => (rank.has(v.id) ? rank.get(v.id) : Number.MAX_SAFE_INTEGER);
  const flat = views.filter((v) => !hidden.has(v.id) && !grouped.has(v.id))
    .sort((a, b) => rankOf(a) - rankOf(b) || a.order - b.order);

  // 当前视图：直接按 id 找（**包括隐藏的页**——深链要用），找不到再退回第一个可见页
  const current = views.find((v) => v.id === ui.view) || views.find((v) => !hidden.has(v.id)) || views[0];
  const CurrentComp = current ? COMPONENTS[current.id] : undefined;
  const appName = boot?.app?.name || 'nx-ditto';

  // 窗口聚焦时刷新 bootstrap：别的终端改了状态，这里能看到。
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') refreshBoot().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refreshBoot]);

  // 启动时把 hash 同步进 store；后续切换时也回写 hash（可分享、可后退）
  useEffect(() => {
    const fromHash = viewFromHash();
    if (fromHash && fromHash !== ui.view) patchUi({ view: fromHash });
    else if (!location.hash && ui.view) location.hash = '#/' + ui.view;
  }, []);

  useEffect(() => {
    if (ui.view) location.hash = '#/' + ui.view;
  }, [ui.view]);

  useEffect(() => {
    const onHash = () => patchUi({ view: viewFromHash() });
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [patchUi]);

  // 色彩主题：写到 <html data-theme>，CSS 按 token 覆盖（light/dark/auto）
  const theme = currentTheme(settings);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <>
      <header>
        <div className="brand">
          <img src="/logo-rounded.png" alt="" />
          {appName}
          <span className="ver-tag">{boot ? `v${boot.app.version}` : ''}</span>
          <span className="sub">Ditto 剪贴板历史工具：只读 Ditto SQLite 库，CLI 与 Web 面板同源</span>
        </div>
        <nav>
          {flat.map((v) => (
            <button
              key={v.id}
              className={'tab' + (current && current.id === v.id ? ' active' : '')}
              onClick={() => patchUi({ view: v.id })}
            >
              {v.title}
            </button>
          ))}
          {groups.map((g) => (
            <GroupTab key={g.title} group={g} currentId={ui.view} onGo={(id) => patchUi({ view: id })} />
          ))}
          {views.length === 0 && (
            <span className="muted" style={{ padding: '6px 12px' }}>
              暂无视图
            </span>
          )}
        </nav>
        <div className="head-acts">
          <ThemeToggle />
        </div>
      </header>
      <main>
        {views.length === 0 ? (
          <div className="empty">
            <p>
              还没有注册任何视图。在 <code>src/modules/&lt;域&gt;/view.jsx</code> 写一个，
              再到 <code>src/core/views.js</code> 与 <code>src/web/frontend/registry.js</code> 各登记一行。
            </p>
            <p>
              CLI 已就绪：<code>{appName} help</code> / <code>{appName} routes</code>。
            </p>
          </div>
        ) : !CurrentComp ? (
          <div className="empty">
            <p>
              页面 <code>{current?.id}</code> 在清单里，但没有对应的组件——
              到 <code>src/web/frontend/registry.js</code> 的 COMPONENTS 里登记它。
            </p>
          </div>
        ) : (
          <ErrorBoundary key={current.id}>
            <Suspense fallback={<div className="muted" style={{ padding: 24 }}>加载中…</div>}>
              <section className="panel active">
                <CurrentComp />
              </section>
            </Suspense>
          </ErrorBoundary>
        )}
      </main>
    </>
  );
}

/**
 * 头部的一个**分组入口**：一个 pill 收拢多个页面。
 * 悬浮展开、点击也能开（触屏没有 hover）；点行切换页面。
 * 外点关闭用 `pointerdown`——`click` 与触发按钮自己的 onClick 同阶段冒泡，
 * 会「点一下关了又弹开」；离开延迟关闭 + 菜单上沿补一块透明桥，
 * 否则鼠标从 pill 划向菜单会穿过几像素的空隙被判成离开，菜单刚展开就消失。
 */
function GroupTab({ group, currentId, onGo }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const closeTimer = useRef(null);
  const active = group.views.some((v) => v.id === currentId);

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const closeSoon = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 140);
  };
  useEffect(() => cancelClose, []);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span className="tab-group" ref={ref} onMouseEnter={() => { cancelClose(); setOpen(true); }} onMouseLeave={closeSoon}>
      <button className={'tab' + (active ? ' active' : '')} aria-expanded={open} onClick={() => { cancelClose(); setOpen(true); }}>
        {group.title}
        <span className="count">{group.views.length}</span>
        <span className="caret" aria-hidden />
      </button>
      {open ? (
        <div className="tab-menu" role="menu">
          {group.views.map((v) => (
            <button
              key={v.id}
              role="menuitem"
              className={'tab-menu-row' + (v.id === currentId ? ' current' : '')}
              onClick={() => { cancelClose(); setOpen(false); onGo(v.id); }}
            >
              <span className="grow nowrap">{v.title}</span>
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
