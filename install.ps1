# One-command install:  irm https://raw.githubusercontent.com/v1nx0/lumicord/main/install.ps1 | iex
# PTB/Canary: set $env:LUMICORD_DISCORD = "ptb" or "canary" first. Action: $env:LUMICORD_ACTION = "repair" or "uninstall".
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:APPDATA 'Lumicord'
New-Item -ItemType Directory -Force $dir | Out-Null
$exe = Join-Path $dir 'LumicordInstaller.exe'
Write-Host 'Downloading the latest Lumicord installer...'
Invoke-WebRequest 'https://github.com/v1nx0/lumicord/releases/latest/download/LumicordInstaller.exe' -OutFile $exe -UseBasicParsing
$action = if ($env:LUMICORD_ACTION) { $env:LUMICORD_ACTION } else { 'install' }
$build = if ($env:LUMICORD_DISCORD) { $env:LUMICORD_DISCORD } else { 'discord' }
$p = Start-Process $exe -ArgumentList '--cli', $action, $build -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { Write-Host "Lumicord $action failed (code $($p.ExitCode))." -ForegroundColor Red } else { Write-Host 'Open Discord: Lumicord is in User Settings.' -ForegroundColor Magenta }
