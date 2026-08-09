#Requires -Version 5.1
<#
.SYNOPSIS
  启动本仓库本地开发环境：FastAPI(8001) + Vite(5173)

.EXAMPLE
  .\start-dev.ps1
  .\start-dev.ps1 -NoBrowser
  .\start-dev.ps1 -Restart
#>
[CmdletBinding()]
param(
  [switch]$NoBrowser,
  [switch]$Restart,
  [string]$BackendHost = "127.0.0.1",
  [int]$BackendPort = 8001,
  [string]$FrontendHost = "127.0.0.1",
  [int]$FrontendPort = 5173
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $Root "backend"
$FrontendDir = Join-Path $Root "frontend"
$VenvPython = Join-Path $BackendDir ".venv\Scripts\python.exe"
$NpmCmd = $null
$npmCmdInfo = Get-Command npm -ErrorAction SilentlyContinue
if ($npmCmdInfo) { $NpmCmd = $npmCmdInfo.Source }

function Write-Step([string]$Message) {
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Test-PortListening([int]$Port) {
  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Stop-PortListeners([int]$Port) {
  $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    $procId = $c.OwningProcess
    if ($procId) {
      Write-Host "Stopping PID $procId on port $Port"
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
  }
}

function Wait-HttpOk([string]$Url, [int]$TimeoutSec = 120) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $res = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 500) { return $true }
    } catch {
      Start-Sleep -Milliseconds 800
    }
  }
  return $false
}

Write-Host "Repo: $Root" -ForegroundColor Green

if (-not (Test-Path -LiteralPath $BackendDir)) { throw "backend/ not found: $BackendDir" }
if (-not (Test-Path -LiteralPath $FrontendDir)) { throw "frontend/ not found: $FrontendDir" }
if (-not (Test-Path -LiteralPath $VenvPython)) {
  throw "Backend venv missing. Create with: cd backend; python -m venv .venv; .\.venv\Scripts\pip install -r requirements.txt"
}
if (-not $NpmCmd) { throw "npm not found in PATH. Install Node.js first." }
if (-not (Test-Path -LiteralPath (Join-Path $FrontendDir "node_modules"))) {
  Write-Step "frontend/node_modules missing — running npm install"
  Push-Location -LiteralPath $FrontendDir
  try { & npm install } finally { Pop-Location }
}

if ($Restart) {
  Write-Step "Restart requested — freeing ports $BackendPort / $FrontendPort"
  Stop-PortListeners $FrontendPort
  Stop-PortListeners $BackendPort
  Start-Sleep -Seconds 1
}

if (Test-PortListening $BackendPort) {
  Write-Host "Backend already listening on $BackendPort" -ForegroundColor Yellow
} else {
  Write-Step "Starting FastAPI on http://${BackendHost}:$BackendPort"
  # 后台隐藏启动（无窗口）：日志写入 backend/_uvicorn_boot.log
  $backendCmd = @"
Set-Location -LiteralPath '$BackendDir'
& '$VenvPython' -m uvicorn app.main:app --reload --host $BackendHost --port $BackendPort *> '$BackendDir\_uvicorn_boot.log'
exit `$LASTEXITCODE
"@
  Start-Process -FilePath "powershell.exe" -WorkingDirectory $BackendDir -WindowStyle Hidden -ArgumentList @(
    "-ExecutionPolicy", "Bypass", "-Command", $backendCmd
  ) | Out-Null
}

if (Test-PortListening $FrontendPort) {
  Write-Host "Frontend already listening on $FrontendPort" -ForegroundColor Yellow
} else {
  Write-Step "Starting Vite on http://${FrontendHost}:$FrontendPort"
  # 后台隐藏启动（无窗口）：日志写入 frontend/_vite_boot.log
  $frontendCmd = @"
Set-Location -LiteralPath '$FrontendDir'
& npm run dev -- --host $FrontendHost --port $FrontendPort *> '$FrontendDir\_vite_boot.log'
exit `$LASTEXITCODE
"@
  Start-Process -FilePath "powershell.exe" -WorkingDirectory $FrontendDir -WindowStyle Hidden -ArgumentList @(
    "-ExecutionPolicy", "Bypass", "-Command", $frontendCmd
  ) | Out-Null
}

Write-Step "Waiting for backend health..."
if (-not (Wait-HttpOk "http://${BackendHost}:$BackendPort/api/health" 120)) {
  Write-Warning "Backend health check timed out. Check backend/_uvicorn_boot.log."
} else {
  Write-Host "Backend OK" -ForegroundColor Green
}

Write-Step "Waiting for frontend..."
if (-not (Wait-HttpOk "http://${FrontendHost}:$FrontendPort/" 120)) {
  Write-Warning "Frontend did not respond in time. Check frontend/_vite_boot.log."
} else {
  Write-Host "Frontend OK" -ForegroundColor Green
}

$HomeUrl = "http://${FrontendHost}:$FrontendPort/"
$LhbUrl = "http://${FrontendHost}:$FrontendPort/lhb-v3?tab=hotmoney&hm=zmz"

Write-Host ""
Write-Host "Ready:" -ForegroundColor Green
Write-Host "  Home:     $HomeUrl"
Write-Host "  游资追踪: $LhbUrl"
Write-Host "  API:      http://${BackendHost}:$BackendPort/api/health"
Write-Host ""
Write-Host "Tip: use ?tab=hotmoney&hm=zmz (not tab%3D... encoded as one blob)." -ForegroundColor DarkGray

if (-not $NoBrowser) {
  Start-Process $LhbUrl
}
