---
name: nx-ditto
description: 当用户要查本机剪贴板历史、把剪贴板里的图片导出来、或用命令行看最近复制过什么时使用。触发词：剪贴板历史、复制历史、剪贴板图片、导出截图、clipboard history、 Ditto、nx-ditto、clip list、剪贴板面板。不适用于：跨设备剪贴板同步、远程桌面、密码管理器、自动填充表单。
---
# nx-ditto skill

读本机 **Ditto** 剪贴板历史库的命令行工具与 Web 面板。CLI 与面板同源：
面板上能做的，CLI 都能做，每条命令都能加 `--json` 直接喂给 agent。

- 项目根（安装时注入，固定值）：`{{PROJECT_ROOT}}`

## 它解决什么问题

Windows 剪贴板只有一个槽位——复制新的就覆盖旧的。Ditto 在后台把每次复制存进
自己的 SQLite 库，nx-ditto 把那个库变成可查询、可导出的数据：

- 「我刚才复制的那段代码是什么？」→ 查历史
- 「刚才复制的那张截图在哪？」→ 从库里的原始位图还原成 PNG
- 「把最近 5 张复制过的图存到某个目录」→ 一条命令

## 常用命令

在项目根目录执行：

```bash
# 库在哪、有多少条目（先看这个：库不存在时它会告诉你去哪找）
node bin/ditto.mjs clip info

# 最近 20 条剪贴板记录（时间 / 类型 / 大小 / 预览）
node bin/ditto.mjs clip list --limit 20

# 只要最近的图片条目
node bin/ditto.mjs clip images --limit 10

# 最近的文本内容（UTF-16 已解码，直接可读）
node bin/ditto.mjs clip text --limit 5

# 看某一条（id 来自上面的列表）
node bin/ditto.mjs clip show 34600

# 取一条图片，还原成 PNG 存到文件
node bin/ditto.mjs clip image 34582 --out D:\shots

# 批量导出最近 10 张图（先 dry-run 看要写什么）
node bin/ditto.mjs clip export --limit 10 --dry-run
node bin/ditto.mjs clip export --limit 10 --out D:\shots

# 当前剪贴板（不是历史：只拿到此刻的值）
node bin/ditto.mjs clip now

# 启动 Web 面板（默认端口 7883）
node bin/ditto.mjs serve
```

加 `--json` 获取机器可读输出（错误时同样输出 JSON）。

## 常用过滤

| 过滤 | 写法 | 例子 |
| --- | --- | --- |
| 每页条数 | `--limit N`（0 = 全部） | `--limit 100` |
| 翻到第几页 | `--page N`（1 起） | `--page 3` |
| 跳过前 N 条 | `--offset N` | `--offset 30` |
| 条目类型 | `--type all\|text\|image\|file` | `--type image` |
| 时间范围 | `--since 30m \| 2h \| 3d \| 1w \| 2026-11-01` | `--since 1d` |
| 含已分组的条目 | `--include-grouped` | — |

每条查询结果都带 `total`（总条数）与 `pages`（总页数）。

## references

| 代号 | 内容 | 何时读 |
| --- | --- | --- |
| A01 | 设计思想、解决什么问题、适合什么场景 | 第一次接触这个工具，或要判断它能不能满足需求时 |
| A02 | 快速开始：装 Ditto、找到库、第一条命令 | 第一次上手时 |
| A03 | 剪贴板查询与导出：各条命令的用法与边界 | 要查历史或导出图片时 |

## 约束

- **只读**：nx-ditto 从不修改 Ditto 的库，写操作只有「导出图片到目录」，
  且只写新文件、不覆盖同名文件
- **库不存在会明确报错**：查找顺序是 `NX_DITTO_DB` 环境变量 →
  `%APPDATA%\Ditto\Ditto.db` → Ditto.exe 同目录；都没有时报错并给出这三个位置
- **图片是原始位图**：Ditto 存的是 CF_DIB，工具负责还原成 PNG/BMP；
  还原结果已做过视觉校验
- 命令、参数与 flag 的权威清单看 `routes --json`，不要凭记忆杜撰
