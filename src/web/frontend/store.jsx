// 全局面板状态：bootstrap 数据 + 会话级选择。
//
// 关键约定：凡是「刷新后不该丢」的用户选择（当前视图、各种下拉与勾选）
// 一律走 persist 读写 localStorage——**UI 状态持久化是硬标准，不是可选项**。
// 用户切了 tab、按了刷新，回到原处；否则每次刷新都跳回首页，用起来像坏了。
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api/client.js';

const LS_KEY = 'nx-ditto-ui';

// 只持久化「选择」，不持久化「数据」——数据永远从 /api 拉，避免陈旧缓存。
// 新增视图后在这里加一条默认值（view 的默认值是首个视图 id）。
const DEFAULT_UI = {
  view: 'home',
};

function loadUi() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_UI };
    return { ...DEFAULT_UI, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_UI };
  }
}

// 面板的设置数据（含**页面清单**与导航配置）。
// 「有哪些页面」的唯一来源在后端 core/views.js，随 /api/settings 发给面板——
// 前端不重复一份清单（重复必然分叉），只按 id 去 registry 的 COMPONENTS 取组件。
const StoreCtx = createContext(null);

export function StoreProvider({ children }) {
  const [boot, setBoot] = useState(null); // /api/bootstrap 结果
  const [settings, setSettings] = useState(null); // /api/settings 结果（页面清单 + 导航配置）
  const [ui, setUi] = useState(loadUi);

  // UI 选择变化即落盘（同步、廉价、无版本迁移问题——字段级合并已兜底）
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(ui));
    } catch {
      /* 隐私模式等场景静默降级 */
    }
  }, [ui]);

  const refreshBoot = useCallback(async () => {
    const b = await api('/api/bootstrap');
    setBoot(b);
    return b;
  }, []);

  const refreshSettings = useCallback(async () => {
    const s = await api('/api/settings');
    setSettings(s);
    return s;
  }, []);

  useEffect(() => {
    refreshBoot().catch(() => {});
    // 导航（分组 / 隐藏 / 平铺顺序）与页面清单一起拿；失败不阻塞面板其余部分
    refreshSettings().catch(() => {});
  }, [refreshBoot, refreshSettings]);

  // 支持对象 patch 与函数式 patch（函数式用于「基于最新 state 修剪」场景，
  // 避免闭包里的旧值把新值覆盖回去）
  const patchUi = useCallback((patch) => {
    setUi((u) => (typeof patch === 'function' ? { ...u, ...patch(u) } : { ...u, ...patch }));
  }, []);

  const value = useMemo(
    () => ({ boot, settings, ui, patchUi, refreshBoot, refreshSettings }),
    [boot, settings, ui, patchUi, refreshBoot, refreshSettings]
  );
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error('useStore 必须在 StoreProvider 内使用');
  return ctx;
}
