# Lumicord command-line installer. No .exe needed. Looks and works like LumicordInstaller.exe.
#   irm https://raw.githubusercontent.com/v1nx0/lumicord/main/install.ps1 | iex
# Steps: Welcome -> License -> Action -> Discord version -> Install (arrow keys, Enter, Esc cancels).
# Skip prompts with $env:LUMICORD_ACCEPT=1, $env:LUMICORD_ACTION = install|repair|uninstall,
# $env:LUMICORD_DISCORD = discord|ptb|canary, $env:LUMICORD_SEPARATE = 1|0.
# Install logic mirrors Work() in installer/Installer.cs; keep the two in sync.
& {
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$builds = [ordered]@{ Discord = 'Discord'; DiscordPTB = 'Discord PTB'; DiscordCanary = 'Discord Canary' }
$data = Join-Path $env:APPDATA 'Lumicord'
$steps = 'Welcome', 'License', 'Action', 'Discord version', 'Install'
$live = $true; try { [void][Console]::KeyAvailable; if ([Console]::IsInputRedirected) { $live = $false } } catch { $live = $false }

# ---------- look: same palette as the .exe (pink #ec4899 on black, flat) ----------
$vt = $Host.UI.SupportsVirtualTerminal
$E = [char]27
$C = @{ accent = '236;72;153'; text = '240;240;245'; muted = '140;140;155'; ok = '236;72;153'; err = '239;68;68' }
$F = @{ accent = 'Magenta'; text = 'White'; muted = 'DarkGray'; ok = 'Magenta'; err = 'Red' }
$G = @{ check = [char]0x2713; dot = [char]0x25CF; ring = [char]0x25CB; bar = [char]0x258C; star = [char]0x2726; line = [char]0x2500; mid = [char]0x00B7; arrow = [char]0x2192 }
function P($text, $kind = 'text', [switch]$NoNewline, [switch]$Bold) {
    if ($vt) { $b = if ($Bold) { "$E[1m" } else { '' }; Write-Host "$b$E[38;2;$($C[$kind])m$text$E[0m" -NoNewline:$NoNewline }
    else { Write-Host $text -ForegroundColor $F[$kind] -NoNewline:$NoNewline }
}
function Width { if ($live) { [Math]::Max(40, [Console]::WindowWidth - 1) } else { 100 } }
# Word-wrap to the window, indented, so long text never breaks mid-word.
function Wrap($text, $kind = 'muted', $indent = 2) {
    $max = (Width) - $indent
    foreach ($para in ($text -split "`n")) {
        $line = ''
        foreach ($w in ($para -split ' ')) {
            if ($line -and ($line.Length + 1 + $w.Length) -gt $max) { P ((' ' * $indent) + $line) $kind; $line = $w }
            else { $line = if ($line) { "$line $w" } else { $w } }
        }
        P ((' ' * $indent) + $line) $kind
    }
}
# One screen per step, like the .exe's pages: header, step rail, heading, subheading.
function Screen($step, $title, $sub) {
    if ($live) { Clear-Host } else { Write-Host '' }
    Write-Host ''
    P "  $($G.star) " accent -NoNewline; P 'Lumicord' text -Bold -NoNewline; P "  Installer $($G.mid) $ver" muted
    P ('  ' + ([string]$G.line * ((Width) - 4))) muted
    Write-Host '  ' -NoNewline
    for ($i = 0; $i -lt $steps.Count; $i++) {
        if ($i -lt $step) { P "$($G.check) $($steps[$i])" accent -NoNewline }
        elseif ($i -eq $step) { P "$($G.dot) $($steps[$i])" text -Bold -NoNewline }
        else { P "$($G.ring) $($steps[$i])" muted -NoNewline }
        if ($i -lt $steps.Count - 1) { P '   ' muted -NoNewline }
    }
    Write-Host ''; Write-Host ''
    P "  $title" text -Bold
    if ($sub) { P "  $sub" muted }
    Write-Host ''
}

# Arrow-key menu (Up/Down, Enter, Esc). Typing a number when input is not a real console.
function Menu($items, $hint = $true) {
    $n = $items.Count
    if (-not $live) {
        for ($i = 0; $i -lt $n; $i++) { P "   $($i + 1)) $($items[$i])" text }
        while ($true) { $k = (Read-Host "  Choose 1-$n") -as [int]; if ($k -ge 1 -and $k -le $n) { return $k - 1 } }
    }
    # Reserve the lines, then re-anchor after every draw: scrolling can never shift or duplicate the menu.
    for ($i = 0; $i -lt $n + 2; $i++) { Write-Host '' }
    $top = [Console]::CursorTop - $n - 2; $w = Width; $sel = 0
    [Console]::CursorVisible = $false
    try {
        while ($true) {
            [Console]::SetCursorPosition(0, $top)
            for ($i = 0; $i -lt $n; $i++) {
                $t = $items[$i]; if ($t.Length -gt $w - 6) { $t = $t.Substring(0, $w - 6) }
                if ($i -eq $sel) { P ("  $($G.bar) " + $t).PadRight($w) accent -Bold } else { P ("    " + $t).PadRight($w) muted }
            }
            Write-Host ''.PadRight($w)
            if ($hint) { P ("  Up/Down to move $($G.mid) Enter to select $($G.mid) Esc to cancel").PadRight($w) muted } else { Write-Host ''.PadRight($w) }
            $top = [Console]::CursorTop - $n - 2
            $k = [Console]::ReadKey($true).Key
            if ($k -eq 'UpArrow') { $sel = ($sel - 1 + $n) % $n }
            elseif ($k -eq 'DownArrow') { $sel = ($sel + 1) % $n }
            elseif ($k -eq 'Enter') { return $sel }
            elseif ($k -eq 'Escape') { throw 'Cancelled. Nothing was changed.' }
        }
    } finally { try { [Console]::SetCursorPosition(0, $top + $n + 2) } catch { }; [Console]::CursorVisible = $true }
}

# ---------- Discord detection ----------
function DirOf($b) { if ($env:LUMICORD_DISCORD_DIR) { $env:LUMICORD_DISCORD_DIR } else { Join-Path $env:LOCALAPPDATA $b } }
# Newest app-x.y.z\resources of a Discord folder, like FindResourcesIn. $null if not installed.
function FindRes($dir) {
    $app = Get-ChildItem $dir -Directory -Filter 'app-*' -ErrorAction SilentlyContinue |
        Where-Object { (Test-Path (Join-Path $_.FullName 'resources')) -and ($_.Name.Substring(4).Split('-')[0] -as [version]) } |
        Sort-Object { [version]$_.Name.Substring(4).Split('-')[0] } | Select-Object -Last 1
    if ($app) { Join-Path $app.FullName 'resources' }
}
# Loaders Lumicord wrote in any app-* folder of a build (a Discord update makes a new app-* without one).
function Loaders($b) {
    Get-ChildItem (DirOf $b) -Directory -Filter 'app-*' -ErrorAction SilentlyContinue |
        ForEach-Object { Join-Path $_.FullName 'resources\app\index.js' } |
        Where-Object { (Test-Path $_) -and ((Get-Content $_ -Raw) -match 'patcher\.js') }
}
function IsSeparate($b) { [bool](Loaders $b | Where-Object { (Get-Content $_ -Raw) -match 'LUMICORD_PROFILE' }) }

# ---------- install logic ----------
# Downloads the release's files to a temp folder. Done BEFORE closing Discord, so a failed download leaves Discord alone.
function Fetch {
    $script:tmp = Join-Path $env:TEMP "lumicord-$([guid]::NewGuid())"
    New-Item -ItemType Directory $tmp | Out-Null
    $ref = if ($ver -like 'v*') { "refs/tags/$ver" } else { 'refs/heads/main' }
    Invoke-WebRequest "https://codeload.github.com/v1nx0/lumicord/zip/$ref" -OutFile "$tmp\src.zip" -UseBasicParsing
    Expand-Archive "$tmp\src.zip" $tmp
    (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName
}
# src/, vencord/, version.json are replaced; the user's plugins and themes are kept.
function CopyFiles($srcRoot) {
    $files = @(Get-Item "$srcRoot\version.json") +
        @(Get-ChildItem "$srcRoot\src" -Filter *.js) + @(Get-ChildItem "$srcRoot\plugins" -Filter *.js -ErrorAction SilentlyContinue) +
        @(Get-ChildItem "$srcRoot\themes" -Filter *.css -ErrorAction SilentlyContinue) +
        @(Get-ChildItem "$srcRoot\vencord" -File | Where-Object { $_.Extension -in '.js', '.css', '.txt' -or $_.Name -eq 'LICENSE' })
    foreach ($f in $files) {
        $rel = $f.FullName.Substring($srcRoot.Length + 1)
        $dest = Join-Path $data $rel
        if (-not ($rel -like 'src*' -or $rel -like 'vencord*' -or $rel -eq 'version.json') -and (Test-Path $dest)) { continue }
        New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
        Copy-Item $f.FullName $dest -Force
    }
    $files.Count
}
function Done($m) { P "  $($G.check) " accent -NoNewline; P $m text }
# Starts Discord and checks that it is really running. Tries Discord's own launcher (Update.exe) first,
# then Discord.exe directly; tells the user if both fail instead of claiming it started.
function StartDiscord($build, $res) {
    $update = Join-Path (Split-Path (Split-Path $res)) 'Update.exe'
    $exe = Join-Path (Split-Path $res) "$build.exe"
    foreach ($try in @(@($update, "--processStart `"$build.exe`""), @($exe, $null))) {
        if (-not (Test-Path $try[0])) { continue }
        if ($try[1]) { Start-Process -FilePath $try[0] -ArgumentList $try[1] } else { Start-Process -FilePath $try[0] }
        for ($i = 0; $i -lt 40; $i++) { Start-Sleep -Milliseconds 250; if (Get-Process -Name $build -ErrorAction SilentlyContinue) { Done "Started $($builds[$build])"; return } }
    }
    P "  Could not start $($builds[$build]). Open it from the Start menu." err
}
function Work($action, $build, $separate) {
    $res = FindRes (DirOf $build)
    if (-not $res) { throw "$($builds[$build]) was not found." }
    Done "Found $($builds[$build])"
    $closed = $false
    $procs = Get-Process -Name $build -ErrorAction SilentlyContinue
    if ($procs) {
        $procs | Stop-Process -Force -ErrorAction SilentlyContinue
        # Wait until every Discord process is really gone: a dying instance holds the single-instance lock,
        # and a Discord started too early hands off to it and quits (Discord "doesn't open").
        for ($i = 0; $i -lt 40 -and (Get-Process -Name $build -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 250 }
        $closed = $true; Done "Closed $($builds[$build])"
    }
    try {
        $asar = Join-Path $res 'app.asar'; $orig = Join-Path $res '_app.asar'; $appDir = Join-Path $res 'app'
        if ($action -eq 'uninstall') {
            # Restore Discord's archive first, then remove the loader, so Discord can always start.
            if (Test-Path $orig) { if (Test-Path $asar) { Remove-Item $orig } else { Move-Item $orig $asar }; Done 'Restored Discord' }
            if (Test-Path $appDir) { Remove-Item $appDir -Recurse -Force; Done 'Removed the Lumicord loader' }
        } else {
            # Discord replaced its own app.asar while ours is still around: the new one is the real one.
            if ((Test-Path $orig) -and (Test-Path $asar)) { Remove-Item $orig }
            if (-not (Test-Path $orig) -and -not (Test-Path $asar)) { throw 'Discord''s app.asar was not found.' }
            # Loader before rename; undo the loader if the rename fails, so Discord can always start.
            New-Item -ItemType Directory -Force $appDir | Out-Null
            try {
                $enc = New-Object System.Text.UTF8Encoding $false
                [IO.File]::WriteAllText((Join-Path $appDir 'package.json'), '{"name":"discord","main":"index.js"}', $enc)
                $patcher = (Join-Path $data 'src\patcher.js').Replace('\', '\\')
                $profileLine = if ($separate) { "process.env.LUMICORD_PROFILE = `"$build`";`n" } else { '' }
                [IO.File]::WriteAllText((Join-Path $appDir 'index.js'), $profileLine + "require(`"$patcher`");`n", $enc)
                if (-not (Test-Path $orig)) { Move-Item $asar $orig }
            } catch {
                if (-not (Test-Path $orig)) { Remove-Item $appDir -Recurse -Force -ErrorAction SilentlyContinue }
                throw
            }
            Done $(if ($separate) { "Patched $($builds[$build]) (separate plugins and themes)" } else { "Patched $($builds[$build])" })
        }
    } finally {
        # Start Discord again, also when something failed, so the user is never left without it.
        if ($env:LUMICORD_NO_START) { P '  Not starting Discord (LUMICORD_NO_START is set in this window).' muted }
        elseif ($closed -or $action -ne 'uninstall') { StartDiscord $build $res }
    }
}

try {
    $ver = 'main'
    try { $ver = (Invoke-RestMethod 'https://api.github.com/repos/v1nx0/lumicord/releases/latest' -TimeoutSec 10).tag_name } catch { }   # rate limit: fall back to main

    $action = if ($env:LUMICORD_ACTION) { $env:LUMICORD_ACTION.ToLower() } else { $null }
    if ($action -and $action -notin 'install', 'repair', 'uninstall') { throw 'LUMICORD_ACTION must be install, repair or uninstall.' }
    $installed = @($builds.Keys | Where-Object { Loaders $_ })
    $targets = $null; $quick = $false

    # 1. Welcome
    if (-not $action -and $env:LUMICORD_ACCEPT -ne '1') {
        Screen 0 'Welcome to Lumicord' 'A better Discord experience, made simple.'
        P "  $($G.dot) " accent -NoNewline; P 'BetterDiscord plugins & themes' text
        P "  $($G.dot) " accent -NoNewline; P 'Built-in Marketplace' text
        P "  $($G.dot) " accent -NoNewline; P 'Signed automatic updates' text
        $opts = @("Get started $($G.arrow)")
        if ($installed) { $opts += "Repair in one click  ($(($installed | ForEach-Object { $builds[$_] }) -join ', '))" }
        $opts += 'Quit'
        $pick = $opts[(Menu $opts)]
        if ($pick -eq 'Quit') { throw 'Cancelled. Nothing was changed.' }
        if ($pick -like 'Repair*') { $action = 'repair'; $targets = $installed; $quick = $true }
    }

    # 2. License (one-click repair skips it, like the .exe)
    if (-not $targets -and $env:LUMICORD_ACCEPT -ne '1') {
        Screen 1 'License agreement' 'Please review the terms before continuing.'
        Wrap @'
LUMICORD LICENSE AGREEMENT (last updated November 2026). By installing or using Lumicord you agree to these terms. If you do not agree, do not install Lumicord.
1. LICENSE - Free and open source under the GNU GPL v3 (gnu.org/licenses/gpl-3.0.html). Source: github.com/v1nx0/lumicord
2. NO AFFILIATION - Not made, endorsed or supported by Discord Inc., Vencord or BetterDiscord. "Discord" is a trademark of Discord Inc.
3. DISCORD TERMS OF SERVICE - Modifying the Discord client is against Discord's Terms of Service. Discord may limit, suspend or ban accounts that use client mods. You use Lumicord entirely at your own risk.
4. PLUGINS AND THEMES - Plugins run inside Discord with the same access as Discord, including your account and messages. Only install plugins and themes you trust.
5. WHAT CHANGES ON YOUR COMPUTER - The selected Discord is modified so Lumicord loads; files are stored in %APPDATA%\Lumicord. Discord updates may remove Lumicord; run this again and choose Repair. Uninstall restores Discord and keeps your plugins, themes and settings.
6. NETWORK AND PRIVACY - Lumicord does not collect or send your personal data. It only connects to GitHub for signed updates, betterdiscord.app for the Marketplace, and addresses installed plugins request.
7. THIRD-PARTY COMPONENTS - Vencord (GPL-3.0), included. BetterDiscord's plugin API (Apache-2.0), reimplemented. Each keeps its own license.
8. NO WARRANTY - Provided "as is", without warranty of any kind. See sections 15 and 16 of the GPL-3.0.
9. LIMITATION OF LIABILITY - The authors are not liable for any damages, data loss or account actions from using Lumicord, its plugins or themes.
10. CHANGES - New versions may update this agreement. Continuing to use Lumicord after an update means you accept the updated terms.
'@
        Write-Host ''
        if ((Menu @('I accept the license agreement', 'I do not accept')) -ne 0) { throw 'Cancelled. Nothing was changed.' }
    }

    # 3. Action
    if (-not $action) {
        Screen 2 'What would you like to do?' 'Choose an action.'
        $action = @('install', 'repair', 'uninstall')[(Menu @('Install    Add Lumicord to Discord', 'Repair     Fix Lumicord after a Discord update', 'Uninstall  Remove Lumicord, keep your plugins and settings'))]
    }

    # 4. Discord version
    $separate = $false
    if (-not $targets) {
        if ($env:LUMICORD_DISCORD) {
            $build = switch ($env:LUMICORD_DISCORD.ToLower()) { 'ptb' { 'DiscordPTB' } 'canary' { 'DiscordCanary' } default { 'Discord' } }
        } else {
            $found = @($builds.Keys | Where-Object { FindRes (DirOf $_) })
            if (-not $found) { throw 'No Discord installation was found.' }
            Screen 3 'Discord version' "Pick the Discord installation to $action."
            foreach ($b in $builds.Keys) {
                if ($found -contains $b) { P "  $($G.check) " accent -NoNewline; P "$($builds[$b])  $($G.mid) Found" text }
                else { P "  $($G.ring) $($builds[$b])  $($G.mid) Not found" muted }
            }
            Write-Host ''
            $build = if ($found.Count -eq 1) { $found[0] } else { $found[(Menu @($found | ForEach-Object { $builds[$_] }))] }
        }
        $targets = @($build)
        # "Don't share plugins and themes with other Discord versions", same as the .exe checkbox. Repair keeps the old choice.
        if ($action -ne 'uninstall') {
            if ($env:LUMICORD_SEPARATE) { $separate = $env:LUMICORD_SEPARATE -eq '1' }
            elseif ($action -eq 'repair' -and (Loaders $build)) { $separate = IsSeparate $build }
            else {
                if ($env:LUMICORD_DISCORD -or $found.Count -eq 1) { Screen 3 'Discord version' "Installing to $($builds[$build])." }
                P '  Plugins and themes' text
                $separate = (Menu @('Share with other Discord versions', "Don't share plugins and themes with other Discord versions")) -eq 1
            }
        }
    }

    # 5. Install
    $verb = @{ install = 'Installing'; repair = 'Repairing'; uninstall = 'Uninstalling' }[$action]
    Screen 4 $verb 'This may take a moment.'
    if ($action -ne 'uninstall') {
        $srcRoot = Fetch
        try { $n = CopyFiles $srcRoot; Done "Downloaded Lumicord $ver ($n files)" } finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
    }
    foreach ($b in $targets) { Work $action $b $(if ($quick) { IsSeparate $b } else { $separate }) }
    Write-Host ''
    P $(if ($action -eq 'uninstall') { '  Uninstalled' } else { '  Installed' }) accent -Bold
    P $(if ($action -eq 'uninstall') { '  Lumicord was removed. Your plugins, themes and settings are kept.' } else { '  Lumicord is ready. Open Discord and find Lumicord in User Settings.' }) muted
    Write-Host ''
} catch {
    Write-Host ''
    P "  $($_.Exception.Message)" err
    Write-Host ''
}
}
