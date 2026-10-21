<#
.SYNOPSIS
  Roda localmente as mesmas verificações da CI e, opcionalmente, recria o container do app.

.EXAMPLE
  ./scripts/check.ps1              # backend + frontend
  ./scripts/check.ps1 -E2E         # inclui os testes de ponta a ponta (Playwright)
  ./scripts/check.ps1 -Docker      # se tudo passar, recria o container com o código atual
#>
param(
    [switch]$E2E,
    [switch]$Docker
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Step([string]$name, [scriptblock]$action) {
    Write-Host "`n==> $name" -ForegroundColor Cyan
    & $action
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Falhou: $name" -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

$python = Join-Path $root "backend/.venv/Scripts/python.exe"
if (-not (Test-Path $python)) { $python = "python" }

Push-Location (Join-Path $root "backend")
try {
    Step "Backend: ruff" { & $python -m ruff check app tests e2e_server.py }
    Step "Backend: pytest" { & $python -m pytest -q }
} finally { Pop-Location }

Push-Location (Join-Path $root "frontend")
try {
    Step "Frontend: typecheck" { npm run typecheck }
    Step "Frontend: lint" { npm run lint }
    Step "Frontend: build" { npm run build }
    if ($E2E) { Step "Frontend: ponta a ponta" { npm run e2e } }
} finally { Pop-Location }

if ($Docker) {
    Push-Location $root
    try {
        Step "Docker: recriando o container do app" { docker compose up --build -d app }
    } finally { Pop-Location }
}

Write-Host "`nTudo certo." -ForegroundColor Green
