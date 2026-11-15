param(
    [ValidateRange(1, 65535)]
    [int]$Port = 4317,
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$studioRoot = Split-Path -Parent $PSScriptRoot
$studioNodePath = $null
$studioNodeSource = $null

if ($env:NODE_BIN) {
    if (-not [IO.Path]::IsPathRooted($env:NODE_BIN) -or [IO.Path]::GetExtension($env:NODE_BIN) -ne '.exe' -or -not (Test-Path -LiteralPath $env:NODE_BIN -PathType Leaf)) {
        throw 'NODE_BIN 须为已存在的 Node.js 原生可执行文件的绝对路径。'
    }
    $studioNodePath = $env:NODE_BIN
    $studioNodeSource = 'NODE_BIN'
} else {
    $studioNodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($studioNodeCommand) {
        $studioNodePath = $studioNodeCommand.Source
        $studioNodeSource = 'PATH'
    }
}

if (-not $studioNodePath) {
    $studioStandardNodes = @(
        (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
    )
    foreach ($studioCandidate in $studioStandardNodes) {
        if (Test-Path -LiteralPath $studioCandidate -PathType Leaf) {
            $studioNodePath = $studioCandidate
            $studioNodeSource = 'Node.js installation'
            break
        }
    }
}

if (-not $studioNodePath) {
    # Read installed package locations only; never install, copy, or modify a runtime.
    $studioRuntimeRoots = @()
    try {
        $studioRuntimeRoots = @(Get-AppxPackage -Name 'OpenAI.CodexPrimaryRuntime*' -ErrorAction Stop | Sort-Object Version -Descending | Select-Object -ExpandProperty InstallLocation)
    } catch {
        # Some restricted shells cannot query Appx; a bounded directory listing is the fallback.
    }
    if (-not $studioRuntimeRoots.Count) {
        $studioWindowsApps = Join-Path $env:ProgramFiles 'WindowsApps'
        try {
            $studioRuntimeRoots = @(Get-ChildItem -LiteralPath $studioWindowsApps -Directory -Filter 'OpenAI.CodexPrimaryRuntime*' -ErrorAction Stop | Sort-Object Name -Descending | Select-Object -ExpandProperty FullName)
        } catch { }
    }
    foreach ($studioRuntimeRoot in $studioRuntimeRoots) {
        $studioCandidate = Join-Path $studioRuntimeRoot 'dependencies\node\bin\node.exe'
        if (Test-Path -LiteralPath $studioCandidate -PathType Leaf) {
            $studioNodePath = $studioCandidate
            $studioNodeSource = 'Installed CodexPrimaryRuntime'
            break
        }
    }
}

if (-not $studioNodePath) {
    throw '未找到 Node.js 22 或以上版本，也未找到可复用的 Codex 运行时。请安装 Node.js，或设置 NODE_BIN 为 node.exe 的绝对路径。不会自动下载或修改全局 PATH。'
}
$studioVersion = [string](& $studioNodePath --version)
if ($LASTEXITCODE -ne 0 -or $studioVersion -notmatch '^v(\d+)\.') { throw 'Node.js 版本检查失败，请核对 NODE_BIN 或本机安装。' }
if ([int]$Matches[1] -lt 22) { throw "当前 Node.js 为 $studioVersion，需要 22 或以上版本。" }

Write-Host "NODE_SOURCE=$studioNodeSource"
Write-Host "NODE_PATH=$studioNodePath"
Write-Host "NODE_VERSION=$studioVersion"
if ($CheckOnly) {
    Write-Host 'CHECK_ONLY=PASS; no server started; no PATH changes'
    exit 0
}

$env:PORT = "$Port"
Push-Location -LiteralPath $studioRoot
try {
    Write-Host 'AI-Drama-Studio · 故事立项工作台'
    Write-Host "启动地址：http://127.0.0.1:$Port"
    Write-Host '按 Ctrl+C 停止；关闭后项目仍保存在本机 data 目录。'
    & $studioNodePath (Join-Path $studioRoot 'src\server.mjs')
    exit $LASTEXITCODE
} finally {
    Pop-Location
}

