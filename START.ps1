$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (!(Test-Path '.venv\Scripts\python.exe')) { throw 'Run INSTALL.ps1 first.' }
& .\.venv\Scripts\python.exe run.py @args
