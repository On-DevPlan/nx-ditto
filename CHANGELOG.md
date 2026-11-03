# Changelog

本文件记录对外可见的变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

- 新条目写在文件最上面；尚未发版的收进 [Unreleased]，发版时改成 `版本号 - 日期`（YYYY-MM-DD）
- 条目按 Added / Changed / Deprecated / Removed / Fixed / Security 分组，没有的组不写
- 只记对外可见的变更：CLI 命令行为、HTTP API、配置项、依赖与安全；内部重构不记

## [Unreleased]

## [0.1.0] - 2026-11-03

### Added

- 剪贴板域（`clip`）：只读访问 Ditto 的 SQLite 剪贴板历史库
  - `clip info` / `clip list` / `clip images` / `clip text` / `clip show <id>`
  - `clip image <id>` 取一条图片并把原始 CF_DIB 还原成 PNG
  - `clip export` 批量导出图片（`--dry-run` 预演，只写新文件不覆盖同名）
  - `clip now` 读当前系统剪贴板（文本 / 图片 / 文件列表）
  - Web 面板新增「剪贴板」页：库概况、类型筛选、图片画廊、历史列表
- 翻页：`clip list` / `clip images` / `clip text` 支持 `--page`（1 起）与 `--offset`，
  每条结果附 `total` / `pages`；面板列表与画廊各有翻页器

### Fixed

- `clip images` 的分页在一条目含多种图片格式时不再跳格（去重改到 SQL 层完成）
- 初始骨架：serve 驱动 CLI 与 Web 面板的标准骨架（由 nx-nx 的 `server-cli-web` 模板生成）。
