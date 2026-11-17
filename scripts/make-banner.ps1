# Renders the CineBolt Leanback banner (320x180 px = 160x90 dp at xhdpi) from scripts/logo-paths.json
# (written by make-logo.cjs). Optional -PreviewDir also writes a large logo preview.
# Usage: powershell -File scripts\make-banner.ps1 [-PreviewDir <dir>]
param([string]$PreviewDir)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.Text.RegularExpressions;

public static class SvgPath {
    // Absolute/relative M/L/H/V/C/Z — all the CineBolt mark uses.
    public static GraphicsPath Parse(string d, FillMode mode) {
        var path = new GraphicsPath(mode);
        var tokens = Regex.Matches(d, @"[MmLlHhVvCcZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?");
        int i = 0; char cmd = 'M'; PointF cur = PointF.Empty, start = PointF.Empty;
        Func<float> num = () => float.Parse(tokens[i++].Value, CultureInfo.InvariantCulture);
        while (i < tokens.Count) {
            string t = tokens[i].Value;
            if (char.IsLetter(t[0])) { cmd = t[0]; i++; if (cmd == 'Z' || cmd == 'z') { path.CloseFigure(); cur = start; } continue; }
            bool rel = char.IsLower(cmd);
            switch (char.ToUpper(cmd)) {
                case 'M': { float x = num(), y = num(); if (rel) { x += cur.X; y += cur.Y; } path.StartFigure(); cur = start = new PointF(x, y); cmd = rel ? 'l' : 'L'; break; }
                case 'L': { float x = num(), y = num(); if (rel) { x += cur.X; y += cur.Y; } var p = new PointF(x, y); path.AddLine(cur, p); cur = p; break; }
                case 'H': { float x = num(); if (rel) x += cur.X; var p = new PointF(x, cur.Y); path.AddLine(cur, p); cur = p; break; }
                case 'V': { float y = num(); if (rel) y += cur.Y; var p = new PointF(cur.X, y); path.AddLine(cur, p); cur = p; break; }
                case 'C': {
                    float x1 = num(), y1 = num(), x2 = num(), y2 = num(), x = num(), y = num();
                    if (rel) { x1 += cur.X; y1 += cur.Y; x2 += cur.X; y2 += cur.Y; x += cur.X; y += cur.Y; }
                    var p = new PointF(x, y); path.AddBezier(cur, new PointF(x1, y1), new PointF(x2, y2), p); cur = p; break; }
                default: throw new Exception("Unsupported command " + cmd);
            }
        }
        return path;
    }

    public static Brush Gradient(float[] g, Color c1, float o1, Color c2, float o2) {
        var brush = new LinearGradientBrush(new PointF(g[0], g[1]), new PointF(g[2], g[3]), c1, c2);
        var blend = new ColorBlend(4);
        blend.Colors = new[] { c1, c1, c2, c2 };
        blend.Positions = new[] { 0f, o1, o2, 1f };
        brush.InterpolationColors = blend;
        brush.WrapMode = WrapMode.TileFlipX;
        return brush;
    }
}
'@

$spec = Get-Content -Raw (Join-Path $PSScriptRoot 'logo-paths.json') | ConvertFrom-Json
$html = { param($c) [System.Drawing.ColorTranslator]::FromHtml($c) }
function Draw-Logo($g, [float]$x, [float]$y, [float]$size) {
    $state = $g.Save()
    $g.TranslateTransform($x, $y); $g.ScaleTransform($size / 400, $size / 400)
    $tri = [SvgPath]::Parse($spec.triangle + $spec.holes, 'Alternate')   # even-odd: holes punch through
    $b = [SvgPath]::Gradient([float[]]$spec.grad.tri, (& $html $spec.colors.ember), 0, (& $html $spec.colors.amber), 1)
    $g.FillPath($b, $tri); $b.Dispose(); $tri.Dispose()
    $sh = [SvgPath]::Parse($spec.boltShadow, 'Winding'); $b = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(102, 0x21, 0x21, 0x21))
    $g.FillPath($b, $sh); $b.Dispose(); $sh.Dispose()
    $bolt = [SvgPath]::Parse($spec.bolt, 'Winding')
    $b = [SvgPath]::Gradient([float[]]$spec.grad.bolt, (& $html $spec.colors.bolt), 0.35, (& $html $spec.colors.boltWarm), 1)
    $g.FillPath($b, $bolt); $b.Dispose(); $bolt.Dispose()
    $g.Restore($state)
}
function New-Graphics($bmp) {
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'; $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'
    return $g
}

# Banner: app background, mark + "Cine" light + "Bolt" bold, centred as a group; ember→amber accent bar (the UI's accent).
$out = Join-Path $PSScriptRoot '..\android-tv\app\src\main\res\drawable-xhdpi'
New-Item -ItemType Directory -Force $out | Out-Null
$bmp = New-Object System.Drawing.Bitmap 320, 180
$g = New-Graphics $bmp
$g.Clear((& $html $spec.colors.bg))
$white = New-Object System.Drawing.SolidBrush (& $html '#F4F5F7')
$light = New-Object System.Drawing.Font 'Segoe UI Semilight', 44, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$bold = New-Object System.Drawing.Font 'Segoe UI', 44, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$fmt = [System.Drawing.StringFormat]::GenericTypographic
$cine = $g.MeasureString('Cine', $light, 400, $fmt); $boltW = $g.MeasureString('Bolt', $bold, 400, $fmt)
$logo = 70; $gap = 14
$x = [Math]::Round((320 - ($logo + $gap + $cine.Width + $boltW.Width)) / 2)
Draw-Logo $g $x (((180 - $logo) / 2) - 2) $logo
$textX = $x + $logo + $gap; $textY = 90 - (44 * 0.7) / 2 - (44 * 0.22)
$g.DrawString('Cine', $light, $white, $textX, $textY, $fmt)
$g.DrawString('Bolt', $bold, $white, ($textX + $cine.Width), $textY, $fmt)
$bar = New-Object System.Drawing.Drawing2D.LinearGradientBrush ((New-Object System.Drawing.PointF 0, 0), (New-Object System.Drawing.PointF 320, 0), (& $html $spec.colors.ember), (& $html $spec.colors.amber))
$g.FillRectangle($bar, 0, 176, 320, 4)
$bmp.Save((Join-Path $out 'tv_banner.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()

if ($PreviewDir) {
    $bmp = New-Object System.Drawing.Bitmap 480, 480; $g = New-Graphics $bmp
    $g.Clear((& $html $spec.colors.bg)); Draw-Logo $g 40 40 400
    $bmp.Save((Join-Path $PreviewDir 'logo-preview.png'), [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
    Copy-Item (Join-Path $out 'tv_banner.png') (Join-Path $PreviewDir 'banner-preview.png')
}
Write-Output 'CineBolt banner written: drawable-xhdpi/tv_banner.png'
