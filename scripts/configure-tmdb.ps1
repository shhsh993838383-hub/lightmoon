param([string]$EnvPath = (Join-Path (Split-Path $PSScriptRoot -Parent) '.env'))
& (Join-Path $PSScriptRoot 'configure-deepseek.ps1') -EnvPath $EnvPath -Provider TMDB
