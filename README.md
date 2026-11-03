# nx-ditto

读本机 **Ditto** 剪贴板历史库的 CLI + Web 面板。CLI 与面板同源：一条命令同时
派生 CLI 路径与 HTTP 路由，面板上能做的操作，CLI 一定有等价命令。

```
node bin/ditto.mjs clip info
node bin/ditto.mjs clip list --limit 20
node bin/ditto.mjs clip images --limit 5
node bin/ditto.mjs clip export --limit 10 --out D:\shots
node bin/ditto.mjs serve          # 面板：http://127.0.0.1:7883
```

## 它是什么

Windows 剪贴板只有一个槽位，复制新的就覆盖旧的。Ditto 在后台把每次复制
存进自己的 SQLite 库（`%APPDATA%\Ditto\Ditto.db`）；nx-ditto 把那个库变成
可查询、可导出的数据：

```
Ditto（后台采集）→ Ditto.db（SQLite）→ nx-ditto（查询 / 导出 / 面板）
```

- **只读**：从不修改 Ditto 的库。写操作只有「导出图片到目录」，且只写新文件
- **图片还原**：Ditto 存的是原始 CF_DIB 位图，本工具还原成 PNG / BMP
- **同源**：CLI 命令表、HTTP 路由表、help 文本全部由同一份 action 声明派生

## 命令总表

| 命令 | 说明 |
| --- | --- |
| `clip info` | 库位置、条目数、图片数、最后写入时间 |
| `clip list` | 列出最近条目（`--limit` `--offset` `--page` `--type` `--since` `--include-grouped`） |
| `clip images` | 只列图片条目（含原始 blob 字节数，可翻页） |
| `clip text` | 导出最近文本内容（UTF-16LE 已解码，可翻页） |
| `clip show <id>` | 看一条详情：文本直接打印，文件列表展开 |
| `clip image <id>` | 取一条图片并还原成 PNG（`--out` 指定目录） |
| `clip export` | 批量导出图片（`--limit` `--out` `--format` `--dry-run`） |
| `clip now` | 读**当前**系统剪贴板（文本 / 图片 / 文件列表，不是历史） |

平台命令：`serve`（起面板）、`routes`（命令 ↔ 路由对照）、`health`、
`setting get/set`、`skill install/get/list`、`version`、`help`。

全部命令支持 `--json`（机器可读输出，错误也是 JSON）。

### 过滤与分页

| 过滤 | 写法 |
| --- | --- |
| 每页条数 | `--limit N`（`0` = 全部） |
| 翻到第几页 | `--page N`（1 起） |
| 跳过前 N 条 | `--offset N` |
| 条目类型 | `--type all\|text\|image\|file` |
| 时间范围 | `--since 30m \| 2h \| 3d \| 1w \| 2026-11-01 \| Unix 时间戳` |

`--page` 与 `--offset` 二选一，同时给以 `--offset` 为准。每条结果都带
`total`（总条数）与 `pages`（总页数），面板的翻页器与 CLI 的页码提示都用它。

```bash
nx-ditto clip list --limit 20 --page 3
nx-ditto clip images --limit 10 --offset 30
```

### 库路径

查找顺序：`NX_DITTO_DB` 环境变量 → `%APPDATA%\Ditto\Ditto.db` → Ditto.exe
同目录（便携版）。都没有时命令会明确报错并列出这三个位置。

## 开发

```bash
pnpm install
pnpm dev            # vite + serve 两个进程，热更新
pnpm start          # 构建并起面板
pnpm test           # lint + build + smoke + unit
```

要求 **Node ≥ 22.5**（`node:sqlite` 是本项目读 Ditto 库的基础）。

### 目录结构

```
src/core/           零业务语义的基础设施
  ditto-db.js       Ditto 库只读访问（node:sqlite）
  ditto-image.js    CF_DIB → PNG / BMP
  clipboard-now.js  读当前系统剪贴板（PowerShell STA）
  format.js         终端表格与时间/体积格式化
src/modules/clip/   剪贴板域：index.js（action 声明）+ service.js + view.jsx
src/runtime/        装配层：action → CLI 命令表 / HTTP 路由表
src/web/frontend/   React 面板壳
assets/nx-ditto/    随包分发的 agent 手册（只讲怎么用）
```

依赖方向 `core ← modules ← runtime`，由 `eslint.config.js` 的
`no-restricted-imports` 强制。

### 加功能域要碰的地方

`src/modules/<域>/`（index.js 声明 actions、service.js 写业务、view.jsx 写面板）
→ `src/runtime/registry.js` 的 `MODULES` → `src/core/views.js` 的 `VIEWS_META`
→ `src/web/frontend/registry.js` 的 `COMPONENTS` → `src/index.js` 导出 service
→ `eslint.config.js` 互依禁列 → `tests/unit/` → `assets/nx-ditto/` 补用法文档。

前四项有测试对账；`src/index.js` 导出与 eslint 禁列**没有任何断言**，
漏补是静默的。

### 发版

`gh repo create` 后推 tag，GitHub Actions 自动发 npm。首次建包需要本地
`npm login` 首发一次，之后配 Trusted Publishing（OIDC 零 token）。

## 许可

本项目 MIT。

**Ditto 本体是 GPL-3.0**——本项目不复制它的任何代码，只按其公开的库结构
读它写出的数据文件，因此不受传染。若要改造 Ditto 本体或分发它，
必须同样以 GPL-3.0 开源。
