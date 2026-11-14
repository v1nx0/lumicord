# Builds installer\icon.ico (+ icon.png preview) from Codex's icon-codex.png.
# The generated image has stray specks around the badge, so: find the badge (rows/columns that are mostly opaque),
# cut it out with an anti-aliased rounded-square mask, then write PNG frames at 256/64/48/32/16 px.
Add-Type -AssemblyName System.Drawing
$src = [Drawing.Bitmap]::FromFile("$PSScriptRoot\icon-codex.png")
$W = $src.Width; $H = $src.Height

# badge bounds: first/last row and column where more than 40% of pixels are opaque
function Bounds($len, $other, $isRow) {
    $first = -1; $last = -1
    for ($i = 0; $i -lt $len; $i += 1) {
        $n = 0
        for ($j = 0; $j -lt $other; $j += 4) { $p = if ($isRow) { $src.GetPixel($j, $i) } else { $src.GetPixel($i, $j) }; if ($p.A -gt 200) { $n++ } }
        if ($n -gt ($other / 4) * 0.4) { if ($first -lt 0) { $first = $i }; $last = $i }
    }
    return @($first, $last)
}
$rows = Bounds $H $W $true
$cols = Bounds $W $H $false
$bx = $cols[0]; $by = $rows[0]; $bw = $cols[1] - $cols[0] + 1; $bh = $rows[1] - $rows[0] + 1
Write-Host "badge: x=$bx y=$by w=$bw h=$bh"

function RoundRect($x, $y, $w, $h, $r) {
    $p = New-Object Drawing.Drawing2D.GraphicsPath; $d = $r * 2
    $p.AddArc($x, $y, $d, $d, 180, 90); $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90); $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90); $p.CloseFigure(); $p
}

# Square canvas with a small margin; the badge is masked so nothing outside it survives.
$size = [Math]::Max($bw, $bh); $margin = [int]($size * 0.04); $C = $size + 2 * $margin
$clean = New-Object Drawing.Bitmap $C, $C
$g = [Drawing.Graphics]::FromImage($clean)
$g.SmoothingMode = 'AntiAlias'; $g.PixelOffsetMode = 'HighQuality'; $g.InterpolationMode = 'HighQualityBicubic'
$ox = $margin + ($size - $bw) / 2; $oy = $margin + ($size - $bh) / 2
$tex = New-Object Drawing.TextureBrush($src, (New-Object Drawing.Rectangle $bx, $by, $bw, $bh))
$tex.TranslateTransform($ox, $oy)
$inset = 3  # trim the badge's own soft edge a little so no fringe remains
$mask = RoundRect ($ox + $inset) ($oy + $inset) ($bw - 2 * $inset) ($bh - 2 * $inset) ([Math]::Min($bw, $bh) * 0.235)
$g.FillPath($tex, $mask)
$g.Dispose(); $src.Dispose()

function Scaled($s) {
    $b = New-Object Drawing.Bitmap $s, $s
    $gg = [Drawing.Graphics]::FromImage($b); $gg.InterpolationMode = 'HighQualityBicubic'; $gg.PixelOffsetMode = 'HighQuality'; $gg.SmoothingMode = 'AntiAlias'
    $gg.DrawImage($clean, 0, 0, $s, $s); $gg.Dispose(); $b
}
(Scaled 512).Save("$PSScriptRoot\icon.png", [Drawing.Imaging.ImageFormat]::Png)

$sizes = 256, 64, 48, 32, 16
$frames = foreach ($s in $sizes) { $b = Scaled $s; $ms = New-Object IO.MemoryStream; $b.Save($ms, [Drawing.Imaging.ImageFormat]::Png); , $ms.ToArray() }
$out = New-Object IO.BinaryWriter([IO.File]::Create("$PSScriptRoot\icon.ico"))
$out.Write([uint16]0); $out.Write([uint16]1); $out.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s = $sizes[$i] % 256  # 256 is stored as 0
    $out.Write([byte]$s); $out.Write([byte]$s); $out.Write([byte]0); $out.Write([byte]0)
    $out.Write([uint16]1); $out.Write([uint16]32); $out.Write([uint32]$frames[$i].Length); $out.Write([uint32]$offset)
    $offset += $frames[$i].Length
}
foreach ($f in $frames) { $out.Write($f) }
$out.Close()
