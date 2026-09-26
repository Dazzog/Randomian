#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

$Root    = $PSScriptRoot
$HtmlSrc = Join-Path $Root 'index.html'
$CssSrc  = Join-Path $Root 'style.css'
$JsSrc   = Join-Path $Root 'script.js'
$LogoSrc = Join-Path $Root 'logo.png'
$Out     = Join-Path $Root 'all-in-one.html'

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Read-Text([string]$File) {
    [System.IO.File]::ReadAllText($File, $utf8NoBom)
}

$html = Read-Text $HtmlSrc
$css  = Read-Text $CssSrc
$js   = Read-Text $JsSrc

# Logo als Base64-Data-URI einbetten, damit die CSS-Regel ohne externe Bilddatei auskommt.
$logoBase64  = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($LogoSrc))
$logoDataUri = "data:image/png;base64,$logoBase64"
$css = [regex]::Replace($css, 'url\(["'']?logo\.png["'']?\)', { param($m) "url(`"$logoDataUri`")" })

# </script> im eingebetteten JS darf das umschließende <script>-Tag nicht vorzeitig schließen.
$safeJs = [regex]::Replace($js, '</script>', '<\/script>', 'IgnoreCase')

# Wörtliches Ersetzen (kein Regex-Ersatzstring), damit "$" im CSS/JS nicht interpretiert wird.
# Wie in build.js wird nur das erste Vorkommen ersetzt.
function Replace-First([string]$Text, [string]$Search, [string]$Replacement) {
    $i = $Text.IndexOf($Search, [StringComparison]::Ordinal)
    if ($i -lt 0) { return $Text }
    $Text.Substring(0, $i) + $Replacement + $Text.Substring($i + $Search.Length)
}

$html = Replace-First $html '<link rel="stylesheet" href="style.css">' "<style>`n$css`n</style>"
$html = Replace-First $html '<script src="script.js"></script>'        "<script>`n$safeJs`n</script>"

[System.IO.File]::WriteAllText($Out, $html, $utf8NoBom)
$sizeKb = ((Get-Item $Out).Length / 1KB).ToString('0.0', [Globalization.CultureInfo]::InvariantCulture)
$check = [char]0x2713  # kein Literal, damit PowerShell 5.1 die Datei auch ohne BOM korrekt parst
Write-Host "$check $(Split-Path $Out -Leaf) erstellt ($sizeKb KB)"
