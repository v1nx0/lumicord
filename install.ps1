# Lumicord command-line installer. No .exe needed.
#   irm https://raw.githubusercontent.com/v1nx0/lumicord/main/install.ps1 | iex
# Options (set before running): $env:LUMICORD_ACTION = install | repair | uninstall
#                               $env:LUMICORD_DISCORD = discord | ptb | canary
# Mirrors Work() in installer/Installer.cs; keep the two in sync.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$action = if ($env:LUMICORD_ACTION) { $env:LUMICORD_ACTION.ToLower() } else { 'install' }
$build = switch (($env:LUMICORD_DISCORD + '').ToLower()) { 'ptb' { 'DiscordPTB' } 'canary' { 'DiscordCanary' } default { 'Discord' } }
if ($action -notin 'install', 'repair', 'uninstall') { throw "LUMICORD_ACTION must be install, repair or uninstall" }
$data = Join-Path $env:APPDATA 'Lumicord'
$root = if ($env:LUMICORD_DISCORD_DIR) { $env:LUMICORD_DISCORD_DIR } else { Join-Path $env:LOCALAPPDATA $build }

function Say($m) { Write-Host "  $m" }
Write-Host "Lumicord $action ($build)" -ForegroundColor Magenta

# Newest app-x.y.z\resources, like FindResourcesIn.
$app = Get-ChildItem $root -Directory -Filter 'app-*' -ErrorAction SilentlyContinue |
    Where-Object { (Test-Path (Join-Path $_.FullName 'resources')) -and ($_.Name.Substring(4).Split('-')[0] -as [version]) } |
    Sort-Object { [version]$_.Name.Substring(4).Split('-')[0] } | Select-Object -Last 1
if (-not $app) { throw "$build not found in $root" }
$res = Join-Path $app.FullName 'resources'
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
