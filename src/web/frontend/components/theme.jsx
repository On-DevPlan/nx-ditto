// 色彩主题：头部切换按钮 + 首页分段选择器。
//
// 主题存放在后端 settings（setting.set --key theme --value light|dark|auto），
// 与导航配置同源；App 负责把当前主题写到 <html data-theme>，CSS 只覆盖 token。
// 图标用 SVG 描边（无 emoji，符合视觉规范）。
import { api } from '../api/client.js';
import { useStore } from '../store.jsx';

export const THEMES = [
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
  { id: 'auto', label: '跟随系统' },
];

export function currentTheme(settings) {
  const t = settings?.settings?.theme;
  return THEMES.some((x) => x.id === t) ? t : 'light';
}

export function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

export function AutoIcon() {
  // 半明半暗：左半边填实、右半边留白，表达「跟随系统」
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" fill="currentColor" fillOpacity="0.25" />
      <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

export function ThemeIcon({ theme }) {
  if (theme === 'light') return <SunIcon />;
  if (theme === 'dark') return <MoonIcon />;
  return <AutoIcon />;
}

async function changeTheme(next, refreshSettings) {
  await api('/api/settings', { method: 'PATCH', body: { key: 'theme', value: next } });
  await refreshSettings();
}

/** 头部按钮：light → dark → auto 循环。 */
export function ThemeToggle() {
  const { settings, refreshSettings } = useStore();
  const theme = currentTheme(settings);
  const idx = THEMES.findIndex((t) => t.id === theme);
  const next = THEMES[(idx + 1) % THEMES.length];
  return (
    <button
      className="theme-toggle"
      title={`色彩主题：${THEMES[idx].label}（点击切到${next.label}）`}
      onClick={() => changeTheme(next.id, refreshSettings).catch(() => {})}
    >
      <ThemeIcon theme={theme} />
    </button>
  );
}

/** 首页分段选择器：三选一，点击即保存。 */
export function ThemePicker() {
  const { settings, refreshSettings } = useStore();
  const theme = currentTheme(settings);
  return (
    <div className="seg">
      {THEMES.map((t) => (
        <button
          key={t.id}
          className={t.id === theme ? 'active' : ''}
          title={t.label}
          onClick={() => changeTheme(t.id, refreshSettings).catch(() => {})}
        >
          <ThemeIcon theme={t.id} />
          {t.label}
        </button>
      ))}
    </div>
  );
}
