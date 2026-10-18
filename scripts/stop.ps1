param([string]$DataDir = "")
$ErrorActionPreference = "Stop"
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskPython = Join-Path $taskRoot "apps/api/.venv/Scripts/python.exe"
if (-not (Test-Path -LiteralPath $taskPython)) { throw "Backend Python environment missing." }
if (-not $DataDir) { $DataDir = Join-Path $taskRoot "data" }
& $taskPython -m agent_school.launcher stop --root $taskRoot --data-dir $DataDir
exit $LASTEXITCODE
