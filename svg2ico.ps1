<#
  Builds icon.ico for cs2prak from icon.svg.

  Large frames are the artwork as drawn. Small frames (16/20/24 px) are a
  simplified mark instead: at that size the strip cut-outs and the bars in the
  full art collapse into grey mush, so those frames get a plain rounded frame
  plus the play triangle, drawn straight in device pixels so the stroke lands
  on whole pixels rather than being scaled onto half of one.
#>
param(
  [string]$Svg,
  [string]$OutIco,
  [string]$BaseFill   = '#9CA3AB',
  [string]$AccentFill = '#FF6A1F',
  [int[]] $AccentIndex = @(4),
  [int[]] $FullSizes   = @(32, 48, 64, 128, 256),
  [int[]] $SimpleSizes = @(16, 20, 24),
  [string]$PreviewDir  = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName WindowsBase

$M = [System.Windows.Media.ColorConverter]
$bBase   = New-Object System.Windows.Media.SolidColorBrush($M::ConvertFromString($BaseFill))
$bAccent = New-Object System.Windows.Media.SolidColorBrush($M::ConvertFromString($AccentFill))
$bBase.Freeze(); $bAccent.Freeze()

$text = [System.IO.File]::ReadAllText($Svg)
$vb = ([regex]::Match($text, '<svg[^>]*viewBox\s*=\s*"([^"]+)"')).Groups[1].Value -split '[\s,]+'
$vbX = [double]$vb[0]; $vbY = [double]$vb[1]; $vbW = [double]$vb[2]; $vbH = [double]$vb[3]
$d = [regex]::Match($text, '<path[^>]*\sd\s*=\s*"([^"]+)"').Groups[1].Value
$subs = [regex]::Matches($d, 'M[^M]*') | ForEach-Object { $_.Value.Trim() }

function Group-Of([int[]]$idx) {
  $g = New-Object System.Windows.Media.GeometryGroup
  $g.FillRule = [System.Windows.Media.FillRule]::EvenOdd
  foreach ($i in $idx) { $g.Children.Add([System.Windows.Media.Geometry]::Parse("F0 $($subs[$i])")) }
  return $g
}
$gBase   = Group-Of (0..($subs.Count - 1) | Where-Object { $AccentIndex -notcontains $_ })
$gAccent = Group-Of $AccentIndex

function Encode($dv, [int]$px) {
  $rtb = New-Object System.Windows.Media.Imaging.RenderTargetBitmap($px, $px, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32)
  $rtb.Render($dv)
  $enc = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
  $enc.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($rtb))
  $ms = New-Object System.IO.MemoryStream
  $enc.Save($ms)
  return ,$ms.ToArray()
}

function Render-Full([int]$px) {
  $dv = New-Object System.Windows.Media.DrawingVisual
  $dc = $dv.RenderOpen()
  $s = $px / [Math]::Max($vbW, $vbH)
  $dc.PushTransform((New-Object System.Windows.Media.ScaleTransform($s, $s)))
  $dc.PushTransform((New-Object System.Windows.Media.TranslateTransform(-$vbX, -$vbY)))
  $dc.DrawGeometry($bBase,   $null, $gBase)
  $dc.DrawGeometry($bAccent, $null, $gAccent)
  $dc.Pop(); $dc.Pop(); $dc.Close()
  return ,(Encode $dv $px)
}

function Render-Simple([int]$px) {
  # Stroke and margins in whole pixels, rect on the half-pixel grid so a 1px
  # stroke covers exactly one row of pixels instead of bleeding across two.
  $st   = [Math]::Max(1, [Math]::Round($px / 14))
  $half = $st / 2.0
  $side = $px - 2 * $st - $st
  $rect = New-Object System.Windows.Rect(($st + $half), ($st + $half), $side, $side)
  $pen  = New-Object System.Windows.Media.Pen($bBase, $st)
  $pen.Freeze()

  # Play triangle: taller than wide, as in the full artwork. Centred in the frame.
  $inset = $st * 2
  $h  = $rect.Height - 2 * $inset
  $w  = [Math]::Round($h * 0.8)
  $l  = $rect.Left + ($rect.Width - $w) / 2.0
  $r  = $l + $w
  $t  = $rect.Top + $inset
  $b  = $t + $h
  $mid = $t + $h / 2.0
  $tri = [System.Windows.Media.Geometry]::Parse("M $l $t L $r $mid L $l $b Z")

  $dv = New-Object System.Windows.Media.DrawingVisual
  $dc = $dv.RenderOpen()
  $dc.DrawRoundedRectangle($null, $pen, $rect, ($st * 1.2), ($st * 1.2))
  $dc.DrawGeometry($bAccent, $null, $tri)
  $dc.Close()
  return ,(Encode $dv $px)
}

$frames = @()
foreach ($px in ($SimpleSizes + $FullSizes | Sort-Object)) {
  $bytes = if ($SimpleSizes -contains $px) { Render-Simple $px } else { Render-Full $px }
  $frames += ,@{ px = $px; bytes = $bytes }
  if ($PreviewDir) {
    if (-not (Test-Path $PreviewDir)) { New-Item -ItemType Directory -Force $PreviewDir | Out-Null }
    [System.IO.File]::WriteAllBytes((Join-Path $PreviewDir "frame_$px.png"), [byte[]]$bytes)
  }
}

if ($OutIco) {
  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter($ms)
  $bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$frames.Count)
  $offset = 6 + 16 * $frames.Count
  foreach ($f in $frames) {
    $dim = if ($f.px -ge 256) { 0 } else { $f.px }
    $bw.Write([Byte]$dim); $bw.Write([Byte]$dim); $bw.Write([Byte]0); $bw.Write([Byte]0)
    $bw.Write([UInt16]0); $bw.Write([UInt16]32)
    $bw.Write([UInt32]$f.bytes.Length); $bw.Write([UInt32]$offset)
    $offset += $f.bytes.Length
  }
  foreach ($f in $frames) { $bw.Write([byte[]]$f.bytes) }
  $bw.Flush()
  [System.IO.File]::WriteAllBytes($OutIco, $ms.ToArray())
}
foreach ($f in $frames) { "  {0,3}px  {1,6} bytes  {2}" -f $f.px, $f.bytes.Length, $(if ($SimpleSizes -contains $f.px) { 'simple' } else { 'full' }) }
