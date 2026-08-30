<#
.SYNOPSIS
  Cut a release: bump every version file, verify, build, tag, publish.

.DESCRIPTION
  The version lives in four files that can drift apart, and the build has an
  order that is easy to get wrong. This does the whole thing, and refuses
  rather than producing something half-done.

.PARAMETER Version
  The new version, e.g. 0.2.0. Must be higher than the current one.

.PARAMETER SkipPublish
  Build and tag locally, but do not push or create the GitHub release.

.PARAMETER DryRun
  Report what would happen and change nothing.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Version 0.2.0
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [switch]$SkipPublish,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo

function Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "   $msg" -ForegroundColor Green }
function Die($msg)  { Write-Host "`n!! $msg" -ForegroundColor Red; exit 1 }

# PowerShell 5.1 turns anything a native command writes to stderr into a
# terminating error while ErrorActionPreference is Stop -- and cargo, npm and
# git all write ordinary progress there. Run them with that relaxed and judge
# them on their exit code, which is the only thing that actually means failure.
function Native {
    param([Parameter(Mandatory)][scriptblock]$Block, [Parameter(Mandatory)][string]$What)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $Block } finally { $ErrorActionPreference = $prev }
    if ($LASTEXITCODE -ne 0) { Die "$What failed (exit $LASTEXITCODE)" }
}

if ($Version -notmatch '^\d+\.\d+\.\d+$') { Die "Version must look like 1.2.3, got '$Version'" }

# --- Refuse to start if the outcome would be unclear -------------------------

Step "Pre-flight"

# Windows cannot replace a running exe, and a half-installed app is a bad state
# to debug. Catch it here rather than at the install step.
$running = Get-Process field-catalog, fieldcatalog -ErrorAction SilentlyContinue
if ($running) {
    Die ("Field Catalog is running (PID $($running.Id -join ', ')). Close it first -- " +
         "Windows cannot replace a running executable.")
}
Ok "app is not running"

if (git status --porcelain) { Die "Working tree is dirty. Commit or stash first." }
Ok "working tree clean"

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'main') { Write-Host "   note: on branch '$branch', not main" -ForegroundColor Yellow }

if (git tag --list "v$Version") { Die "Tag v$Version already exists" }
Ok "tag v$Version is free"

# Equal-and-untagged is a resume, not a mistake: an earlier run that failed
# after the version bump leaves the files already saying $Version. Only a
# genuinely lower version is wrong.
$current = (Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json).version
if ([version]$Version -lt [version]$current) {
    Die "Version $Version is lower than the current $current"
}
if ([version]$Version -eq [version]$current) {
    Ok "version already $Version and untagged -- resuming an interrupted release"
} else {
    Ok "version $current -> $Version"
}

# --- Bump every file that carries the version --------------------------------

Step "Bumping version in 4 files"

$files = @(
    @{ Path = 'src-tauri/tauri.conf.json'; Pattern = '("version"\s*:\s*")[^"]+(")';  What = 'installer + Add/Remove Programs' }
    @{ Path = 'package.json';              Pattern = '("version"\s*:\s*")[^"]+(")';  What = 'npm package' }
    @{ Path = 'src-tauri/Cargo.toml';      Pattern = '(?m)^(version\s*=\s*")[^"]+(")'; What = 'Rust crate' }
    @{ Path = 'pyproject.toml';            Pattern = '(?m)^(version\s*=\s*")[^"]+(")'; What = 'Python worker' }
)

foreach ($f in $files) {
    $raw = Get-Content $f.Path -Raw
    if ($raw -notmatch $f.Pattern) { Die "Could not find a version field in $($f.Path)" }
    $new = [regex]::Replace($raw, $f.Pattern, "`${1}$Version`${2}", 1)
    if (-not $DryRun) {
        # PowerShell 5.1's -Encoding utf8 writes a BOM, which makes pyproject.toml
        # unparseable and shows up as stray characters elsewhere. Write the bytes.
        $full = Join-Path (Get-Location) $f.Path
        [System.IO.File]::WriteAllText($full, $new, (New-Object System.Text.UTF8Encoding $false))
    }
    Ok "$($f.Path)  ($($f.What))"
}

# Cargo.lock records the crate version; refresh it so the tree stays consistent.
if (-not $DryRun) {
    $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
    Native { cargo update --manifest-path src-tauri/Cargo.toml --package field-catalog --precise $Version | Out-Null } "cargo update"
}

Step "Verifying all four agree"
$found = @(
    (Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json).version
    (Get-Content package.json -Raw | ConvertFrom-Json).version
    ([regex]::Match((Get-Content src-tauri/Cargo.toml -Raw), '(?m)^version\s*=\s*"([^"]+)"').Groups[1].Value)
    ([regex]::Match((Get-Content pyproject.toml -Raw), '(?m)^version\s*=\s*"([^"]+)"').Groups[1].Value)
)
if ($DryRun) { Ok "(dry run -- files unchanged)" }
elseif (($found | Select-Object -Unique).Count -ne 1 -or $found[0] -ne $Version) {
    Die "Versions disagree after bumping: $($found -join ', ')"
} else { Ok "all four report $Version" }

# --- Nothing ships that does not pass ----------------------------------------

Step "Tests"
if ($DryRun) { Ok "(skipped in dry run)" } else {
    Native { & .\.venv\Scripts\python.exe -m pytest -q } "worker tests"
    Ok "worker tests pass"

    Push-Location ui
    try { Native { npx tsc --noEmit } "UI typecheck" } finally { Pop-Location }
    Ok "UI typechecks"
}

# --- Build: worker exe first, then the bundle that embeds it -----------------

Step "Building installer"
if ($DryRun) { Ok "(skipped in dry run)" } else {
    $vcvars = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
    $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
    if (Test-Path $vcvars) { Native { cmd /c "`"$vcvars`" >nul 2>&1 && npm run build:installer" } "installer build" }
    else { Native { npm run build:installer } "installer build" }
}

$setup = Get-ChildItem "src-tauri/target/release/bundle/nsis/*$Version*setup.exe" -ErrorAction SilentlyContinue |
         Select-Object -First 1
if (-not $DryRun) {
    if (-not $setup) { Die "No installer produced for $Version" }
    Ok "$($setup.Name)  $([math]::Round($setup.Length/1MB,1)) MB"
}

# --- Commit, tag, publish ----------------------------------------------------

Step "Commit and tag"
if ($DryRun) { Ok "(skipped in dry run)"; Write-Host "`nDry run complete. Nothing changed." -ForegroundColor Cyan; exit 0 }

Native { git add -A } "git add"
# On a resume the version files already say $Version, so there may be nothing
# to commit. That is fine; the tag is what the release needs.
if (git diff --cached --quiet) { Ok "nothing new to commit" }
else {
    Native { git commit -q -m "Release $Version" } "git commit"
    Ok "committed"
}
Native { git tag -a "v$Version" -m "Field Catalog $Version" } "git tag"
Ok "tagged v$Version"

if ($SkipPublish) {
    Write-Host "`nBuilt and tagged locally. Not pushed (-SkipPublish)." -ForegroundColor Cyan
    Write-Host "Installer: $($setup.FullName)"
    exit 0
}

Step "Publishing"
Native { git push -q origin main } "git push"
Native { git push -q origin "v$Version" } "git push tag"
Ok "pushed main and v$Version"

# The token Git Credential Manager already holds; no separate setup.
$token = ("protocol=https", "host=github.com", "") -join "`n" | git credential fill |
         Select-String '^password=' | ForEach-Object { $_.Line.Substring(9) }
if (-not $token) { Die "No GitHub token available. Release not created; tag is pushed, so you can add it by hand." }

$slug = (git remote get-url origin) -replace '.*github\.com[:/]', '' -replace '\.git$', ''
$body = @"
Download **$($setup.Name)** below and run it. The worker is bundled; nothing else is needed.

Installing over an existing copy upgrades it in place and leaves your library untouched. **Close the app first** -- Windows cannot replace a running executable.

Windows will warn that the installer is unsigned: **More info -> Run anyway**.

See the [README](https://github.com/$slug#readme) for what it does, and [Identification](https://github.com/$slug#identification) if you want automatic species ID -- it is optional.
"@

$release = @{ tag_name = "v$Version"; name = "Field Catalog $Version"; body = $body
              draft = $false; prerelease = $true } | ConvertTo-Json
$headers = @{ Authorization = "Bearer $token"; Accept = 'application/vnd.github+json' }
$created = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$slug/releases" `
                             -Headers $headers -Body $release
Ok "release created"

$upload = ($created.upload_url -split '\{')[0] + "?name=" + ($setup.Name -replace ' ', '-')
Invoke-RestMethod -Method Post -Uri $upload -Headers $headers `
                  -ContentType 'application/octet-stream' -InFile $setup.FullName | Out-Null
Ok "installer uploaded"

Write-Host "`nReleased $Version -> $($created.html_url)" -ForegroundColor Green
