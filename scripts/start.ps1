param(
    [int]$WebPort = 3000,
    [int]$ApiPort = 8000,
    [string]$DataDir = "",
    [switch]$NoWeb,
    [switch]$Demo
)
$ErrorActionPreference = "Stop"
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskPython = Join-Path $taskRoot "apps/api/.venv/Scripts/python.exe"
if (-not (Test-Path -LiteralPath $taskPython)) {
    throw "Backend environment missing. In apps/api run: uv sync --locked"
}
if (-not $DataDir) { $DataDir = Join-Path $taskRoot "data" }
$taskArguments = @("-m", "agent_school.launcher", "start", "--root", $taskRoot,
    "--data-dir", $DataDir, "--web-port", "$WebPort", "--api-port", "$ApiPort")
if ($NoWeb) { $taskArguments += "--no-web" }
if ($Demo) { $taskArguments += "--demo" }
& $taskPython @taskArguments
exit $LASTEXITCODE
