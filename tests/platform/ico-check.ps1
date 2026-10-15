<#
    Validate a generated .ico with Windows' own icon loader.

    `tests/writers.test.js` checks `packIco` against `tests/containers.js`, which
    parses the format from its documentation. That is real evidence, but both
    halves are mine -- a misreading of the specification would be consistent in
    both and pass. This asks the operating system the format belongs to.

    It uses the Windows Imaging Component, through WPF's `BitmapDecoder`, which is
    the same decoder Explorer and every modern Windows application uses. Do not be
    tempted by `System.Drawing.Icon`: GDI+ predates PNG-compressed icon entries
    entirely, so it reports a 256px frame as 48x48 and `ToBitmap()` throws
    "Requested range extends past the end of the array". That is a limitation of
    the 1990s decoder, not a defect in the file, and it cost some time to
    establish.

    Deliberately not part of `npm test`: it needs Windows and PowerShell, and a
    suite that silently skips on other platforms would make a skip look like a
    pass.

        powershell -NoProfile -ExecutionPolicy Bypass -File tests\platform\ico-check.ps1

    Expects: 13 checks, 0 failed.
#>

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("iconforge-platform-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force $work | Out-Null

$passed = 0
$failed = 0

function Check($name, $actual, $expected) {
    if ($actual -eq $expected) {
        Write-Output "ok    $name"
        $script:passed++
    } else {
        Write-Output "FAIL  $name : expected $expected, got $actual"
        $script:failed++
    }
}

try {
    # Build the containers with the project's own writers, driven by Node, so what
    # Windows is asked to open is exactly what the app produces.
    $appIco = Join-Path $work 'app.ico'
    $faviconIco = Join-Path $work 'favicon.ico'

    Push-Location $root
    $colourJson = & node --import ./tests/ts-resolve.mjs tests/platform/emit-containers.mjs $appIco $faviconIco
    $nodeExit = $LASTEXITCODE
    Pop-Location
    if ($nodeExit -ne 0) { throw "generating the containers failed (node exited $nodeExit)" }

    $colours = $colourJson | ConvertFrom-Json

    Add-Type -AssemblyName PresentationCore

    function Decode($path) {
        [System.Windows.Media.Imaging.BitmapDecoder]::Create(
            (New-Object System.Uri($path)),
            [System.Windows.Media.Imaging.BitmapCreateOptions]::PreservePixelFormat,
            [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
    }

    # --- the four-frame .ico the windows preset produces ---------------------

    $decoder = Decode $appIco
    Check 'Windows recognises the file as an icon' $decoder.GetType().Name 'IconBitmapDecoder'
    Check 'Windows finds four frames in it' $decoder.Frames.Count 4

    $expectedSizes = @(16, 32, 48, 256)
    for ($i = 0; $i -lt $expectedSizes.Count; $i++) {
        $frame = $decoder.Frames[$i]
        $size = $expectedSizes[$i]
        Check "frame $i is ${size}x${size} as Windows reads it" "$($frame.PixelWidth)x$($frame.PixelHeight)" "${size}x${size}"
    }

    # The 256px frame is the interesting one: it is the size the directory cannot
    # name directly, written as the byte 0 by convention.
    $largest = $decoder.Frames[3]
    Check 'the 256px frame, which the format spells as 0, comes back as 256' $largest.PixelWidth 256

    # And the right image is in each frame, not merely an image of the right size.
    for ($i = 0; $i -lt $expectedSizes.Count; $i++) {
        $frame = $decoder.Frames[$i]
        $size = $expectedSizes[$i]
        $px = New-Object byte[] 4
        $frame.CopyPixels((New-Object System.Windows.Int32Rect(0, 0, 1, 1)), $px, 4, 0)
        # WIC hands back Bgra32.
        $got = "$($px[2]),$($px[1]),$($px[0])"
        $want = ($colours.$size) -join ','
        Check "frame $i holds the ${size}px image and not another" $got $want
    }

    # --- the three-frame favicon ---------------------------------------------

    $favicon = Decode $faviconIco
    Check 'the favicon has three frames' $favicon.Frames.Count 3
    Check 'the favicon frames are 16, 32 and 48' (($favicon.Frames | ForEach-Object { $_.PixelWidth }) -join ',') '16,32,48'
}
finally {
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}

Write-Output ''
Write-Output "$($passed + $failed) checks, $failed failed"
if ($failed -gt 0) { exit 1 }
exit 0
