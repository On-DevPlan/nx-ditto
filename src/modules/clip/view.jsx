// 剪贴板视图：Ditto 历史条目的浏览、筛选与图片导出。
//
// 三件事与首页同源：数据从 /api 拉、每个操作都配一行等价 CLI 命令、
// 用 .card / .row / .tag 这些原子类而不自己写样式。
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../web/frontend/api/client.js';
import { CliHints } from '../../web/frontend/components/CliHints.jsx';
import { Copyable, Modal, useGuard, useToast } from '../../web/frontend/components/ui.jsx';

const TYPES = [
  { id: 'all', label: '全部' },
  { id: 'text', label: '文本' },
  { id: 'image', label: '图片' },
  { id: 'file', label: '文件' },
];

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

/**
 * 翻页器。只有一页时不渲染——「上一页/下一页」在单页场景是噪声。
 */
function Pager({ page, pages, total, onPage }) {
  if (!pages || pages <= 1) return null;
  return (
    <div className="pager">
      <button className="btn small ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        上一页
      </button>
      <span className="muted mono">
        第 {page} / {pages} 页 · 共 {total} 条
      </span>
      <button className="btn small ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        下一页
      </button>
    </div>
  );
}

export default function DittoView() {
  const toast = useToast();
  const guard = useGuard();

  const [info, setInfo] = useState(null);
  const [clips, setClips] = useState([]);
  const [imgs, setImgs] = useState([]);
  const [err, setErr] = useState('');
  const [type, setType] = useState('all');
  const [limit, setLimit] = useState(20);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [imgPage, setImgPage] = useState(1);
  const [imgPages, setImgPages] = useState(1);
  const [imgTotal, setImgTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(null);

  const load = useCallback(async () => {
    setErr('');
    try {
      const [i, c, g] = await Promise.all([
        api('/api/clip/info'),
        api(`/api/clip/clips?limit=${limit}&type=${type}&page=${page}`),
        api(`/api/clip/images?limit=${limit}&page=${imgPage}`),
      ]);
      setInfo(i);
      setClips(c.items || []);
      setTotal(c.total || 0);
      setPages(c.pages || 1);
      setImgs(g.items || []);
      setImgTotal(g.total || 0);
      setImgPages(g.pages || 1);
    } catch (e) {
      setErr(String((e && e.message) || e));
    }
  }, [limit, type, page, imgPage]);

  useEffect(() => {
    load();
  }, [load]);

  // 换筛选条件或每页条数时回到第一页——否则会停在一个不存在的页码上
  const changeType = (t) => { setType(t); setPage(1); };
  const changeLimit = (n) => { setLimit(n); setPage(1); setImgPage(1); };

  // guard 是「跑一次并兜错」的执行器，**不是包装器**：
  // 直接写 `guard(async () => {...})` 等于在渲染期就把它执行了——setState 落在渲染期
  // 会触发 React 的「Too many re-renders」，而且副作用会真的发出去（导出被连着触发）。
  // 所以这里定义一个函数，等点击时才调 guard。
  const doExport = () =>
    guard(async () => {
      setBusy(true);
      try {
        const r = await api('/api/clip/export', { method: 'POST', body: { limit: 5, format: 'png' } });
        toast(r.count ? `已导出 ${r.count} 张到 ${r.outDir}` : '没有可导出的图片');
      } finally {
        setBusy(false);
      }
    });

  if (err) {
    return (
      <div className="stack">
        <div className="card">
          <div className="colhead">读不到 Ditto 剪贴板库</div>
          <div className="empty bad" style={{ padding: 12 }}>{err}</div>
          <div className="empty" style={{ padding: 12 }}>
            库路径查找顺序：<code>NX_DITTO_DB</code> 环境变量 → <code>%APPDATA%\Ditto\Ditto.db</code> → Ditto.exe 同目录。
            先启动一次 Ditto 让它建库，或用环境变量指到别的库。
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      {/* ① 库概况 */}
      <div className="card">
        <div className="colhead">
          <span>Ditto 剪贴板库</span>
          <span className="right muted">只读访问，不改 Ditto 的数据</span>
        </div>
        <dl className="kv">
          <div className="kv-row">
            <dt>路径</dt>
            <dd className="mono nowrap">
              <Copyable text={info?.db || ''}>{info?.db || '加载中…'}</Copyable>
            </dd>
          </div>
          <div className="kv-row">
            <dt>条目</dt>
            <dd className="mono">
              {info ? `${info.clips} 条（图片 ${info.images} 张 / ${fmtBytes(info.imageBytes)}，文本 ${info.texts} 条）` : '—'}
            </dd>
          </div>
          <div className="kv-row">
            <dt>最后写入</dt>
            <dd className="mono">{info?.mtime ? info.mtime.replace('T', ' ').slice(0, 19) : '—'}</dd>
          </div>
        </dl>
      </div>

      {/* ② 控制条 */}
      <div className="card">
        <div className="colhead">
          <span>筛选</span>
          <span className="right rowgap">
            <span className="seg">
              {TYPES.map((t) => (
                <button
                  key={t.id}
                  className={type === t.id ? 'active' : ''}
                  onClick={() => changeType(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </span>
            <select className="btn small ghost" value={limit} onChange={(e) => changeLimit(Number(e.target.value))}>
              {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n} 条</option>)}
            </select>
            <button className="btn small" onClick={() => { void load(); }}>刷新</button>
            <button className="btn small" disabled={busy} onClick={() => { void doExport(); }}>
              {busy ? '导出中…' : '导出最近 5 张图'}
            </button>
          </span>
        </div>
      </div>

      {/* ③ 图片画廊 */}
      {imgs.length > 0 && (
        <div className="card">
          <div className="colhead">
            <span>最近图片</span>
            <span className="tag">{imgs.length} 张</span>
          </div>
          <div className="thumb-grid">
            {imgs.map((it) => (
              <button key={it.id} className="thumb" onClick={() => setZoom(it)} title="点击查看原图">
                <img src={`/api/clip/image/${it.id}`} alt={`clip ${it.id}`} loading="lazy" />
                <span className="thumb-meta mono">
                  {fmtTime(it.date)}
                  <span className="muted"> · {fmtBytes(it.bytes)}</span>
                </span>
              </button>
            ))}
          </div>
          <Pager page={imgPage} pages={imgPages} total={imgTotal} onPage={setImgPage} />
        </div>
      )}

      {/* ④ 条目列表 */}
      <div className="card">
        <div className="colhead">
          <span>剪贴板历史</span>
          <span className="tag">{clips.length} 条</span>
        </div>
        {clips.length === 0 && <div className="empty">没有匹配的条目</div>}
        {clips.map((c) => (
          <div key={c.id} className="row">
            <div className="name mono">{c.id}</div>
            <div className="desc mono">
              {fmtTime(c.date)}
              <span className="muted"> · {c.kind}</span>
              {c.text ? <span className="muted"> · {c.text}</span> : null}
            </div>
            <div className="acts">
              <span className="tag">{fmtBytes(c.bytes)}</span>
              <Copyable className="mono" text={c.text || ''}>
                <span className="btn small ghost">复制</span>
              </Copyable>
            </div>
          </div>
        ))}
        <CliHints command="nx-ditto clip list --limit 20" note="面板上的每个操作都有等价 CLI 命令，加 --json 可直接喂给 agent" />
        <Pager page={page} pages={pages} total={total} onPage={setPage} />
      </div>

      {zoom && (
        <Modal title={`剪贴板图片 #${zoom.id} · ${fmtTime(zoom.date)}`} onClose={() => setZoom(null)}>
          <img className="zoom-img" src={`/api/clip/image/${zoom.id}`} alt={`clip ${zoom.id}`} />
          <div className="muted mono" style={{ marginTop: 8 }}>
            {zoom.format} · {fmtBytes(zoom.bytes)}
          </div>
        </Modal>
      )}
    </div>
  );
}
