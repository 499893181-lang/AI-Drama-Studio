param(
    [string]$ArchivePath,
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$studioRoot = Split-Path -Parent $PSScriptRoot
$novelInstallRoot = Join-Path $studioRoot '.local\jimeng-novel-1.0.6'
$expectedArchiveHash = '03c09473269c14f2c73a553ad9a89525c7860d431e016d39b71506571e2cb7c9'
$expectedBinary = Join-Path $novelInstallRoot 'jimeng-novel-1.0.6-windows-amd64\jimeng-novel.exe'

if (-not (Test-Path -LiteralPath $expectedBinary -PathType Leaf)) {
    if ($CheckOnly) { throw '未找到完整 jimeng-novel 1.0.6 发行目录。' }
    if (-not $ArchivePath -or -not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) {
        throw '请通过 -ArchivePath 指定从即梦官方发行包取得的 Windows x64 ZIP；脚本不会自动下载或发起登录。'
    }
    if ((Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedArchiveHash) {
        throw 'ZIP 的 SHA256 与已核实官方发行记录不符，停止解压。'
    }
    if ((Test-Path -LiteralPath $novelInstallRoot) -and @(Get-ChildItem -LiteralPath $novelInstallRoot -Force).Count) {
        throw '目标目录已有内容但发行结构不完整，保留原件，停止覆盖。'
    }
    New-Item -ItemType Directory -Path $novelInstallRoot -Force | Out-Null
    Expand-Archive -LiteralPath $ArchivePath -DestinationPath $novelInstallRoot
}

$novelRuntime = Join-Path (Split-Path -Parent $expectedBinary) 'runtime'
if (-not (Test-Path -LiteralPath $novelRuntime -PathType Container)) {
    throw '发行 runtime 缺失，不能单独复制或运行 exe。'
}

# Reuse an installed Node for this process only. Never change user/machine PATH.
$novelNodePath = $null
if ($env:NODE_BIN) {
    if (-not [IO.Path]::IsPathRooted($env:NODE_BIN) -or -not (Test-Path -LiteralPath $env:NODE_BIN -PathType Leaf)) {
        throw 'NODE_BIN 须为已存在的 node.exe 绝对路径。'
    }
    $novelNodePath = $env:NODE_BIN
} else {
    $novelNodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($novelNodeCommand) { $novelNodePath = $novelNodeCommand.Source }
}
if (-not $novelNodePath) {
    foreach ($novelCandidate in @((Join-Path $env:ProgramFiles 'nodejs\node.exe'), (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'))) {
        if (Test-Path -LiteralPath $novelCandidate -PathType Leaf) { $novelNodePath = $novelCandidate; break }
    }
}
if (-not $novelNodePath) {
    $novelRuntimePackages = @()
    try { $novelRuntimePackages = @(Get-AppxPackage -Name 'OpenAI.CodexPrimaryRuntime*' -ErrorAction Stop | Sort-Object Version -Descending | Select-Object -ExpandProperty InstallLocation) } catch { }
    foreach ($novelRuntimePackage in $novelRuntimePackages) {
        $novelCandidate = Join-Path $novelRuntimePackage 'dependencies\node\bin\node.exe'
        if (Test-Path -LiteralPath $novelCandidate -PathType Leaf) { $novelNodePath = $novelCandidate; break }
    }
}
if (-not $novelNodePath) { throw '未找到Node.js 18+，请安装Node或设置NODE_BIN。不会自动下载或修改全局PATH。' }
$novelNodeVersion = [string](& $novelNodePath --version)
if ($LASTEXITCODE -ne 0 -or $novelNodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 18) { throw 'jimeng-novel需要Node.js 18或以上版本。' }
$savedNovelProcessPath = $env:PATH
try {
    $env:PATH = (Split-Path -Parent $novelNodePath) + [IO.Path]::PathSeparator + $savedNovelProcessPath
    & $expectedBinary --version
    if ($LASTEXITCODE -ne 0) { throw 'jimeng-novel 版本检查失败。' }
    Write-Host "JIMENG_NOVEL_BIN=$expectedBinary"
    Write-Host "NODE_VERSION=$novelNodeVersion"
    Write-Host 'CHECK=PASS; runtime preserved; no login, canvas creation, script or media submitted'
} finally {
    $env:PATH = $savedNovelProcessPath
}
