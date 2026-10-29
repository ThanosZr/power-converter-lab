$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
py -3 -m venv .venv
if ($LASTEXITCODE -ne 0) { throw 'Install Python 3.11+ with the Python launcher (py).' }
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check your connection and terminal output.' }
Write-Host 'Ready. Start with: powershell -ExecutionPolicy Bypass -File .\START.ps1'
