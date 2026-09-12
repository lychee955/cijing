$ErrorActionPreference = 'Stop'
$previousPath = $env:PATH
try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        $localNodeDirectory = Join-Path $PSScriptRoot '.tools/node-v24.21.0-win-x64'
        if (-not (Test-Path (Join-Path $localNodeDirectory 'node.exe'))) {
            throw 'Please install Node.js 22.12+ (recommended: Node.js 24 LTS), then run npm ci.'
        }
        $env:PATH = "$localNodeDirectory;$env:PATH"
    }
    Push-Location $PSScriptRoot
    try { & npm.cmd run dev }
    finally { Pop-Location }
} finally { $env:PATH = $previousPath }
