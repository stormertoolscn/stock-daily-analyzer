# 无窗口隐藏启动入口：调用 start-dev.ps1，输出写入临时日志
# 服务日志：backend/_uvicorn_boot.log、frontend/_vite_boot.log
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $env:TEMP "lhb-launcher.log"
& (Join-Path $root "start-dev.ps1") @args *> $log
exit $LASTEXITCODE
