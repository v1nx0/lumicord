# One scheduled pass. The installer runs this once per minute after a chosen Discord edition updates.
$data = Join-Path $env:APPDATA 'Lumicord'
$targets = Join-Path $data 'auto-repair.txt'
if (-not (Test-Path $targets)) { exit }
$mutex = New-Object Threading.Mutex($false, 'LumicordUpdateRepair')
if (-not $mutex.WaitOne(0)) { exit }
try {
    foreach ($entry in @(Get-Content $targets -ErrorAction SilentlyContinue)) {
        $parts = $entry -split '\|', 2
        if ($parts.Count -ne 2) { continue }
        $build, $separate = $parts
        if ($build -notin 'Discord', 'DiscordPTB', 'DiscordCanary' -or $separate -notin '0', '1') { continue }
        $dir = Join-Path $env:LOCALAPPDATA $build
        $app = Get-ChildItem $dir -Directory -Filter 'app-*' -ErrorAction SilentlyContinue |
            Where-Object { (Test-Path (Join-Path $_.FullName 'resources')) -and ($_.Name.Substring(4).Split('-')[0] -as [version]) } |
            Sort-Object { [version]$_.Name.Substring(4).Split('-')[0] } | Select-Object -Last 1
        if (-not $app) { continue }
        $res = Join-Path $app.FullName 'resources'; $asar = Join-Path $res 'app.asar'; $orig = Join-Path $res '_app.asar'; $loader = Join-Path $res 'app'
        if (-not (Test-Path $asar)) { continue } # already patched, or Discord is replacing files
        $tag = [guid]::NewGuid().ToString('N')
        $newLoader = "$loader.lumicord-new-$tag"; $oldLoader = "$loader.lumicord-old-$tag"; $oldAsar = "$orig.lumicord-old-$tag"
        try {
            New-Item -ItemType Directory -Force $newLoader | Out-Null
            [IO.File]::WriteAllText((Join-Path $newLoader 'package.json'), '{"name":"discord","main":"index.js"}', (New-Object System.Text.UTF8Encoding $false))
            $patcher = (Join-Path $data 'src\patcher.js').Replace('\', '\\')
            $profile = if ($separate -eq '1') { 'process.env.LUMICORD_PROFILE = "' + $build + '";' + [Environment]::NewLine } else { '' }
            [IO.File]::WriteAllText((Join-Path $newLoader 'index.js'), $profile + 'require("' + $patcher + '");' + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding $false))
            if (Test-Path $orig) { Move-Item $orig $oldAsar }
            Move-Item $asar $orig
            if (Test-Path $loader) { Move-Item $loader $oldLoader }
            Move-Item $newLoader $loader
            Remove-Item $oldAsar, $oldLoader -Recurse -Force -ErrorAction SilentlyContinue
        } catch {
            Remove-Item $newLoader -Recurse -Force -ErrorAction SilentlyContinue
            if (-not (Test-Path $loader) -and (Test-Path $oldLoader)) { Move-Item $oldLoader $loader -ErrorAction SilentlyContinue }
            if (-not (Test-Path $asar) -and (Test-Path $orig)) { Move-Item $orig $asar -ErrorAction SilentlyContinue }
            if (-not (Test-Path $orig) -and (Test-Path $oldAsar)) { Move-Item $oldAsar $orig -ErrorAction SilentlyContinue }
        }
    }
} finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
