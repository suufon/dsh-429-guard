<#
.SYNOPSIS
   一键重启 DeepSeek Harness Web（dsh web）——用于加载新安装/修改的插件后生效。

.DESCRIPTION
   1) 停止占用端口（默认 3080）的 dsh web 进程
   2) 以 DSH_HOME 重新启动 dsh web（独立进程，默认隐藏窗口）
   3) 轮询 http://127.0.0.1:<Port> 直到服务就绪，并验证插件路由 /guard-api/state

   路径自动探测，无需硬编码：DSH_HOME 依次取 -DshHome 参数、$env:DSH_HOME、
   dsh CLI 所在安装根目录下的 .dsh、最后回退到 $HOME\.dsh；
   dsh CLI 依次取 -DshCmd 参数、PATH 中的 dsh、安装根目录的 node_modules\.bin\dsh.cmd。

.PARAMETER Action
   restart(默认) | stop | start

.PARAMETER ShowWindow
   开关：显示服务器控制台窗口（默认隐藏；开启后可在该窗口查看服务器日志）

.PARAMETER Port
   dsh web 监听端口，默认 3080

.PARAMETER DshHome
   显式指定 DSH_HOME（默认自动探测）

.PARAMETER DshCmd
   显式指定 dsh CLI 可执行文件路径（默认自动探测）

.EXAMPLE
   .\restart-web.ps1                              # 重启（隐藏窗口）
   .\restart-web.ps1 -Action stop                  # 仅停止
   .\restart-web.ps1 -Action start -ShowWindow     # 仅启动并显示日志窗口
   .\restart-web.ps1 -Port 3080 -DshHome D:\.dsh   # 显式指定
#>
# 注意：本文件必须保存为「UTF-8 with BOM」。Windows PowerShell 5.1 会把无 BOM 的
# UTF-8 当 ANSI(GBK) 读取，导致下面的中文报 Unexpected token 解析错误。
param(
  [ValidateSet('restart', 'stop', 'start')]
  [string]$Action = 'restart',
  [switch]$ShowWindow,
  [int]$Port = 3080,
  [string]$DshHome,
  [string]$DshCmd
)

$ErrorActionPreference = 'Stop'
$ProbePath = '/guard-api/state'
$ProbeUrl = "http://127.0.0.1:$Port$ProbePath"

function Resolve-DshCmd {
  param([string]$Explicit, [string]$HomeHint)
  if ($Explicit) {
    if (Test-Path $Explicit) { return (Resolve-Path $Explicit).Path }
    throw "指定的 dsh CLI 不存在: $Explicit"
  }
  foreach ($name in @('dsh', 'dsh.cmd', 'dsh.exe')) {
    $onPath = Get-Command $name -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
  }
  $candidates = @()
  # DSH_HOME 的上级通常就是安装根：<root>\.dsh -> <root>\node_modules\.bin\dsh.cmd
  if ($HomeHint) { $candidates += (Join-Path (Split-Path $HomeHint -Parent) 'node_modules\.bin\dsh.cmd') }
  $candidates += @(
    (Join-Path $PSScriptRoot '..\..\node_modules\.bin\dsh.cmd'),
    (Join-Path $PSScriptRoot '..\node_modules\.bin\dsh.cmd'),
    (Join-Path $HOME '.dsh\..\node_modules\.bin\dsh.cmd'),
    (Join-Path $env:APPDATA 'npm\dsh.cmd'),
    (Join-Path $env:LOCALAPPDATA 'pnpm\dsh.cmd'),
    (Join-Path $env:LOCALAPPDATA 'Programs\dsh\node_modules\.bin\dsh.cmd')
  )
  foreach ($c in $candidates) {
    if ($c -and (Test-Path $c)) { return (Resolve-Path $c).Path }
  }
  throw "未找到 dsh CLI。请用 -DshCmd 指定，或把 dsh 加入 PATH。"
}

function Resolve-DshHome {
  param([string]$Explicit, [string]$CmdPath)
  if ($Explicit) {
    if (-not (Test-Path $Explicit)) { throw "指定的 DSH_HOME 不存在: $Explicit" }
    return (Resolve-Path $Explicit).Path
  }
  if ($env:DSH_HOME -and (Test-Path $env:DSH_HOME)) { return (Resolve-Path $env:DSH_HOME).Path }
  # 从 <root>\node_modules\.bin\dsh.cmd 反推 <root>\.dsh
  if ($CmdPath) {
    $binDir = Split-Path $CmdPath -Parent
    if ((Split-Path $binDir -Leaf) -eq '.bin') {
      $nm = Split-Path $binDir -Parent
      if ((Split-Path $nm -Leaf) -eq 'node_modules') {
        $root = Split-Path $nm -Parent
        $guess = Join-Path $root '.dsh'
        if (Test-Path $guess) { return (Resolve-Path $guess).Path }
      }
    }
  }
  $fallback = Join-Path $HOME '.dsh'
  if (Test-Path $fallback) { return (Resolve-Path $fallback).Path }
  throw "未找到 DSH_HOME。请设置 `$env:DSH_HOME 或用 -DshHome 指定。"
}

function Get-ListenerPid {
  $line = netstat -ano | Select-String (":$Port\s+.*LISTENING") | Select-Object -First 1
  if ($line) { return (($line.ToString().Trim() -split '\s+')[-1]) }
  return $null
}

function Wait-PortReleased {
  for ($i = 0; $i -lt 15; $i++) {
    if (-not (Get-ListenerPid)) { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}

function Wait-WebUp {
  for ($i = 0; $i -lt 60; $i++) {
    try {
      $r = Invoke-WebRequest -Uri $ProbeUrl -UseBasicParsing -TimeoutSec 3
      if ($r.StatusCode -eq 200) { return $true }
    } catch { }
    Start-Sleep -Seconds 2
  }
  return $false
}

$homeHint = if ($DshHome) { $DshHome } elseif ($env:DSH_HOME) { $env:DSH_HOME } else { $null }
$DshCmd = Resolve-DshCmd -Explicit $DshCmd -HomeHint $homeHint
$DshHome = Resolve-DshHome -Explicit $DshHome -CmdPath $DshCmd
# 工作目录：优先 DSH_HOME 的上级（即安装根），否则用 dsh CLI 所在目录
$Root = Split-Path $DshHome -Parent
if (-not (Test-Path $Root)) { $Root = Split-Path $DshCmd -Parent }

Write-Host "dsh CLI : $DshCmd"
Write-Host "DSH_HOME: $DshHome"

# ── stop ──────────────────────────────────────────────────────────────
$pidOnPort = Get-ListenerPid
if ($pidOnPort) {
  Write-Host "Stopping dsh web (PID $pidOnPort, :$Port) ..."
  Stop-Process -Id $pidOnPort -Force -ErrorAction SilentlyContinue
  if (-not (Wait-PortReleased)) {
    Write-Host "[ERR] port $Port 仍被占用，请确认其他进程后重试" -ForegroundColor Red
    exit 1
  }
  Write-Host "Stopped."
} else {
  Write-Host "端口 :$Port 当前无监听（无需停止）。"
}

if ($Action -eq 'stop') { Write-Host "完成 (stop)。"; exit 0 }

# ── start ─────────────────────────────────────────────────────────────
Write-Host "Starting dsh web ..."
$env:DSH_HOME = $DshHome
if ($ShowWindow) {
  Start-Process -FilePath $DshCmd -ArgumentList 'web' -WorkingDirectory $Root
} else {
  Start-Process -FilePath $DshCmd -ArgumentList 'web' -WorkingDirectory $Root -WindowStyle Hidden
}
if (-not (Wait-WebUp)) {
  Write-Host "[ERR] dsh web 在 $Port 上未在 ~120s 内就绪，请检查服务器日志" -ForegroundColor Red
  exit 1
}
$pidOnPort = Get-ListenerPid
Write-Host "dsh web 已就绪 (PID $pidOnPort)：http://127.0.0.1:$Port （插件路由 $ProbePath 正常）。" -ForegroundColor Green
Write-Host "提示：浏览器需刷新页面以加载最新的客户端插件。"
exit 0
