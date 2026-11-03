// 读「当前」系统剪贴板（不是历史）。
//
// 为什么走 PowerShell：Windows 剪贴板 API（OpenClipboard/GetClipboardData）必须
// 在 STA 线程上调用，纯 Node 没有现成绑定；而 PowerShell 的 Get-Clipboard 已经
// 把这层封装好了（-Raw 取文本、-Format Image 取图片、-Format FileDropList 取文件）。
// 代价是每次调用多几百毫秒——「当前剪贴板」本来也不是高频操作。
//
// 历史不在这里：Windows 剪贴板只有一个槽位，一次性读取拿不到历史。
// 历史由 Ditto（或自己的监听器）负责采集。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { external, badInput } from './errors/index.js';

const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$result = [ordered]@{}

try {
  $t = Get-Clipboard -Raw
  if ($null -ne $t) { $result.text = [string]$t }
} catch {}

try {
  $img = Get-Clipboard -Format Image
  if ($null -ne $img) {
    $result.image = @{ width = $img.Width; height = $img.Height }
    if ($env:CLIP_NOW_IMG_OUT) {
      $img.Save($env:CLIP_NOW_IMG_OUT, [System.Drawing.Imaging.ImageFormat]::Png)
      $result.image.path = $env:CLIP_NOW_IMG_OUT
    }
  }
} catch {}

try {
  $files = Get-Clipboard -Format FileDropList
  if ($files) { $result.files = @($files) }
} catch {}

$json = $result | ConvertTo-Json -Compress -Depth 4
[System.IO.File]::WriteAllText($env:CLIP_NOW_JSON_OUT, $json, (New-Object System.Text.UTF8Encoding $false))
`;

/**
 * @param {{keepImage?: boolean}} opts keepImage 为真时把图片留在临时目录并返回其路径
 * @returns {{text?: string, image?: {width:number,height:number,path?:string}, files?: string[], tmpDir: string}}
 */
export function readCurrentClipboard(opts = {}) {
  // Windows 才有剪贴板。非 Windows 上一句人话，别抛 ENOENT 让人猜。
  if (process.platform !== 'win32') {
    throw badInput(`当前剪贴板只能在 Windows 上读取（本机是 ${process.platform}）`);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-ditto-clip-'));
  const jsonOut = path.join(tmp, 'clip.json');
  const imgOut = path.join(tmp, 'clip.png');
  const scriptPath = path.join(tmp, 'clip.ps1');
  fs.writeFileSync(scriptPath, PS_SCRIPT, 'utf8');

  try {
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      {
        encoding: 'utf8',
        timeout: 20000,
        windowsHide: true,
        env: { ...process.env, CLIP_NOW_JSON_OUT: jsonOut, CLIP_NOW_IMG_OUT: imgOut },
      }
    );
  } catch (err) {
    throw external(`调用 PowerShell 读取剪贴板失败: ${err.message}`);
  }

  if (!fs.existsSync(jsonOut)) {
    throw external('PowerShell 没有产出结果文件，剪贴板读取失败');
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(jsonOut, 'utf8'));
  } catch (err) {
    throw external(`剪贴板结果解析失败: ${err.message}`);
  }

  if (parsed.image?.path && !fs.existsSync(imgOut)) delete parsed.image.path;
  parsed.tmpDir = tmp;
  if (!opts.keepImage) cleanupClipboardTmp(tmp);
  return parsed;
}

/** 删掉临时目录（图片若已被调用方取走则一并清掉） */
export function cleanupClipboardTmp(tmpDir) {
  if (!tmpDir) return;
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* 临时目录清不掉不影响主流程 */
  }
}
