// smoke 测试：生成的 CLI 在真实进程里跑通关键路径。
// 这些是「面板能起、命令能跑」的最小证明——比单元测试更接近用户实际体验。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'ditto.mjs');

// 每个用例独立存储，避免写脏用户真实目录，也避免用例间计数互相干扰
function run(cmdline, cwd = tmpdir()) {
  const dir = mkdtempSync(join(tmpdir(), 'nx-ditto-smoke-'));
  // execFile 不走 shell，必须把命令串拆成 token 数组——
  // 整串塞进去会被当成一个 argv 元素，CLI 侧报「未知命令」。
  return exec(process.execPath, [BIN, ...cmdline.split(' ').filter(Boolean)], {
    cwd,
    env: { ...process.env, NX_DITTO_STORE: join(dir, 'store.json') },
  });
}

test('version 输出裸版本号（可被 V=$(nx-ditto version) 消费）', async () => {
  const { stdout } = await run('version');
  assert.match(stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test('routes: 命令表含 bootstrap/health 且带 HTTP 对照', async () => {
  const { stdout } = await run('routes --json');
  const r = JSON.parse(stdout);
  assert.ok(r.count >= 8, `至少 8 条命令，实际 ${r.count}`);
  const ids = r.routes.map((x) => x.id);
  for (const id of ['home.bootstrap', 'home.health']) {
    assert.ok(ids.includes(id), `缺命令 ${id}`);
  }
});

test('health：自检通过', async () => {
  const r = JSON.parse((await run('health --json')).stdout);
  assert.equal(r.status, 'ok');
});

test('未知命令 exit 1', async () => {
  await assert.rejects(() => run('nope'));
});

test('skill list：含主 skill 与默认 group', async () => {
  const r = JSON.parse((await run('skill list --json')).stdout);
  assert.ok(r.skills.includes('nx-ditto'), '缺主 skill');
  assert.equal(r.defaultGroup, 'nx-ditto');
});

test('skill install：项目根安装注入路径，非项目目录拒绝', async () => {
  const to = mkdtempSync(join(tmpdir(), 'nx-ditto-skill-'));
  const ok = JSON.parse(
    (await run(`skill install nx-ditto --to ${to} --json`, ROOT)).stdout
  );
  assert.equal(ok.status, 'ok');

  const skill = readFileSync(join(to, 'nx-ditto', 'SKILL.md'), 'utf8');
  assert.ok(skill.includes(ROOT.replace(/\\/g, '/')), '应注入项目根路径');
  assert.ok(!skill.includes('{{PROJECT_ROOT}}'), '不应残留安装期占位');
  assert.ok(!existsSync(join(to, 'nx-ditto', 'hooks.json')), 'hooks.json 不复制');
  assert.ok(!existsSync(join(to, 'nx-ditto', 'install')), 'install/ 不复制');

  const wrong = mkdtempSync(join(tmpdir(), 'nx-ditto-wrong-'));
  await assert.rejects(
    () => run(`skill install nx-ditto --to ${wrong} --json`, wrong),
    (err) => {
      // --json 模式下错误信封走 stdout（人读模式才走 stderr）
      const payload = JSON.parse(err.stdout);
      assert.match(payload.error, /项目根目录内安装/);
      return true;
    }
  );
});

test('skill install --all：一次装全部 skill；与 name/--group 互斥', async () => {
  const to = mkdtempSync(join(tmpdir(), 'nx-ditto-all-'));
  const r = JSON.parse(
    (await run(`skill install --all --to ${to} --json`, ROOT)).stdout
  );
  assert.equal(r.status, 'ok');
  assert.equal(r.group, '*');
  assert.ok(r.skills.length >= 1);
  assert.ok(r.skills.some((x) => x.name === 'nx-ditto'));
  assert.ok(existsSync(join(to, 'nx-ditto', 'SKILL.md')));

  // 再跑一次：全部 skipped（幂等）
  const again = JSON.parse(
    (await run(`skill install --all --to ${to} --json`, ROOT)).stdout
  );
  assert.ok(again.skills.every((x) => x.status === 'skipped'));

  // 互斥校验
  await assert.rejects(
    () => run(`skill install nx-ditto --all --to ${to} --json`, ROOT),
    (err) => {
      assert.match(JSON.parse(err.stdout).error, /--all/);
      return true;
    }
  );
});

test('setting：导航分组 / 隐藏 / 平铺顺序经 CLI 往返（同一个 store），坏 id 明确报错', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nx-ditto-nav-'));
  const env = { ...process.env, NX_DITTO_STORE: join(dir, 'store.json') };
  const cli = (args) => exec(process.execPath, [BIN, ...args], { cwd: tmpdir(), env });

  const get0 = JSON.parse((await cli(['setting', 'get', '--json'])).stdout);
  assert.ok(Array.isArray(get0.settings.navGroups) && get0.settings.navGroups.length === 0, '默认无分组');
  assert.ok(get0.views.some((v) => v.id === 'home'), '要带上页面清单（头部据此渲染）');
  assert.ok(!get0.views.some((v) => v.id === 'settings'), '出厂不再有独立 settings 页');

  await cli(['setting', 'set', '--set', 'navGroups=[{"title":"系统","views":["home"]}]', '--json']);
  await cli(['setting', 'set', '--set', 'navOrder=["home"]', '--json']);
  const get1 = JSON.parse((await cli(['setting', 'get', '--json'])).stdout);
  assert.deepEqual(get1.settings.navGroups, [{ title: '系统', views: ['home'] }], '分组原样保存');
  assert.deepEqual(get1.settings.navOrder, ['home'], '平铺顺序也落盘');

  // 隐藏 home：先把分组撤掉（home 不能同时在分组和隐藏里），再隐藏
  await cli(['setting', 'set', '--set', 'navGroups=[]', '--set', 'navHidden=home', '--json']);
  const get2 = JSON.parse((await cli(['setting', 'get', '--json'])).stdout);
  assert.deepEqual(get2.settings.navHidden, ['home']);

  const bad = await cli(['setting', 'set', '--set', 'navHidden=no_such_page', '--json']).catch((e) => e);
  assert.match(String(bad.stdout || bad.message), /不存在/, '坏页面 id 必须报错而不是静默写入');
});

// ---- 剪贴板域：只读路径 ----
//
// 这一组依赖本机装了 Ditto。没装的机器上命令会明确报错（文案含「不存在」），
// 断言错误文案即可——不把「本机没装 Ditto」当成测试失败。

/** 跑一条 clip 命令；没装 Ditto 时返回 { missing: true } 而不是抛。 */
async function clip(args) {
  try {
    const { stdout } = await run(`clip ${args} --json`);
    return { data: JSON.parse(stdout) };
  } catch (err) {
    const payload = err.stdout ? JSON.parse(err.stdout) : { error: String(err.message) };
    if (/不存在/.test(payload.error || '')) return { missing: true, error: payload.error };
    throw err;
  }
}

test('clip info：库可读时给出路径与统计；不可读时错误文案指明「不存在」', async () => {
  const r = await clip('info');
  if (r.missing) {
    assert.match(r.error, /不存在/);
    return;
  }
  assert.equal(r.data.status, 'ok');
  assert.ok(r.data.db, '要给出库路径');
  assert.ok(r.data.clips >= 0);
});

test('clip list / images：条目结构完整、倒序', async () => {
  const l = await clip('list --limit 5');
  if (l.missing) {
    assert.match(l.error, /不存在/);
    return;
  }
  assert.ok(Array.isArray(l.data.items));
  assert.ok(l.data.items.length <= 5);
  for (const it of l.data.items) {
    assert.ok(it.id && it.date && it.kind, '条目要有 id / date / kind');
  }
  for (let i = 1; i < l.data.items.length; i++) {
    assert.ok(l.data.items[i - 1].date >= l.data.items[i].date, '必须按时间倒序');
  }

  const g = await clip('images --limit 3');
  if (!g.missing) {
    assert.ok(Array.isArray(g.data.items));
    for (const it of g.data.items) assert.ok(it.bytes > 0, '图片条目要有 blob 字节数');
  }
});

test('clip show：能取回条目详情', async () => {
  const l = await clip('list --limit 1');
  if (l.missing) return;
  const id = l.data.items[0].id;
  const r = await clip(`show ${id}`);
  assert.equal(r.data.id, id);
  assert.ok(Array.isArray(r.data.formats));
});

test('clip export --dry-run：只报将要写什么，不落盘', async () => {
  const r = await clip('export --limit 2 --dry-run');
  if (r.missing) return;
  assert.equal(r.data.dryRun, true);
  assert.ok(Array.isArray(r.data.planned));
  assert.ok(r.data.outDir, '要给出目标目录');
});

test('clip list：分页参数生效（页码 / 偏移 / 越界）', async () => {
  const l = await clip('list --limit 5');
  if (l.missing) return;

  // 首屏：条数不超过 limit，且报出总数与总页数
  assert.ok(l.data.items.length <= 5, '每页条数受 limit 约束');
  assert.equal(typeof l.data.total, 'number');
  assert.ok(l.data.total >= l.data.count, 'total 不小于本页条数');
  assert.ok(l.data.pages >= 1, '总页数至少 1');
  assert.equal(l.data.page, 1, '不传页码时是第一页');

  // 越界页：返回空，但总数与页数照报（面板据此知道还剩几页）
  const far = await clip('list --limit 5 --page 9999');
  assert.equal(far.data.items.length, 0, '越界页不返回条目');
  assert.equal(far.data.total, l.data.total, '越界不影响总数');

  // 偏移越界同理
  const off = await clip('list --limit 5 --offset 999999');
  assert.equal(off.data.items.length, 0, '偏移越界不返回条目');

  // 非法的页码/偏移要报错，而不是静默当成 0
  await assert.rejects(
    () => run('clip list --page 0 --json'),
    (err) => {
      assert.match(JSON.parse(err.stdout).error, /用法:/);
      return true;
    },
  );
});

test('clip now：当前剪贴板（结构恒定，内容看机器）', async () => {
  // 非 Windows 机器上没有剪贴板——命令会明确说「只能在 Windows 上读取」，
  // 那是预期的能力边界，不是失败。
  let r;
  try {
    r = await clip('now');
  } catch (err) {
    assert.match(String(err.stdout || err.message), /Windows|剪贴板/);
    return;
  }
  assert.equal(r.data.status, 'ok');
  assert.ok('text' in r.data);
  assert.ok(Array.isArray(r.data.files));
});

test('HTTP：图片路由返回 image/png 字节（不是 JSON 包装）', async () => {
  const g = await clip('images --limit 1');
  if (g.missing || !g.data.items.length) return;

  const { startServer } = await import('../src/runtime/server.js');
  const { findFreePort } = await import('../src/core/serve-port.js');
  const port = await findFreePort(7930);
  const server = await startServer({ port, host: '127.0.0.1' });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/clip/image/${g.data.items[0].id}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png', '图片路由必须直接发字节');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(
      buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
      '响应体应是合法 PNG'
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
});
