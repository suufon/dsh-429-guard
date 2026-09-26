<#
.SYNOPSIS
   一键把本插件仓库发布到 GitHub（创建仓库 → 推送 → 打 topics → 建 Release）。

.DESCRIPTION
   在插件根目录运行。步骤：
     0) 预检：git / gh 是否可用、gh 是否已登录、当前目录是否是 dsh-429-guard 仓库根
     1) git init（如未初始化）+ 提交全部改动到 main 分支
     2) 创建远端仓库（已存在则复用），并设置 origin
     3) git push 推送 main
     4) 打 topics（dsh-plugin 等，用于被插件市场/发现页收录）
     5) 打 tag 并创建 GitHub Release（自动附带源码 zip / tar.gz，供下载）

   网络提示：git push 走 https://github.com（443）。若该端口被阻断而
   api.github.com 可用，改用 -Transport ssh（GitHub 的 22 端口通常可用），
   或先开启代理/VPN 再跑本脚本。

.PARAMETER Owner
   GitHub 账号；不指定则自动用 gh 当前登录的账号

.PARAMETER Repo
   仓库名，默认 dsh-429-guard

.PARAMETER Tag
   Release 标签，默认 v<package.json 的 version>

.PARAMETER Transport
   https（默认）或 ssh —— 决定 origin 的 URL 形式

.PARAMETER Visibility
   public（默认）或 private

.PARAMETER SkipRelease
   只创建仓库并推送，不建 Release

.EXAMPLE
   .\scripts\publish-github.ps1
   .\scripts\publish-github.ps1 -Transport ssh
   .\scripts\publish-github.ps1 -Tag v0.1.1
#>
# 注意：本文件必须保存为「UTF-8 with BOM」。Windows PowerShell 5.1 会把无 BOM 的
# UTF-8 当 ANSI(GBK) 读取，导致下面的中文报 Unexpected token 解析错误。
param(
  [string]$Owner,
  [string]$Repo = 'dsh-429-guard',
  [string]$Tag,
  [ValidateSet('https', 'ssh')][string]$Transport = 'https',
  [ValidateSet('public', 'private')][string]$Visibility = 'public',
  [switch]$SkipRelease
)

# 本脚本几乎全是 gh / git 原生命令，而它们正常也会往 stderr 写东西（git 的
# CRLF 警告、"仓库是否存在"探测失败等）。若设为 Stop，PowerShell 会把这些
# 当成终止错误直接中断脚本，所以这里用 Continue，并逐个检查 $LASTEXITCODE。
$ErrorActionPreference = 'Continue'

function Fail($msg) { Write-Host "[ERR] $msg" -ForegroundColor Red; exit 1 }
function Info($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "    $msg" -ForegroundColor Green }

# ── 0. 预检 ───────────────────────────────────────────────────────────
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail '未找到 git，请先安装 Git for Windows。' }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Fail '未找到 gh（GitHub CLI），请先安装并 gh auth login。' }

if (-not (Test-Path '.\package.json')) { Fail "当前目录没有 package.json。请在插件根目录运行本脚本（当前：$(Get-Location)）。" }
$pkg = Get-Content '.\package.json' -Raw -Encoding UTF8 | ConvertFrom-Json
if ($pkg.name -ne $Repo) { Write-Host "[warn] package.json 的 name 是 '$($pkg.name)'，与仓库名 '$Repo' 不一致（一般应相同）。" -ForegroundColor Yellow }
if (-not $pkg.dsh.bundle.patch) { Fail 'package.json 缺少 dsh.bundle.patch —— 这不是可安装的 DSH 插件，先补上再发布。' }

$version = if ($pkg.version) { $pkg.version } else { '0.0.0' }
if (-not $Tag) { $Tag = "v$version" }

Info '检查 gh 登录状态'
# 用一次真实 API 调用判定，而不是 gh auth status —— 后者在存在其它失效账号时会误报失败。
$authLogin = (gh api user --jq .login 2>$null)
if (-not $authLogin) {
  Fail @'
gh 未登录（或 token 已失效）。请先执行其一：
  gh auth login --with-token < pat.txt   # 用 PAT（只走 api.github.com，github.com 不稳时更可靠）
  gh auth login                          # 浏览器 device flow（需要 github.com 可访问）
PAT 需勾选 repo + workflow 权限（建仓库/推送/建 Release；仓库含 .github/workflows）。
'@
}
if (-not $Owner) { $Owner = $authLogin }
Ok "已登录：$authLogin"
Ok "发布到：$Owner/$Repo"

# ── 1. git init + commit ──────────────────────────────────────────────
Info '初始化本地仓库并提交'
if (-not (Test-Path '.\.git')) { git init | Out-Null; Ok 'git init' }
git symbolic-ref HEAD refs/heads/main 2>$null | Out-Null
if ((git branch --show-current) -ne 'main') { git checkout -b main 2>$null | Out-Null }

# 未配置 git 身份时，用 GitHub noreply 身份，仅写入本仓库（不动全局配置）
if (-not (git config user.name)) {
  $uid = (gh api user --jq .id 2>$null)
  git config user.name  $Owner
  git config user.email "$uid+$Owner@users.noreply.github.com"
  Write-Host "[warn] 本机未配置 git 身份，已为本仓库设置：$Owner <$uid+$Owner@users.noreply.github.com>" -ForegroundColor Yellow
  Write-Host "       如需改用你自己的邮箱：git config user.email you@example.com" -ForegroundColor Yellow
}

git add -A
$dirty = git status --porcelain
if ($dirty) {
  git commit -m "release: $Repo $Tag" | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail 'git commit 失败（常见原因：未配置 git 身份 user.name / user.email）。' }
  Ok "已提交 $(($dirty | Measure-Object).Count) 个变更"
} else {
  Ok '工作区干净，无需提交'
}

# ── 2. 创建远端仓库 ───────────────────────────────────────────────────
Info "创建/复用远端仓库 $Owner/$Repo"
gh repo view "$Owner/$Repo" *> $null
if ($LASTEXITCODE -eq 0) {
  Ok '远端仓库已存在，复用'
} else {
  $desc = $pkg.description
  if ($Visibility -eq 'private') {
    gh repo create "$Owner/$Repo" --private --description $desc | Out-Null
  } else {
    gh repo create "$Owner/$Repo" --public --description $desc | Out-Null
  }
  if ($LASTEXITCODE -ne 0) { Fail "创建仓库失败（需要 repo 权限的 token）。" }
  Ok "已创建 $Owner/$Repo（$Visibility）"
}

$remoteUrl = if ($Transport -eq 'ssh') { "git@github.com:$Owner/$Repo.git" } else { "https://github.com/$Owner/$Repo.git" }
if ((git remote) -contains 'origin') { git remote set-url origin $remoteUrl } else { git remote add origin $remoteUrl }
Ok "origin -> $remoteUrl"

# ── 3. 推送 ───────────────────────────────────────────────────────────
Info "推送到 $Transport"
git push -u origin main
if ($LASTEXITCODE -ne 0) {
  Write-Host @'

[ERR] 推送失败。常见原因与对策：
  * github.com:443 被阻断（Connection was reset）：
      - 开启系统代理 / VPN 后重试；或
      - 用 SSH 传输（GitHub 的 22 端口通常可用）：
          ssh-keygen -t ed25519 -C "你的邮箱"
          # 把 ~/.ssh/id_ed25519.pub 内容加到 https://github.com/settings/keys
          .\scripts\publish-github.ps1 -Transport ssh
  * 没有推送权限：确认 gh 登录的账号就是仓库 owner（本脚本按 -Owner 推断身份）。
'@ -ForegroundColor Red
  exit 1
}
Ok '推送成功'

# ── 4. topics（被 dsh-plugin 生态收录的关键）──────────────────────────
Info '设置 topics'
$topics = @('dsh', 'deepseek-harness', 'dsh-plugin', 'dsh-plugins', 'plugin', '429', 'retry', 'rate-limit', 'quota')
$body = @{ names = $topics } | ConvertTo-Json -Compress
$body | gh api -X PUT "repos/$Owner/$Repo/topics" --input - *> $null
if ($LASTEXITCODE -eq 0) { Ok ($topics -join ', ') } else { Write-Host "[warn] topics 设置失败（不影响安装）" -ForegroundColor Yellow }

# ── 5. tag + Release ──────────────────────────────────────────────────
if ($SkipRelease) {
  Info '已跳过 Release（-SkipRelease）'
} else {
  Info "创建 Release $Tag"
  git tag -f $Tag | Out-Null
  git push -f origin $Tag
  if ($LASTEXITCODE -ne 0) { Write-Host "[warn] tag 推送失败，跳过 Release" -ForegroundColor Yellow }
  else {
    gh release view $Tag *> $null
    if ($LASTEXITCODE -eq 0) {
      Ok 'Release 已存在，跳过'
    } else {
      $notes = @"
## $Repo $Tag

$($pkg.description)

### 安装

``````bash
dsh plugin --profile web add github:$Owner/$Repo
``````

安装后重启 dsh web（``scripts/restart-web.ps1``），Web UI 右上角出现盾牌浮窗即成功。
"@
      gh release create $Tag --title "$Repo $Tag" --notes $notes | Out-Null
      if ($LASTEXITCODE -eq 0) { Ok "Release 已创建：https://github.com/$Owner/$Repo/releases/tag/$Tag" }
      else { Write-Host "[warn] Release 创建失败" -ForegroundColor Yellow }
    }
  }
}

Write-Host ''
Write-Host "完成。仓库：https://github.com/$Owner/$Repo" -ForegroundColor Green
Write-Host "用户安装：dsh plugin --profile web add github:$Owner/$Repo" -ForegroundColor Green
