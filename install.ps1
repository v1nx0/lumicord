# Lumicord command-line installer. No .exe needed.
#   irm https://raw.githubusercontent.com/v1nx0/lumicord/main/install.ps1 | iex
# Interactive like the .exe: license, action, Discord version. Skip prompts with $env:LUMICORD_ACCEPT=1,
# $env:LUMICORD_ACTION = install|repair|uninstall and $env:LUMICORD_DISCORD = discord|ptb|canary.
# Mirrors Work() in installer/Installer.cs; keep the two in sync.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$builds = [ordered]@{ Discord = 'Discord'; DiscordPTB = 'Discord PTB'; DiscordCanary = 'Discord Canary' }
$data = Join-Path $env:APPDATA 'Lumicord'
function Say($m) { Write-Host "  $m" }
# Newest app-x.y.z\resources of a Discord folder, like FindResourcesIn. $null if not installed.
function FindRes($dir) {
    $app = Get-ChildItem $dir -Directory -Filter 'app-*' -ErrorAction SilentlyContinue |
        Where-Object { (Test-Path (Join-Path $_.FullName 'resources')) -and ($_.Name.Substring(4).Split('-')[0] -as [version]) } |
        Sort-Object { [version]$_.Name.Substring(4).Split('-')[0] } | Select-Object -Last 1
    if ($app) { Join-Path $app.FullName 'resources' }
}
function DirOf($b) { if ($env:LUMICORD_DISCORD_DIR) { $env:LUMICORD_DISCORD_DIR } else { Join-Path $env:LOCALAPPDATA $b } }

# Arrow-key menu (Up/Down, Enter). Falls back to typing a number when input is not a real console.
function Menu($title, $items) {
    Write-Host ""; Write-Host "  $title" -ForegroundColor White
    $live = $true; try { [void][Console]::KeyAvailable } catch { $live = $false }
    if (-not $live -or [Console]::IsInputRedirected) {
        for ($i = 0; $i -lt $items.Count; $i++) { Write-Host "   $($i + 1)) $($items[$i])" }
        while ($true) { $n = (Read-Host "  Choose 1-$($items.Count)") -as [int]; if ($n -ge 1 -and $n -le $items.Count) { return $n - 1 } }
    }
    $sel = 0; $top = [Console]::CursorTop; [Console]::CursorVisible = $false
    try {
        while ($true) {
            [Console]::SetCursorPosition(0, $top)
            for ($i = 0; $i -lt $items.Count; $i++) {
                if ($i -eq $sel) { Write-Host ("   > " + $items[$i]).PadRight(60) -ForegroundColor Magenta }
                else { Write-Host ("     " + $items[$i]).PadRight(60) -ForegroundColor Gray }
            }
            $k = [Console]::ReadKey($true).Key
            if ($k -eq 'UpArrow') { $sel = ($sel - 1 + $items.Count) % $items.Count }
            elseif ($k -eq 'DownArrow') { $sel = ($sel + 1) % $items.Count }
            elseif ($k -eq 'Enter') { return $sel }
        }
    } finally { [Console]::CursorVisible = $true }
}

Write-Host ""
Write-Host "  Lumicord Installer" -ForegroundColor Magenta
Write-Host "  A better Discord experience, made simple." -ForegroundColor DarkGray

$action = if ($env:LUMICORD_ACTION) { $env:LUMICORD_ACTION.ToLower() } else { $null }
if ($env:LUMICORD_ACCEPT -ne '1') {
    Write-Host ""
    Write-Host @'
LUMICORD LICENSE AGREEMENT  (Last updated: November 2026)

By installing or using Lumicord you agree to these terms. If you do not agree, do not install Lumicord.

1. LICENSE - Lumicord is free and open source software under the GNU GPL v3 (https://www.gnu.org/licenses/gpl-3.0.html). Source: https://github.com/v1nx0/lumicord
2. NO AFFILIATION - Lumicord is not made, endorsed or supported by Discord Inc., Vencord or BetterDiscord. "Discord" is a trademark of Discord Inc.
3. DISCORD TERMS OF SERVICE - Modifying the Discord client is against Discord's Terms of Service. Discord may limit, suspend or ban accounts that use client mods. You use Lumicord entirely at your own risk.
4. PLUGINS AND THEMES - Plugins run inside Discord with the same access as Discord, including your account and messages. Only install plugins and themes you trust.
5. WHAT CHANGES ON YOUR COMPUTER - The selected Discord installation is modified so Lumicord loads, and files are stored in %APPDATA%\Lumicord. Discord updates may remove Lumicord; run this again and choose Repair. Uninstall restores Discord and keeps your plugins, themes and settings.
6. NETWORK AND PRIVACY - Lumicord does not collect or send your personal data. It only connects to GitHub for signed updates, to betterdiscord.app for the Marketplace, and to addresses installed plugins request.
7. THIRD-PARTY COMPONENTS - Vencord (GPL-3.0), included. BetterDiscord's plugin API (Apache-2.0) is reimplemented. Each keeps its own license.
8. NO WARRANTY - Lumicord is provided "as is", without warranty of any kind. See sections 15 and 16 of the GPL-3.0.
9. LIMITATION OF LIABILITY - The authors are not liable for any damages, data loss or account actions from using Lumicord, its plugins or themes.
10. CHANGES - New versions may update this agreement. Continuing to use Lumicord after an update means you accept the updated terms.
'@ -ForegroundColor Gray
    if ((Menu 'Do you accept the license agreement?' @('I accept', 'I do not accept')) -ne 0) { Write-Host "  Cancelled. Nothing was changed."; return }
}
if (-not $action) { $action = @('install', 'repair', 'uninstall')[(Menu 'What do you want to do?' @('Install Lumicord', 'Repair (after a Discord update)', 'Uninstall'))] }
if ($action -notin 'install', 'repair', 'uninstall') { throw "LUMICORD_ACTION must be install, repair or uninstall" }

if ($env:LUMICORD_DISCORD) {
    $build = switch ($env:LUMICORD_DISCORD.ToLower()) { 'ptb' { 'DiscordPTB' } 'canary' { 'DiscordCanary' } default { 'Discord' } }
} else {
    $found = @($builds.Keys | Where-Object { FindRes (DirOf $_) })
    if (-not $found) { throw 'No Discord installation found.' }
    $build = if ($found.Count -eq 1) { $found[0] } else { $found[(Menu 'Which Discord?' @($found | ForEach-Object { $builds[$_] }))] }
}
$res = FindRes (DirOf $build)
if (-not $res) { throw "$($builds[$build]) not found" }
Write-Host ""
Write-Host "  $((Get-Culture).TextInfo.ToTitleCase($action))ing Lumicord for $($builds[$build])..." -ForegroundColor Magenta

Say "Discord: $res"

$procs = Get-Process -Name $build -ErrorAction SilentlyContinue
if ($procs) { Say "Closing $build..."; $procs | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep 2 }

$asar = Join-Path $res 'app.asar'; $orig = Join-Path $res '_app.asar'; $appDir = Join-Path $res 'app'
if ($action -eq 'uninstall') {
    # Restore Discord's archive first, then remove the loader, so Discord can always start.
    if (Test-Path $orig) { if (Test-Path $asar) { Remove-Item $orig } else { Move-Item $orig $asar }; Say 'Restored app.asar' }
    if (Test-Path $appDir) { Remove-Item $appDir -Recurse -Force; Say 'Removed loader' }
} else {
    # Files from the latest release's source. src/, vencord/, version.json are replaced; user plugins/themes are kept.
    $tag = (Invoke-RestMethod 'https://api.github.com/repos/v1nx0/lumicord/releases/latest').tag_name
    Say "Downloading Lumicord $tag..."
    $tmp = Join-Path $env:TEMP "lumicord-$([guid]::NewGuid())"
    New-Item -ItemType Directory $tmp | Out-Null
    try {
        Invoke-WebRequest "https://codeload.github.com/v1nx0/lumicord/zip/refs/tags/$tag" -OutFile "$tmp\src.zip" -UseBasicParsing
        Expand-Archive "$tmp\src.zip" $tmp
        $srcRoot = (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName
        $files = @(Get-Item "$srcRoot\version.json") +
            @(Get-ChildItem "$srcRoot\src" -Filter *.js) + @(Get-ChildItem "$srcRoot\plugins" -Filter *.js -ErrorAction SilentlyContinue) +
            @(Get-ChildItem "$srcRoot\themes" -Filter *.css -ErrorAction SilentlyContinue) +
            @(Get-ChildItem "$srcRoot\vencord" -File | Where-Object { $_.Extension -in '.js', '.css', '.txt' -or $_.Name -eq 'LICENSE' })
        foreach ($f in $files) {
            $rel = $f.FullName.Substring($srcRoot.Length + 1)
            $dest = Join-Path $data $rel
            $always = $rel -like 'src*' -or $rel -like 'vencord*' -or $rel -eq 'version.json'
            if (-not $always -and (Test-Path $dest)) { continue }
            New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
            Copy-Item $f.FullName $dest -Force
        }
        Say "Copied $($files.Count) files to $data"
    } finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }

    # Discord replaced its own app.asar while ours is still around: the new one is the real one.
    if ((Test-Path $orig) -and (Test-Path $asar)) { Remove-Item $orig; Say 'Replacing outdated _app.asar' }
    if (-not (Test-Path $orig) -and -not (Test-Path $asar)) { throw 'app.asar not found' }
    # Loader before rename; undo the loader if the rename fails, so Discord can always start.
    New-Item -ItemType Directory -Force $appDir | Out-Null
    try {
        $enc = New-Object System.Text.UTF8Encoding $false
        [IO.File]::WriteAllText((Join-Path $appDir 'package.json'), '{"name":"discord","main":"index.js"}', $enc)
        $patcher = (Join-Path $data 'src\patcher.js').Replace('\', '\\')
        [IO.File]::WriteAllText((Join-Path $appDir 'index.js'), "require(`"$patcher`");`n", $enc)
        Say 'Wrote loader'
        if (-not (Test-Path $orig)) { Move-Item $asar $orig; Say 'Renamed app.asar -> _app.asar' }
    } catch {
        if (-not (Test-Path $orig)) { Remove-Item $appDir -Recurse -Force -ErrorAction SilentlyContinue }
        throw
    }
}

$update = Join-Path (Split-Path (Split-Path $res)) 'Update.exe'
if ((Test-Path $update) -and -not $env:LUMICORD_NO_START) { Say "Starting $build..."; Start-Process $update "--processStart $build.exe" }
Write-Host $(if ($action -eq 'uninstall') { 'Lumicord was removed.' } else { 'Done. Lumicord is in Discord User Settings.' }) -ForegroundColor Magenta
